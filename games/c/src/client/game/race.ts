import * as THREE from 'three';
import {
  CHARACTERS,
  TOTAL_LAPS,
  type Phase,
  type RaceSnapshot,
  type RaceStartMsg,
  type ResultsMsg,
  type RoomView,
  type StateBatch,
  type FxMsg,
  type ItemKind,
  type KartState as KST,
} from '../../shared/protocol';
import { CP_COUNT, Track } from './track';
import { buildWorld } from './world';
import { OwnKart, RemoteKart, type KartInput } from './kart';
import { Items } from './items';
import { Hud, ITEM_META, placeSuffix } from './hud';
import { AudioEngine } from './audio';
import { Input } from './input';
import type { Net } from '../net';

const RENDER_DELAY = 130;
const STEP = 1 / 60;

export interface SessionOpts {
  canvas: HTMLCanvasElement;
  net: Net;
  meId: string;
  players: Map<string, { name: string; character: number }>;
  roomCode: string;
  audio: AudioEngine;
  clockOffset: number;
  onResults: (rows: import('../../shared/protocol').ResultRow[]) => void;
  onLeftRace: () => void;
}

export class GameSession {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private track = new Track();
  private world: { update: (t: number, dt: number) => void };
  private items: Items;
  private hud: Hud;
  private input: Input;
  private net: Net;
  private opts: SessionOpts;

  private remotes = new Map<string, RemoteKart>();
  private me: OwnKart;
  private kartRoot = new THREE.Group();

  // race progression
  private lap = 0;
  private cps = 0;
  private virtP = -0.004;
  private prevP = 0;
  private nextBoundary = 0;
  private progressBlocked = false;

  private phase: Phase = 'lobby';
  private startAt = 0;
  private locked = true;
  private sawCountdown = false;
  private finished = false;
  private myItem: ItemKind | null = null;
  private stateTimer = 0;
  private raf = 0;
  private ticker: number | null = null; // setInterval fallback when rAF stalls
  private watchdog: number | null = null;
  private lastTickAt = 0;
  private lastT = 0;
  private accum = 0;
  private disposed = false;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private countdownLast: string | null = null;
  private airTime = 0;
  private maxAirHeight = 0;
  private standingsPlayers: Map<string, { name: string; character: number }>;

  constructor(opts: SessionOpts) {
    this.opts = opts;
    this.net = opts.net;
    this.standingsPlayers = opts.players;

    this.renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(66, 1, 0.1, 900);
    this.scene.add(this.kartRoot);
    this.world = buildWorld(this.scene, this.track);
    this.items = new Items(this.scene, this.track);
    this.hud = new Hud(this.track.samples.map((s) => ({ x: s.x, z: s.z })));

    this.me = new OwnKart(
      opts.players.get(opts.meId)?.character ?? 0,
      opts.players.get(opts.meId)?.name ?? 'You'
    );
    this.kartRoot.add(this.me.group);

    this.input = new Input((a) => {
      if (a === 'item') this.useItem();
      else if (a === 'respawn') this.manualRespawn();
      else if (a === 'mute') {
        opts.audio.setMuted(!opts.audio.muted);
        this.hud.notify(opts.audio.muted ? '🔇 Muted' : '🔊 Sound on');
      }
    });

    this.resize();
    window.addEventListener('resize', this.resize);
    // debug/testing handle (used by automated browser tests)
    (window as unknown as { __hr: unknown }).__hr = {
      meId: opts.meId,
      character: opts.players.get(opts.meId)?.character,
      samples: this.track.samples
        .filter((_, i) => i % 12 === 0)
        .map((s) => [Math.round(s.x * 10) / 10, Math.round(s.z * 10) / 10, s.road ? 1 : 0, Math.round(s.y * 100) / 100]),
      probe: (x: number, z: number) => {
        const g = this.track.groundAt(x, z, 50);
        return {
          ground: Math.round(g.h * 100) / 100,
          surface: g.surface,
          terrain: Math.round(this.track.terrainAt(x, z) * 100) / 100,
        };
      },
      getKart: () => ({
        x: Math.round(this.me.x * 10) / 10,
        y: Math.round(this.me.y * 10) / 10,
        z: Math.round(this.me.z * 10) / 10,
        yaw: Math.round((this.me.yaw * 180) / Math.PI),
        speed: Math.round(this.me.speed * 10) / 10,
        grounded: this.me.grounded,
        lap: this.lap,
        cps: this.cps,
        phase: this.phase,
        locked: this.locked,
        throttle: this.input.throttle,
        surface: this.track.groundAt(this.me.x, this.me.z, this.me.y).surface,
        drifting: this.me.drifting,
        boostT: Math.round(this.me.boostT * 10) / 10,
        airSec: Math.round(this.airTime * 10) / 10,
        maxAirHeight: Math.round(this.maxAirHeight * 10) / 10,
        item: this.myItem,
      }),
    };
    this.lastT = performance.now();
    this.lastTickAt = this.lastT;
    this.raf = requestAnimationFrame(this.frame);
    document.addEventListener('visibilitychange', this.handleVisibility);
    window.addEventListener('focus', this.handleVisibility);
    // Chromium pauses rAF entirely for occluded windows (page still reports
    // "visible"). A timer watchdog takes over the loop when rAF stalls.
    this.watchdog = window.setInterval(() => {
      if (this.disposed) return;
      if (performance.now() - this.lastTickAt > 1500 && this.ticker === null) {
        cancelAnimationFrame(this.raf);
        this.ticker = window.setInterval(() => this.tick(performance.now()), 16);
      }
    }, 1000);
  }

