import type { Server } from 'socket.io';
import {
  COUNTDOWN_MS,
  MIN_RACE_MS,
  RESULTS_TIMEOUT_MS,
  TOTAL_LAPS,
  type GridSlot,
  type ResultRow,
  type RaceSnapshot,
  type KartState,
  type ItemKind,
  type SlickInfo,
  type ProjInfo,
} from '../../src/shared/protocol.js';
import { Room, type Player } from './rooms.js';

const ITEM_BOX_COUNT = 12;
const BOX_COOLDOWN_MS = 3500;
const SLICK_LIFETIME_MS = 12000;
const ROCKET_LIFETIME_MS = 4200;

/**
 * Server-side race state for one room. Clients own their kart physics and
 * report progress; the server validates progression, computes live standings,
 * arbitrates finish order and hands out items.
 */
export class Race {
  startAt = 0;
  started = false; // past countdown
  grid: GridSlot[] = [];
  boxes = new Map<number, number>(); // boxId -> cooldownUntil
  slicks = new Map<number, SlickInfo>();
  projs = new Map<number, ProjInfo>();
  results: ResultRow[] = [];
  finishCount = 0;
  firstFinishAt: number | null = null;
  resultsSent = false;
  private nextSlickId = 1;
  private nextProjId = 1;
  private timers: NodeJS.Timeout[] = [];

