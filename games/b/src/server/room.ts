import type { Server, Socket } from 'socket.io';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  COUNTDOWN_MS,
  FINISH_GRACE_MS,
  HONEY,
  ITEM_BOX_RESPAWN_MS,
  KART_COLORS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NET_INTERVAL_MS,
  RECONNECT_GRACE_MS,
  TOTAL_LAPS,
  WASP,
  type ItemKind,
} from '../shared/constants.ts';
import {
  KART_FLAG_SPIN,
  type ClientToServer,
  type HoneyNet,
  type JoinOk,
  type KartNet,
  type KartStateMsg,
  type PlayerPublic,
  type PlayerStatus,
  type RaceEvent,
  type RaceResultEntry,
  type RespawnAck,
  type RoomPhase,
  type RoomState,
  type ServerToClient,
  type Snapshot,
  type StandingNet,
  type WaspNet,
} from '../shared/protocol.ts';
import { TRACK, progressDelta, projectToTrack, startGridSlot, trackPoint, trackYaw } from '../shared/track.ts';

type IO = Server<ClientToServer, ServerToClient>;
export type GameSocket = Socket<ClientToServer, ServerToClient>;

interface RaceData {
  /** fractional track index the server believes the kart is at */
  hint: number;
  lateral: number;
  lap: number;
  /** index (into TRACK.checkpoints) of the next checkpoint to cross */
  nextCp: number;
  /** index of the last checkpoint that was crossed (respawn point) */
  lastCp: number;
  finishTimeMs: number | null;
  item: ItemKind | null;
  kart: KartNet;
  metric: number;
  place: number;
  lastHitAt: number;
  /** set when the player dropped out (left the room) mid race */
  dropped: boolean;
  lastStateAt: number;
}

export interface Player {
  id: string;
  name: string;
  color: string;
  slot: number;
  token: string;
  socket: GameSocket | null;
  connected: boolean;
  disconnectedAt: number;
  status: PlayerStatus;
  wins: number;
  race: RaceData | null;
  joinedAt: number;
}

interface Wasp {
  id: number;
  progress: number;
  lateral: number;
  shooterId: string;
  targetId: string | null;
  bornAt: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface Honey extends HoneyNet {
  ownerId: string;
  bornAt: number;
}

const N = TRACK.samples.length;
/** A disconnected host keeps the crown this long before it passes on (ms). */
const HOST_HANDOVER_MS = 12_000;
/** Sample-index search window for server-side projection (metres, ~1 per sample). */
const SERVER_WINDOW = 90;
/** Ignore reported positions further than this from the centre line. */
const MAX_OFF_TRACK = 60;

export class Room {
  readonly code: string;
  readonly createdAt = Date.now();
  phase: RoomPhase = 'lobby';
  hostId = '';
  players = new Map<string, Player>();
  raceStartAt: number | null = null;
  raceNumber = 0;
  results: RaceResultEntry[] | null = null;

  private io: IO;
  private tickTimer: NodeJS.Timeout | null = null;
  private phaseTimer: NodeJS.Timeout | null = null;
  private finishDeadline: number | null = null;
  private boxes = 0;
  private boxTimers: NodeJS.Timeout[] = [];
  private wasps: Wasp[] = [];
  private honeys: Honey[] = [];
  private nextEntityId = 1;
  private lastTickAt = 0;
  private finishOrder = 0;
  private lastEmptyAt: number | null = Date.now();

  constructor(code: string, io: IO) {
    this.code = code;
    this.io = io;
  }

  // ------------------------------------------------------------------ helpers

  get size(): number {
    return this.players.size;
  }

  connectedPlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.connected);
  }

  /** Time (ms) at which the room became empty of connected players, or null. */
  emptySince(): number | null {
    return this.connectedPlayers().length === 0 ? this.lastEmptyAt : null;
  }

  isFull(): boolean {
    return this.players.size >= MAX_PLAYERS;
  }

  private pickColor(): string {
    const used = new Set([...this.players.values()].map((p) => p.color));
    return KART_COLORS.find((c) => !used.has(c)) ?? KART_COLORS[this.players.size % KART_COLORS.length];
  }

  private emitEvent(ev: RaceEvent): void {
    this.io.to(this.code).emit('race:event', ev);
  }

  private log(msg: string): void {
    console.log(`[room ${this.code}] ${msg}`);
  }

  // ---------------------------------------------------------------- joining

  addPlayer(socket: GameSocket, name: string): JoinOk {
    const id = randomUUID().slice(0, 8);
    const player: Player = {
      id,
      name,
      color: this.pickColor(),
      slot: this.players.size,
      token: `${this.code}.${id}.${randomBytes(12).toString('base64url')}`,
      socket,
      connected: true,
      disconnectedAt: 0,
      status: this.phase === 'lobby' ? 'lobby' : 'waiting',
      wins: 0,
      race: null,
      joinedAt: Date.now(),
    };
    this.players.set(id, player);
    // Only take the crown when there is no host at all; a briefly disconnected
    // host keeps it (see `reap`).
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = id;
    this.lastEmptyAt = null;
    socket.join(this.code);
    this.log(`${name} (${id}) joined; ${this.players.size} players`);
    this.broadcastState();
    return { ok: true, playerId: id, token: player.token, room: this.toState(), resumed: false, item: null };
  }

  resumePlayer(player: Player, socket: GameSocket): JoinOk {
    if (player.socket && player.socket.id !== socket.id) {
      // an older socket for this seat is still around - drop it
      player.socket.emit('room:kicked', 'You reconnected from another tab.');
      player.socket.leave(this.code);
    }
    player.socket = socket;
    player.connected = true;
    player.disconnectedAt = 0;
    this.lastEmptyAt = null;
    socket.join(this.code);
    if (!this.players.has(this.hostId)) this.hostId = player.id;
    this.log(`${player.name} (${player.id}) reconnected`);
    this.broadcastState();
    return {
      ok: true,
      playerId: player.id,
      token: player.token,
      room: this.toState(),
      resumed: true,
      item: player.race?.item ?? null,
    };
  }

  findByToken(token: string): Player | undefined {
    for (const p of this.players.values()) if (p.token === token) return p;
    return undefined;
  }

  handleDisconnect(player: Player): void {
    player.connected = false;
    player.socket = null;
    player.disconnectedAt = Date.now();
    if (this.connectedPlayers().length === 0) this.lastEmptyAt = Date.now();
    this.log(`${player.name} (${player.id}) disconnected`);
    // The host keeps the crown through a brief drop / page refresh; `reap`
    // hands it over if they stay away.
    this.broadcastState();
  }

  removePlayer(player: Player, reason: string): void {
    if (!this.players.has(player.id)) return;
    this.players.delete(player.id);
    if (player.socket) {
      player.socket.leave(this.code);
      player.socket = null;
    }
    if (player.race && (this.phase === 'racing' || this.phase === 'countdown')) {
      player.race.dropped = true;
    }
    this.log(`${player.name} (${player.id}) removed (${reason}); ${this.players.size} left`);
    if (this.connectedPlayers().length === 0) this.lastEmptyAt = Date.now();
    this.ensureHost();
    this.broadcastState();
    if (this.phase === 'racing') this.checkRaceEnd();
  }

  /** Called periodically by the manager: drop players whose reconnection grace expired. */
  reap(now: number): void {
    for (const p of [...this.players.values()]) {
      if (p.connected) continue;
      const grace = this.phase === 'lobby' || this.phase === 'results' ? 20_000 : RECONNECT_GRACE_MS;
      if (now - p.disconnectedAt > grace) this.removePlayer(p, 'reconnect window expired');
    }
    const host = this.players.get(this.hostId);
    if (host && !host.connected && now - host.disconnectedAt > HOST_HANDOVER_MS) {
      this.ensureHost();
      if (this.hostId !== host.id) {
        this.log(`host handed over to ${this.players.get(this.hostId)?.name}`);
        this.broadcastState();
      }
    }
  }

  private ensureHost(): void {
    const current = this.players.get(this.hostId);
    if (current?.connected) return;
    const next = [...this.players.values()].filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) this.hostId = next.id;
  }

  // ------------------------------------------------------------- race flow

  startRace(requester: Player, ack?: (r: { ok: boolean; message?: string }) => void): void {
    if (requester.id !== this.hostId) return void ack?.({ ok: false, message: 'Only the host can start the race.' });
    if (this.phase === 'countdown' || this.phase === 'racing') {
      return void ack?.({ ok: false, message: 'A race is already running.' });
    }
    const racers = this.connectedPlayers();
    if (racers.length < MIN_PLAYERS) {
      return void ack?.({ ok: false, message: `Need at least ${MIN_PLAYERS} connected racers.` });
    }
    if (racers.length > MAX_PLAYERS) {
      return void ack?.({ ok: false, message: `At most ${MAX_PLAYERS} racers.` });
    }
    this.beginRace(racers);
    ack?.({ ok: true });
  }

  backToLobby(requester: Player): void {
    if (requester.id !== this.hostId) return;
    if (this.phase !== 'results') return;
    this.phase = 'lobby';
    this.results = null;
    this.raceStartAt = null;
    for (const p of this.players.values()) {
      p.status = 'lobby';
      p.race = null;
    }
    this.broadcastState();
  }

  private beginRace(racers: Player[]): void {
    this.stopTimers();
    this.raceNumber += 1;
    this.results = null;
    this.finishDeadline = null;
    this.finishOrder = 0;
    this.wasps = [];
    this.honeys = [];
    this.boxes = (1 << TRACK.itemBoxes.length) - 1;
    // Fewest wins start at the front; ties keep join order.
    racers.sort((a, b) => a.wins - b.wins || a.joinedAt - b.joinedAt);
    racers.forEach((p, i) => {
      p.slot = i;
      p.status = 'racing';
      const grid = startGridSlot(TRACK, i);
      p.race = {
        hint: grid.index,
        lateral: 0,
        lap: 1,
        nextCp: 1,
        lastCp: 0,
        finishTimeMs: null,
        item: null,
        kart: { id: p.id, x: grid.pos.x, y: grid.pos.y, z: grid.pos.z, yaw: grid.yaw, v: 0, f: 0, d: 0 },
        metric: -100,
        place: i + 1,
        lastHitAt: 0,
        dropped: false,
        lastStateAt: 0,
      };
    });
    for (const p of this.players.values()) {
      if (!p.race) {
        p.status = 'waiting';
      }
    }
    this.phase = 'countdown';
    this.raceStartAt = Date.now() + COUNTDOWN_MS;
    this.log(`race #${this.raceNumber} starting with ${racers.length} racers`);
    this.broadcastState();
    this.phaseTimer = setTimeout(() => {
      if (this.phase !== 'countdown') return;
      this.phase = 'racing';
      this.broadcastState();
    }, COUNTDOWN_MS);
    this.lastTickAt = Date.now();
    this.tickTimer = setInterval(() => this.tick(), NET_INTERVAL_MS);
  }

  private stopTimers(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    for (const t of this.boxTimers) clearTimeout(t);
    this.tickTimer = null;
    this.phaseTimer = null;
    this.boxTimers = [];
  }

  private racingPlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.race !== null);
  }

  private tick(): void {
    const now = Date.now();
    const dt = Math.min(0.25, (now - this.lastTickAt) / 1000);
    this.lastTickAt = now;
    if (this.phase === 'racing') {
      this.updateWasps(dt, now);
      this.updateStandings();
      this.checkRaceEnd();
    }
    if (this.phase === 'racing' || this.phase === 'countdown') {
      this.io.to(this.code).emit('race:snapshot', this.snapshot(now));
    }
  }

  private snapshot(now: number): Snapshot {
    const karts: KartNet[] = [];
    const standings: StandingNet[] = [];
    for (const p of this.racingPlayers()) {
      const r = p.race!;
      karts.push(r.kart);
      standings.push({
        id: p.id,
        place: r.place,
        lap: r.lap,
        cp: r.nextCp,
        finished: r.finishTimeMs !== null,
        metric: Math.round(r.metric),
      });
    }
    const wasps: WaspNet[] = this.wasps.map((w) => ({ id: w.id, x: w.x, y: w.y, z: w.z, yaw: w.yaw }));
    const honeys: HoneyNet[] = this.honeys.map((h) => ({ id: h.id, x: h.x, y: h.y, z: h.z }));
    return { t: now, karts, standings, wasps, honeys, boxes: this.boxes };
  }

  private updateStandings(): void {
    const racers = this.racingPlayers();
    racers.sort((a, b) => {
      const ra = a.race!;
      const rb = b.race!;
      if (ra.finishTimeMs !== null && rb.finishTimeMs !== null) return ra.finishTimeMs - rb.finishTimeMs;
      if (ra.finishTimeMs !== null) return -1;
      if (rb.finishTimeMs !== null) return 1;
      return rb.metric - ra.metric;
    });
    racers.forEach((p, i) => (p.race!.place = i + 1));
  }

  private checkRaceEnd(): void {
    if (this.phase !== 'racing') return;
    const racers = this.racingPlayers().filter((p) => this.players.has(p.id));
    const unfinished = racers.filter((p) => p.race!.finishTimeMs === null);
    const now = Date.now();
    const timeUp = this.finishDeadline !== null && now >= this.finishDeadline;
    if (racers.length === 0 || unfinished.length === 0 || timeUp) this.endRace();
  }

  private endRace(): void {
    this.updateStandings();
    this.stopTimers();
    this.phase = 'results';
    const racers = this.racingPlayers().sort((a, b) => a.race!.place - b.race!.place);
    this.results = racers.map((p) => {
      const r = p.race!;
      if (r.finishTimeMs === null) p.status = 'dnf';
      return {
        playerId: p.id,
        name: p.name,
        color: p.color,
        place: r.place,
        finishTimeMs: r.finishTimeMs,
        lapsDone: Math.min(TOTAL_LAPS, r.lap - 1),
      };
    });
    const winner = racers[0];
    if (winner && winner.race!.finishTimeMs !== null) winner.wins += 1;
    this.log(`race #${this.raceNumber} finished: ${this.results.map((r) => `${r.place}. ${r.name}`).join(', ')}`);
    // Final snapshot so late frames agree on positions, then the state change.
    this.io.to(this.code).emit('race:snapshot', this.snapshot(Date.now()));
    this.broadcastState();
  }

  // ------------------------------------------------------------- kart input

  onKartState(player: Player, msg: KartStateMsg): void {
    const r = player.race;
    if (!r || (this.phase !== 'racing' && this.phase !== 'countdown')) return;
    if (!isFiniteMsg(msg)) return;
    const now = Date.now();
    r.lastStateAt = now;
    r.kart.x = msg.x;
    r.kart.y = msg.y;
    r.kart.z = msg.z;
    r.kart.yaw = msg.yaw;
    r.kart.v = msg.v;
    r.kart.f = msg.f;
    r.kart.d = msg.d;
    if (this.phase !== 'racing' || r.finishTimeMs !== null) return;

    const proj = projectToTrack(TRACK, msg, r.hint, SERVER_WINDOW);
    if (proj.distance > MAX_OFF_TRACK) return; // not on any track we can see from here
    // Only a kart actually on (or just above) the road surface can make progress.
    const onSurface = msg.y > proj.groundY - 3 && msg.y < proj.groundY + 12;
    const delta = progressDelta(N, r.hint, proj.progress);
    r.lateral = proj.lateral;
    if (delta > 0 && delta < SERVER_WINDOW && onSurface && Math.abs(proj.lateral) < TRACK.shoulderHalfWidth + 3) {
      // cross every checkpoint that lies in (hint, hint + delta], in order
      let guard = 0;
      while (guard++ < TRACK.checkpoints.length) {
        const cp = TRACK.checkpoints[r.nextCp];
        const toCp = progressDelta(N, r.hint, cp.index);
        if (toCp > 0 && toCp <= delta) {
          this.crossCheckpoint(player, now);
          if (r.finishTimeMs !== null) break;
        } else break;
      }
      r.hint = proj.progress;
    } else if (delta <= 0 && delta > -SERVER_WINDOW) {
      // moving backwards is fine, it just never counts
      r.hint = proj.progress;
    } else if (Math.abs(delta) >= SERVER_WINDOW) {
      // Too big a jump to trust: keep the old hint (the client will respawn if it fell).
    }
    r.metric = this.metricFor(r);

    // items & hazards
    this.checkItemBoxes(player, msg);
    this.checkHoneys(player, msg, now);
  }

  private metricFor(r: RaceData): number {
    const cpIndex = TRACK.checkpoints[r.lastCp].index;
    const d = progressDelta(N, cpIndex, r.hint);
    return (r.lap - 1) * N + cpIndex + d;
  }

  private crossCheckpoint(player: Player, now: number): void {
    const r = player.race!;
    r.lastCp = r.nextCp;
    r.nextCp = (r.nextCp + 1) % TRACK.checkpoints.length;
    this.emitEvent({ type: 'checkpoint', playerId: player.id, cp: r.lastCp });
    if (r.lastCp === 0) {
      // crossed the finish line with every checkpoint collected
      r.lap += 1;
      if (r.lap > TOTAL_LAPS) {
        r.lap = TOTAL_LAPS + 1;
        r.finishTimeMs = now - (this.raceStartAt ?? now);
        this.finishOrder += 1;
        player.status = 'finished';
        this.emitEvent({ type: 'finish', playerId: player.id, place: this.finishOrder, timeMs: r.finishTimeMs });
        if (this.finishDeadline === null) this.finishDeadline = now + FINISH_GRACE_MS;
        this.broadcastState();
      } else {
        this.emitEvent({ type: 'lap', playerId: player.id, lap: r.lap });
      }
    }
  }

  onRespawn(player: Player, ack: (r: RespawnAck) => void): void {
    const r = player.race;
    if (!r) {
      const g = startGridSlot(TRACK, player.slot);
      return ack({ x: g.pos.x, y: g.pos.y, z: g.pos.z, yaw: g.yaw, index: g.index });
    }
    const cp = TRACK.checkpoints[r.lastCp];
    // a couple of metres past the checkpoint so it is never re-counted
    const idx = (cp.index + 3) % N;
    const pos = trackPoint(TRACK, idx, 0, 0.2);
    r.hint = idx;
    r.lateral = 0;
    r.kart.x = pos.x;
    r.kart.y = pos.y;
    r.kart.z = pos.z;
    r.kart.v = 0;
    r.metric = this.metricFor(r);
    this.emitEvent({ type: 'respawn', playerId: player.id });
    ack({ x: pos.x, y: pos.y, z: pos.z, yaw: trackYaw(TRACK, idx), index: idx });
  }

  // ------------------------------------------------------------------ items

  private checkItemBoxes(player: Player, msg: KartStateMsg): void {
    const r = player.race!;
    if (r.item !== null) return;
    for (const box of TRACK.itemBoxes) {
      const bit = 1 << box.id;
      if (!(this.boxes & bit)) continue;
      const dx = msg.x - box.x;
      const dz = msg.z - box.z;
      const dy = msg.y + 1 - box.y;
      if (dx * dx + dz * dz < 2.8 * 2.8 && Math.abs(dy) < 3.5) {
        this.boxes &= ~bit;
        const timer = setTimeout(() => {
          this.boxes |= bit;
        }, ITEM_BOX_RESPAWN_MS);
        this.boxTimers.push(timer);
        r.item = this.rollItem(r.place);
        this.emitEvent({ type: 'pickup', playerId: player.id, item: r.item });
        return;
      }
    }
  }

  private rollItem(place: number): ItemKind {
    const racers = this.racingPlayers().length;
    const behind = racers > 1 ? (place - 1) / (racers - 1) : 0; // 0 = leader, 1 = last
    const roll = Math.random();
    if (behind < 0.34) return roll < 0.35 ? 'nectar' : roll < 0.9 ? 'honey' : 'wasp';
    if (behind < 0.67) return roll < 0.4 ? 'nectar' : roll < 0.65 ? 'honey' : 'wasp';
    return roll < 0.45 ? 'nectar' : roll < 0.55 ? 'honey' : 'wasp';
  }

  onItemUse(player: Player): void {
    const r = player.race;
    if (!r || this.phase !== 'racing' || r.item === null || r.finishTimeMs !== null) return;
    const item = r.item;
    r.item = null;
    const now = Date.now();
    switch (item) {
      case 'nectar':
        break; // the owner's client applies the boost; everyone sees the flag
      case 'honey': {
        if (this.honeys.length >= HONEY.maxPerRoom) this.honeys.shift();
        const fx = -Math.sin(r.kart.yaw);
        const fz = -Math.cos(r.kart.yaw);
        this.honeys.push({
          id: this.nextEntityId++,
          x: r.kart.x - fx * 3.5,
          y: r.kart.y,
          z: r.kart.z - fz * 3.5,
          ownerId: player.id,
          bornAt: now,
        });
        break;
      }
      case 'wasp': {
        const target = this.racingPlayers()
          .filter((p) => p.id !== player.id && p.race!.finishTimeMs === null && p.connected)
          .map((p) => ({ p, ahead: p.race!.metric - r.metric }))
          .filter((e) => e.ahead > 0)
          .sort((a, b) => a.ahead - b.ahead)[0];
        const w: Wasp = {
          id: this.nextEntityId++,
          progress: r.hint + 4,
          lateral: r.lateral,
          shooterId: player.id,
          targetId: target?.p.id ?? null,
          bornAt: now,
          x: r.kart.x,
          y: r.kart.y + 1.2,
          z: r.kart.z,
          yaw: r.kart.yaw,
        };
        this.wasps.push(w);
        break;
      }
    }
    this.emitEvent({ type: 'itemUsed', playerId: player.id, item });
  }

  private updateWasps(dt: number, now: number): void {
    const racers = this.racingPlayers();
    for (const w of [...this.wasps]) {
      if (now - w.bornAt > WASP.lifetimeMs) {
        this.wasps.splice(this.wasps.indexOf(w), 1);
        continue;
      }
      w.progress = (w.progress + (WASP.speed * dt * N) / TRACK.length) % N;
      const target = w.targetId ? this.players.get(w.targetId) : undefined;
      let desiredLateral = 0;
      if (target?.race) {
        desiredLateral = Math.max(-TRACK.halfWidth, Math.min(TRACK.halfWidth, target.race.lateral));
      }
      w.lateral += (desiredLateral - w.lateral) * Math.min(1, dt * 3);
      const pos = trackPoint(TRACK, w.progress, w.lateral, 1.1);
      w.yaw = trackYaw(TRACK, w.progress);
      w.x = pos.x;
      w.y = pos.y;
      w.z = pos.z;
      for (const p of racers) {
        const r = p.race!;
        if (r.finishTimeMs !== null) continue;
        if (p.id === w.shooterId && now - w.bornAt < WASP.armDelayMs) continue;
        if (now - r.lastHitAt < 2000) continue;
        const d = Math.hypot(r.kart.x - w.x, r.kart.y + 0.8 - w.y, r.kart.z - w.z);
        if (d < WASP.hitRadius) {
          this.wasps.splice(this.wasps.indexOf(w), 1);
          r.lastHitAt = now;
          this.emitEvent({ type: 'hit', playerId: p.id, by: 'wasp', fromId: w.shooterId });
          break;
        }
      }
    }
  }

  private checkHoneys(player: Player, msg: KartStateMsg, now: number): void {
    const r = player.race!;
    if (now - r.lastHitAt < 2000) return;
    if (msg.f & KART_FLAG_SPIN) return;
    for (const h of this.honeys) {
      if (now - h.bornAt > HONEY.lifetimeMs) continue;
      // the dropper gets a moment to drive away from their own puddle
      if (h.ownerId === player.id && now - h.bornAt < 1500) continue;
      const dx = msg.x - h.x;
      const dz = msg.z - h.z;
      if (dx * dx + dz * dz < HONEY.radius * HONEY.radius && Math.abs(msg.y - h.y) < 2.5) {
        this.honeys.splice(this.honeys.indexOf(h), 1);
        r.lastHitAt = now;
        this.emitEvent({ type: 'hit', playerId: player.id, by: 'honey', fromId: h.ownerId });
        return;
      }
    }
    // prune stale puddles
    this.honeys = this.honeys.filter((h) => now - h.bornAt <= HONEY.lifetimeMs);
  }

  // ------------------------------------------------------------------ state

  toState(): RoomState {
    const players: PlayerPublic[] = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        slot: p.slot,
        connected: p.connected,
        status: p.status,
        lap: p.race ? Math.min(TOTAL_LAPS, p.race.lap) : 0,
        place: p.race ? p.race.place : 0,
        finishTimeMs: p.race?.finishTimeMs ?? null,
        wins: p.wins,
      }));
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      players,
      raceStartAt: this.raceStartAt,
      raceNumber: this.raceNumber,
      results: this.results,
      totalLaps: TOTAL_LAPS,
      maxPlayers: MAX_PLAYERS,
    };
  }

  broadcastState(): void {
    this.io.to(this.code).emit('room:state', this.toState());
  }

  destroy(): void {
    this.stopTimers();
    for (const p of this.players.values()) {
      p.socket?.leave(this.code);
    }
    this.players.clear();
  }
}

function isFiniteMsg(m: KartStateMsg): boolean {
  return (
    typeof m === 'object' &&
    m !== null &&
    Number.isFinite(m.x) &&
    Number.isFinite(m.y) &&
    Number.isFinite(m.z) &&
    Number.isFinite(m.yaw) &&
    Number.isFinite(m.v) &&
    Number.isFinite(m.f) &&
    Number.isFinite(m.d) &&
    Math.abs(m.x) < 5000 &&
    Math.abs(m.y) < 5000 &&
    Math.abs(m.z) < 5000
  );
}