  private handleVisibility = (): void => {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
      this.lastT = performance.now();
      this.lastTickAt = this.lastT;
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  // ---------------- lifecycle ----------------

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.ticker !== null) clearInterval(this.ticker);
    if (this.watchdog !== null) clearInterval(this.watchdog);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    window.removeEventListener('focus', this.handleVisibility);
    window.removeEventListener('resize', this.resize);
    this.input.dispose();
    this.hud.dispose();
    this.renderer.dispose();
  }

  handleRoom(view: RoomView): void {
    this.standingsPlayers = new Map(view.players.map((p) => [p.id, { name: p.name, character: p.character }]));
    if (view.phase === 'results' && view.results) {
      this.showResults(view.results);
    }
    if ((view.phase === 'lobby') && this.phase !== 'lobby') {
      this.hud.show(false);
    }
    this.phase = view.phase;
  }

  // ---------------- race flow ----------------

  startRace(msg: RaceStartMsg): void {
    this.phase = 'countdown';
    this.sawCountdown = true;
    this.startAt = msg.startAt;
    this.lap = 0;
    this.cps = 0;
    this.virtP = -0.004;
    this.nextBoundary = 0;
    this.finished = false;
    this.locked = true;
    this.myItem = null;
    this.hud.item(null);
    this.hud.laps(TOTAL_LAPS);
    this.hud.show(true);
    this.items.clearTransient();

    // rebuild kart set from the grid
    for (const r of this.remotes.values()) this.kartRoot.remove(r.group);
    this.remotes.clear();
    for (const slot of msg.grid) {
      if (slot.id === this.opts.meId) continue;
      const info = this.standingsPlayers.get(slot.id);
      const rk = new RemoteKart(info?.character ?? 0, info?.name ?? '???');
      this.remotes.set(slot.id, rk);
      this.kartRoot.add(rk.group);
    }
    // grid placement
    for (const slot of msg.grid) {
      const arcBehind = 6 + Math.floor(slot.slot / 2) * 3.6;
      const lat = slot.slot % 2 === 0 ? -2.4 : 2.4;
      const arc = this.track.length - arcBehind;
      const pt = this.track.pointAtArc(arc);
      const px = -pt.tz;
      const pz = pt.tx;
      const x = pt.x + px * lat;
      const z = pt.z + pz * lat;
      const yaw = Math.atan2(pt.tx, pt.tz);
      if (slot.id === this.opts.meId) {
        this.me.placeAtGrid(x, pt.y + 0.2, z, yaw);
        const pi = this.track.progressAt(x, z, pt.y + 0.2);
        this.prevP = pi ? pi.p : 0.995;
        this.virtP = this.prevP - 1;
      } else {
        const rk = this.remotes.get(slot.id);
        if (rk) {
          rk.group.position.set(x, pt.y + 0.2, z);
          rk.group.rotation.y = yaw;
        }
      }
    }
    this.camInit = false;
    this.hud.notify(`Room ${this.opts.roomCode} — ${msg.grid.length} racers, ${TOTAL_LAPS} laps!`, true);
  }

  applySnapshot(snap: RaceSnapshot): void {
    // reconnecting mid-race: restore progression and world state
    this.startAt = snap.startAt;
    this.phase = 'racing';
    this.finished = false;
    this.locked = false;
    this.items.clearTransient();
    for (const b of snap.boxes) this.items.setBoxCooldown(b.box, b.until);
    for (const s of snap.slicks) this.items.addSlick(s);
    for (const p of snap.projs) this.items.addProj(p);
    for (const f of snap.finished) {
      const info = this.standingsPlayers.get(f.id);
      this.hud.notify(`${info?.name ?? 'Racer'} finished ${placeSuffix(f.place)}!`, f.place <= 3);
    }

    this.lap = snap.yourLap;
    this.cps = snap.yourCps;
    this.myItem = snap.yourItem;
    this.hud.item(snap.yourItem);
    this.hud.laps(TOTAL_LAPS);
    this.hud.lap(this.lap + 1);

    const cpIndex = Math.max(0, Math.min(CP_COUNT - 1, this.cps));
    this.me.respawnAt(this.track, cpIndex);
    this.me.tpCounter++;
    const pi = this.track.progressAt(this.me.x, this.me.z, this.me.y);
    this.prevP = pi ? pi.p : 0;
    this.nextBoundary = (this.lap * CP_COUNT + this.cps + 1) / CP_COUNT;
    this.virtP = (this.lap * CP_COUNT + this.cps) / CP_COUNT + 0.004;
    this.hud.show(true);
    this.hud.notify('Reconnected — back in the race!', true);
  }

  private showResults(rows: import('../../shared/protocol').ResultRow[]): void {
    this.finished = true;
    this.locked = true;
    this.hud.results(rows, this.opts.meId);
    this.opts.onResults(rows);
  }

  // ---------------- network events ----------------

  onStateBatch(b: StateBatch): void {
    if (this.phase !== 'racing' && this.phase !== 'countdown') return;
    const now = Date.now();
    for (const s of b.p) {
      if (s.id === this.opts.meId) continue;
      const rk = this.remotes.get(s.id);
      if (rk) rk.push(s, now);
    }
    this.hud.standings(b, this.opts.meId, this.standingsPlayers);
    const myPlace = b.order.indexOf(this.opts.meId);
    if (myPlace >= 0) this.hud.place(myPlace + 1, Math.max(b.order.length, this.remotes.size + 1));
  }

  onEvent(ev: { ev: string; payload: any }): void {
    const p = ev.payload;
    switch (ev.ev) {
      case 'box':
        this.items.setBoxCooldown(p.box, p.until);
        break;
      case 'item':
        this.myItem = p.kind;
        this.hud.item(p.kind);
        this.opts.audio.pickup();
        this.hud.notify(`${ITEM_META[p.kind as ItemKind].icon} ${ITEM_META[p.kind as ItemKind].label} — press E`);
        break;
      case 'slick':
        this.items.addSlick(p);
        break;
      case 'proj':
        this.items.addProj(p);
        if (p.owner !== this.opts.meId) this.opts.audio.rocketFire();
        break;
      case 'gone':
        this.items.removeProj(p.proj);
        break;
      case 'fx':
        this.handleFx(p as FxMsg);
        break;
      case 'finish': {
        const info = this.standingsPlayers.get(p.id);
        if (p.id !== this.opts.meId) {
          this.hud.notify(`${info?.name ?? 'Racer'} finished ${placeSuffix(p.place)}!`, p.place <= 3);
        }
        break;
      }
      case 'results':
        this.showResults(p.rows as ResultsMsg['rows']);
        break;
      case 'shutdown':
        this.opts.onLeftRace();
        break;
    }
  }

  private handleFx(p: FxMsg): void {
    if (p.proj !== undefined) this.items.removeProj(p.proj);
    if (p.kart === this.opts.meId) {
      if (p.kind === 'spin') {
        this.me.spinOut();
        this.opts.audio.hit();
        this.hud.notify('🌽 Spun out!');
      } else if (p.kind === 'slip') {
        this.me.slip();
        this.opts.audio.hit();
        this.hud.notify('🍯 Sticky honey!');
      }
      return;
    }
    const rk = this.remotes.get(p.kart);
    if (!rk) return;
    if (p.kind === 'spin') rk.spinUntil = p.until;
    else if (p.kind === 'slip') rk.slipUntil = p.until;
  }

  // ---------------- own kart logic ----------------

  private useItem(): void {
    if (!this.myItem || this.locked || this.finished) return;
    const kind = this.myItem;
    if (kind === 'boost') {
      this.me.applyBoost(2.0);
      this.opts.audio.boost();
      this.hud.notify('🧃 Cider turbo!');
    } else {
      const fx = Math.sin(this.me.yaw);
      const fz = Math.cos(this.me.yaw);
      this.net.useItem({
        kind,
        x: kind === 'slick' ? this.me.x - fx * 3 : this.me.x + fx * 2.5,
        y: this.me.y,
        z: kind === 'slick' ? this.me.z - fz * 3 : this.me.z + fz * 2.5,
        yaw: this.me.yaw,
      });
      if (kind === 'slick') {
        this.opts.audio.drop();
        this.hud.notify('🍯 Honey dropped!');
      } else {
        this.opts.audio.rocketFire();
        this.hud.notify('🌽 Corn Cobber away!');
      }
    }
    this.myItem = null;
    this.hud.item(null);
  }

  private manualRespawn(): void {
    if (this.locked || this.finished) return;
    const idx = Math.max(0, Math.min(CP_COUNT - 1, this.cps));
    this.me.respawnAt(this.track, idx);
    this.me.tpCounter++;
    this.resyncProgress();
    this.opts.audio.drop();
  }

  private autoRespawn(reason: string): void {
    const idx = Math.max(0, Math.min(CP_COUNT - 1, this.cps));
    this.me.respawnAt(this.track, idx);
    this.me.tpCounter++;
    this.resyncProgress();
    this.opts.audio.splash();
    this.hud.notify(reason);
  }

  /** After a teleport, re-anchor lap progression to the respawn point. */
  private resyncProgress(): void {
    const pi = this.track.progressAt(this.me.x, this.me.z, this.me.y);
    const boundary = (this.lap * CP_COUNT + this.cps) / CP_COUNT;
    this.virtP = boundary + 0.004;
    this.prevP = pi ? pi.p : (boundary % 1);
    this.progressBlocked = false;
  }

  private kartCollisions(): void {
    for (const rk of this.remotes.values()) {
      const rp = rk.group.position;
      const dx = this.me.x - rp.x;
      const dz = this.me.z - rp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1.9 * 1.9 && d2 > 0.0001 && this.me.ghostT <= 0) {
        const d = Math.sqrt(d2);
        const push = (1.9 - d) / 2;
        this.me.x += (dx / d) * push;
        this.me.z += (dz / d) * push;
        this.me.speed *= 0.965;
      }
    }
  }

  private updateProgress(): void {
    const pi = this.track.progressAt(this.me.x, this.me.z, this.me.y);
    if (!pi) {
      this.progressBlocked = true;
      return;
    }
    if (this.progressBlocked) {
      // returning to the road after being far off: only re-anchor when close
      // to our expected position along the loop
      this.progressBlocked = false;
      this.prevP = pi.p;
      return;
    }
    let d = pi.p - this.prevP;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    if (Math.abs(d) >= 0.08) {
      // teleport-sized jump (shouldn't happen; ignore for safety)
      this.prevP = pi.p;
      return;
    }
    this.prevP = pi.p;
    this.virtP += d;
    while (this.virtP >= this.nextBoundary - 1e-9) {
      const boundaryIndex = Math.round(this.nextBoundary * CP_COUNT) % CP_COUNT;
      if (boundaryIndex === 0) {
        // a lap completes after collecting every boundary since the last
        // finish-line crossing (CP_COUNT - 1 checkpoints: 1..11)
        if (this.cps >= CP_COUNT - 1) {
          this.lap++;
          this.cps = 0;
          if (this.lap >= TOTAL_LAPS) {
            this.onFinished();
          } else if (this.lap === TOTAL_LAPS - 1) {
            this.hud.notify('FINAL LAP!', true, 3000);
            this.opts.audio.finalLap();
          } else {
            this.hud.notify(`Lap ${this.lap + 1} of ${TOTAL_LAPS}`, true);
            this.opts.audio.lap();
          }
          this.hud.lap(this.lap + 1);
        }
        // crossing the line without a full set (start of race or wrong way)
        // never counts as a lap
      } else if (boundaryIndex === this.cps + 1) {
        this.cps = boundaryIndex;
      }
      this.nextBoundary += 1 / CP_COUNT;
    }
  }

  private onFinished(): void {
    this.finished = true;
    this.locked = true;
    this.net.finish({ lap: TOTAL_LAPS });
    this.hud.banner('Finished!', 4000);
    this.hud.notify('Waiting for the rest of the field…', false, 60000);
  }

  private currentProg(): number {
    const frac = (this.virtP * CP_COUNT) % 1;
    return frac < 0 ? frac + 1 : frac;
  }

  // ---------------- main loop ----------------

  private frame = (t: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    this.tick(t);
  };

  private tick(t: number): void {
    if (this.disposed) return;
    this.lastTickAt = performance.now();
    let dt = (t - this.lastT) / 1000;
    this.lastT = t;
    if (dt > 0.25) dt = 0.25;
    const now = Date.now();
    const serverNow = now + this.opts.clockOffset;

    // countdown handling
    if (this.phase === 'racing' && this.locked && this.sawCountdown && !this.finished) {
      // the server's room broadcast can flip the phase to 'racing' before our
      // local countdown display reaches zero — unlock regardless
      this.locked = false;
      this.hud.countdown('GO!');
      this.opts.audio.countdownTick(true);
      window.setTimeout(() => this.hud.countdown(null), 800);
      this.countdownLast = null;
    }
    if (this.phase === 'countdown') {
      const remain = (this.startAt - serverNow) / 1000;
      if (remain <= 0) {
        this.phase = 'racing';
        this.locked = false;
        this.hud.countdown('GO!');
        this.opts.audio.countdownTick(true);
        window.setTimeout(() => this.hud.countdown(null), 800);
        this.countdownLast = null;
      } else {
        const n = Math.ceil(remain);
        const dispStr = String(Math.min(3, n));
        if (dispStr !== this.countdownLast) {
          this.countdownLast = dispStr;
          this.hud.countdown(dispStr);
          this.opts.audio.countdownTick(false);
        }
      }
    }

    // fixed-step physics for my kart
    const input: KartInput = this.locked
      ? { throttle: 0, brake: 0, steer: 0, drift: false }
      : this.input;
    this.accum += dt;
    let steps = 0;
    while (this.accum >= STEP && steps < 5) {
      this.accum -= STEP;
      steps++;
      const preSpin = this.me.spinT;
      this.me.update(STEP, input, this.track, this.locked && !this.finished, (e, data) => {
        if (e === 'splash') this.autoRespawn('💦 Splashed! Back to the track.');
        else if (e === 'land') this.opts.audio.land();
        else if (e === 'hop') this.opts.audio.hop();
        else if (e === 'stuck') this.hud.notify('Stuck? Press R to respawn');
        else if (e === 'stuckAuto') this.autoRespawn('🚜 Recovered to the track.');
        else if (e === 'boost') this.opts.audio.boostTier(data ?? 1);
      });
      if (preSpin > 0 && this.me.spinT === 0) {
        /* spin finished */
      }
      if (!this.locked) {
        this.kartCollisions();
        // airtime telemetry (jump verification)
        if (!this.me.grounded) {
          this.airTime += STEP;
          const g = this.track.groundAt(this.me.x, this.me.z, this.me.y + 5).h;
          this.maxAirHeight = Math.max(this.maxAirHeight, this.me.y - g);
        }
        // pickups
        const box = this.items.hitBox(this.me.x, this.me.y, this.me.z, now);
        if (box >= 0 && !this.myItem) {
          void this.net.pickup({ box }).then((ack) => {
            if (ack.ok) this.items.setBoxCooldown(box, ack.cooldownUntil ?? Date.now() + 3500);
          });
        }
        if (this.items.hitPad(this.me.x, this.me.z, now)) {
          this.me.applyBoost(1.3);
          this.opts.audio.pad();
        }
        const slick = this.items.hitSlick(this.me.x, this.me.z);
        if (slick !== null && this.me.slipT <= 0 && this.me.ghostT <= 0 && this.me.spinT <= 0) {
          this.me.slip();
          this.net.hit({ kind: 'slip' });
          this.opts.audio.hit();
          this.hud.notify('🍯 Sticky honey!');
        }
        const projHit = this.items.updateProjectiles(STEP, now, {
          x: this.me.x,
          y: this.me.y,
          z: this.me.z,
        });
        if (projHit !== null && this.me.ghostT <= 0) {
          this.items.removeProj(projHit);
          this.me.spinOut();
          this.net.hit({ kind: 'spin', proj: projHit });
        }
        this.updateProgress();
      } else {
        this.items.updateProjectiles(STEP, now, null);
      }
    }

    // send my state at 15 Hz
    this.stateTimer += dt;
    if (this.stateTimer > 1 / 15 && (this.phase === 'racing' || this.phase === 'countdown')) {
      this.stateTimer = 0;
      const st: KST = this.me.toState(this.opts.meId, this.lap, this.cps, this.currentProg());
      this.net.sendState(st);
    }

    // remote interpolation + fx
    const renderTime = now - RENDER_DELAY;
    for (const rk of this.remotes.values()) {
      rk.update(renderTime, this.track);
      const nowMs = Date.now();
      if (nowMs < rk.spinUntil) rk.body.rotation.y = Math.sin((rk.spinUntil - nowMs) * 0.012) * 2.6;
      else rk.body.rotation.y = 0;
      rk.flame.visible = rk.boosting;
    }

    // HUD
    if (this.phase === 'racing' || this.phase === 'countdown' || this.phase === 'results') {
      this.hud.time(serverNow - this.startAt);
      this.hud.speed(this.me.speed);
      this.hud.beginMap();
      this.hud.minimapDot(this.me.x, this.me.z, '#ff8a2a', true, this.me.yaw);
      for (const [id, rk] of this.remotes) {
        const info = this.standingsPlayers.get(id);
        const color = info ? `#${(CHARACTERS[info.character]?.color ?? 0x888888).toString(16).padStart(6, '0')}` : '#888';
        const p = rk.group.position;
        this.hud.minimapDot(p.x, p.z, color, false);
      }
    }

    this.updateCamera(dt);
    this.world.update(t, dt);
    this.opts.audio.engine(this.me.speed, input.throttle, this.me.drifting);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(dt: number): void {
    const yaw = this.me.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const speedFrac = Math.min(Math.abs(this.me.speed) / 26, 1.3);
    const dist = 7.6 + speedFrac * 1.4;
    const height = 3.4;
    const target = new THREE.Vector3(
      this.me.x - fx * dist,
      this.me.y + height + Math.min(this.me.vy * 0.12, 2),
      this.me.z - fz * dist
    );
    const look = new THREE.Vector3(this.me.x + fx * 5, this.me.y + 1.2, this.me.z + fz * 5);

    if (!this.camInit) {
      // countdown showcase: sweep from a front-side angle into the chase cam
      this.camPos.set(this.me.x + fx * 9, this.me.y + 2.2, this.me.z + fz * 9);
      this.camLook.copy(look);
      this.camInit = true;
    }
    const kPos = 1 - Math.exp(-dt * 7);
    const kY = 1 - Math.exp(-dt * 5);
    this.camPos.x += (target.x - this.camPos.x) * kPos;
    this.camPos.z += (target.z - this.camPos.z) * kPos;
    this.camPos.y += (target.y - this.camPos.y) * kY;
    this.camLook.lerp(look, 1 - Math.exp(-dt * 10));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    const targetFov = 64 + speedFrac * 14;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();
  }
}