  constructor(private io: Server, private room: Room) {}

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(setTimeout(fn, ms));
  }

  start(): { ok: true } | { ok: false; error: string } {
    if (this.room.phase === 'countdown' || this.room.phase === 'racing') {
      return { ok: false, error: 'A race is already running.' };
    }
    const racers = this.room.connectedPlayers().slice(0, 8);
    if (racers.length < 1) return { ok: false, error: 'Nobody is ready to race.' };
    for (const p of this.room.players.values()) {
      p.lastState = null;
      p.item = null;
      p.place = null;
      p.finishTimeMs = null;
      p.waiting = false;
    }
    this.grid = racers.map((p, i) => ({ id: p.id, slot: i }));
    this.boxes.clear();
    this.slicks.clear();
    this.projs.clear();
    this.results = [];
    this.finishCount = 0;
    this.firstFinishAt = null;
    this.resultsSent = false;
    this.startAt = Date.now() + COUNTDOWN_MS;
    this.started = false;
    this.room.phase = 'countdown';
    this.room.broadcast(this.io, 'race:start', {
      startAt: this.startAt,
      grid: this.grid,
      serverNow: Date.now(),
    });
    this.room.emitRoom(this.io);
    this.later(() => {
      if (this.room.phase === 'countdown') {
        this.room.phase = 'racing';
        this.started = true;
        this.room.emitRoom(this.io);
      }
    }, COUNTDOWN_MS);
    return { ok: true };
  }

  static boxCount(): number {
    return ITEM_BOX_COUNT;
  }

  isRacer(player: Player): boolean {
    return this.grid.some((g) => g.id === player.id);
  }

  handleState(player: Player, s: KartState): void {
    if (!this.started) return;
    if (!this.isRacer(player)) return;
    const prev = player.lastState;
    // Basic progression validation: laps may only move forward one at a time
    // and checkpoint counts must be plausible relative to the lap.
    if (prev) {
      if (s.lap < prev.lap || s.lap > prev.lap + 1) return;
      if (s.lap === prev.lap && s.cps < prev.cps - 1) return;
      if (s.cps < 0 || s.cps > 64 || s.prog < 0 || s.prog > 1.01) return;
    } else {
      if (s.lap < 0 || s.lap > 1) return;
    }
    player.lastState = s;
  }

  handlePickup(player: Player, box: number): { ok: boolean; item?: ItemKind; cooldownUntil?: number } {
    if (!this.started || !this.isRacer(player) || player.place !== null) return { ok: false };
    const now = Date.now();
    const until = this.boxes.get(box) ?? 0;
    if (now < until) return { ok: false };
    this.boxes.set(box, now + BOX_COOLDOWN_MS);
    this.room.broadcast(this.io, 'box', { box, until: now + BOX_COOLDOWN_MS });
    const item = this.rollItem(player);
    player.item = item;
    return { ok: true, item, cooldownUntil: now + BOX_COOLDOWN_MS };
  }

  private rollItem(player: Player): ItemKind {
    const order = this.standings();
    const rank = order.indexOf(player.id);
    const behind = rank < 0 ? 4 : rank;
    const r = Math.random();
    if (behind <= 2) {
      // leaders: defensive items
      return r < 0.45 ? 'slick' : r < 0.75 ? 'rocket' : 'boost';
    }
    return r < 0.5 ? 'boost' : r < 0.65 ? 'slick' : 'rocket';
  }

  handleUseItem(player: Player, msg: { kind: ItemKind; x: number; y: number; z: number; yaw: number }): void {
    if (!this.isRacer(player) || player.item !== msg.kind || player.place !== null) return;
    player.item = null;
    if (msg.kind === 'slick') {
      const info: SlickInfo = {
        id: this.nextSlickId++,
        owner: player.id,
        x: msg.x,
        y: msg.y,
        z: msg.z,
        until: Date.now() + SLICK_LIFETIME_MS,
      };
      this.slicks.set(info.id, info);
      this.room.broadcast(this.io, 'slick', info);
      const t = setTimeout(() => {
        this.slicks.delete(info.id);
      }, SLICK_LIFETIME_MS + 1000);
      this.timers.push(t);
    } else if (msg.kind === 'rocket') {
      const dx = -Math.sin(msg.yaw);
      const dz = -Math.cos(msg.yaw);
      const info: ProjInfo = {
        id: this.nextProjId++,
        owner: player.id,
        kind: 'rocket',
        x: msg.x + dx * 2.5,
        y: msg.y + 0.8,
        z: msg.z + dz * 2.5,
        dx,
        dz,
        born: Date.now(),
      };
      this.projs.set(info.id, info);
      this.room.broadcast(this.io, 'proj', info);
      const t = setTimeout(() => this.projs.delete(info.id), ROCKET_LIFETIME_MS + 500);
      this.timers.push(t);
    }
    // 'boost' needs no relay: only the user's own kart changes.
  }

  handleHit(victim: Player, msg: { kind: 'spin' | 'slip'; by?: string; proj?: number }): void {
    if (!this.isRacer(victim)) return;
    const until = Date.now() + (msg.kind === 'spin' ? 1300 : 1700);
    this.room.broadcast(this.io, 'fx', { kart: victim.id, kind: msg.kind, until, proj: msg.proj });
    if (msg.proj !== undefined) this.projs.delete(msg.proj);
  }

  handleFinish(player: Player, msg: { lap: number }): void {
    if (!this.started || !this.isRacer(player) || player.place !== null) return;
    if (msg.lap < TOTAL_LAPS) return;
    const elapsed = Date.now() - this.startAt;
    if (elapsed < MIN_RACE_MS) return;
    const last = player.lastState;
    if (!last || last.lap < TOTAL_LAPS - 1) return;
    player.place = ++this.finishCount;
    player.finishTimeMs = elapsed;
    if (this.firstFinishAt === null) this.firstFinishAt = Date.now();
    this.room.broadcast(this.io, 'finish', {
      id: player.id,
      place: player.place,
      timeMs: elapsed,
    });
    this.checkAllFinished(this.room, this.io);
    if (this.firstFinishAt !== null && !this.resultsSent) {
      const wait = RESULTS_TIMEOUT_MS - (Date.now() - this.firstFinishAt);
      if (wait > 0) {
        this.later(() => this.finalize(this.room, this.io), wait);
      } else {
        this.finalize(this.room, this.io);
      }
    }
  }

  checkAllFinished(room: Room, io: Server): void {
    if (this.resultsSent) return;
    if (!this.started) return;
    const racers = room.racingPlayers();
    if (racers.length === 0) return;
    const all = racers.every((p) => p.place !== null || (!p.connected && p.disconnectAt && Date.now() - p.disconnectAt > 10000));
    if (all) this.finalize(room, io);
  }

  finalize(room: Room, io: Server): void {
    if (this.resultsSent) return;
    this.resultsSent = true;
    const racers = room.racingPlayers();
    const finished = racers
      .filter((p) => p.place !== null)
      .sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
    const dnf = racers
      .filter((p) => p.place === null)
      .sort((a, b) => this.scoreOf(b) - this.scoreOf(a));
    let place = 1;
    const rows: ResultRow[] = [];
    for (const p of finished) {
      rows.push({ id: p.id, name: p.name, character: p.character, place: place++, timeMs: p.finishTimeMs });
    }
    for (const p of dnf) {
      rows.push({ id: p.id, name: p.name, character: p.character, place: place++, timeMs: null });
    }
    this.results = rows;
    room.phase = 'results';
    room.broadcast(io, 'results', { rows });
    room.emitRoom(io);
  }

  private scoreOf(p: Player): number {
    const s = p.lastState;
    if (!s) return -1;
    return s.lap * 100 + s.cps + s.prog;
  }

  standings(): string[] {
    const racers = this.room.racingPlayers();
    const finished = racers
      .filter((p) => p.place !== null)
      .sort((a, b) => (a.place ?? 99) - (b.place ?? 99))
      .map((p) => p.id);
    const racing = racers
      .filter((p) => p.place === null)
      .sort((a, b) => this.scoreOf(b) - this.scoreOf(a))
      .map((p) => p.id);
    return [...finished, ...racing];
  }

  broadcastStates(): void {
    if (!this.started && this.room.phase !== 'countdown') return;
    const states: KartState[] = [];
    for (const p of this.room.players.values()) {
      if (p.waiting || !p.connected || !p.lastState) continue;
      if (!this.isRacer(p)) continue;
      states.push(p.lastState);
    }
    this.room.broadcast(this.io, 's', { p: states, order: this.standings() });
  }

  snapshotFor(player: Player): RaceSnapshot {
    const me = player.lastState;
    return {
      startAt: this.startAt,
      grid: this.grid,
      order: this.standings(),
      yourLap: me?.lap ?? 0,
      yourCps: me?.cps ?? 0,
      yourItem: player.item,
      boxes: [...this.boxes.entries()].map(([box, until]) => ({ box, until })),
      slicks: [...this.slicks.values()],
      projs: [...this.projs.values()],
      finished: this.room.racingPlayers()
        .filter((p) => p.place !== null && p.finishTimeMs !== null)
        .map((p) => ({ id: p.id, place: p.place as number, timeMs: p.finishTimeMs as number })),
      serverNow: Date.now(),
    };
  }

  backToLobby(): void {
    this.dispose();
    this.room.phase = 'lobby';
    this.room.race = null;
    for (const p of this.room.players.values()) {
      p.lastState = null;
      p.item = null;
      p.place = null;
      p.finishTimeMs = null;
      p.waiting = false;
    }
  }
}
