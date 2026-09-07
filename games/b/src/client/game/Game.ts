import * as THREE from 'three';
import { COUNTDOWN_MS, KART, TOTAL_LAPS, type ItemKind } from '../../shared/constants.ts';
import {
  KART_FLAG_AIR,
  KART_FLAG_BOOST,
  KART_FLAG_BRAKE,
  KART_FLAG_SPIN,
  type KartNet,
  type KartStateMsg,
  type PlayerPublic,
  type RaceEvent,
  type RespawnAck,
  type Snapshot,
  type StandingNet,
} from '../../shared/protocol.ts';
import { TRACK, projectToTrack, startGridSlot, trackPoint, wrapIndex } from '../../shared/track.ts';
import { GameAudio } from './Audio.ts';
import { Hud, ordinal, type StandingRow } from './Hud.ts';
import { Input } from './Input.ts';
import { ItemVisuals } from './Items.ts';
import { KartMesh } from './KartMesh.ts';
import { LocalKart } from './KartPhysics.ts';
import { buildScenery } from './Scenery.ts';
import { buildTrackMesh, type TrackVisual } from './TrackMesh.ts';

export interface GameCallbacks {
  sendKart(msg: KartStateMsg): void;
  requestRespawn(): Promise<RespawnAck>;
  useItem(): void;
  serverNow(): number;
  onLocalFinished(place: number): void;
}

export type GameMode = 'idle' | 'race' | 'spectate';

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  v: number;
  f: number;
  d: number;
}

class RemoteKart {
  mesh: KartMesh;
  buffer: Sample[] = [];
  pos = new THREE.Vector3();
  yaw = 0;
  v = 0;
  f = 0;
  d = 0;
  hint = -1;
  groundY = 0;
  lastSeen = 0;
  spinAngle = 0;
  constructor(
    public id: string,
    public name: string,
    public color: string,
  ) {
    this.mesh = new KartMesh(color, name, false);
  }
}

const SEND_INTERVAL = 1000 / 20;
const INTERP_DELAY_MS = 120;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly hud: Hud;
  readonly audio = new GameAudio();
  readonly input = new Input();
  readonly kart: LocalKart;
  mode: GameMode = 'idle';
  autopilot = false;
  localId = '';
  private localMesh: KartMesh | null = null;
  private localColor = '#ffb703';
  private localName = 'You';
  private remotes = new Map<string, RemoteKart>();
  private players = new Map<string, PlayerPublic>();
  private items = new ItemVisuals();
  private trackVisual: TrackVisual;
  private sun: THREE.DirectionalLight;
  private timer = new THREE.Timer();
  private hiddenTimer: number | null = null;
  private sendAccumulator = 0;
  private camPos = new THREE.Vector3(0, 30, 60);
  private camLook = new THREE.Vector3();
  private idleAngle = 0;
  private padCooldown = 0;
  private lastCountdownText = '';
  private standings: StandingNet[] = [];
  private race = {
    startAt: 0,
    lap: 1,
    place: 0,
    finished: false,
    finishPlace: 0,
    item: null as ItemKind | null,
    active: false,
  };
  private respawnPending = false;
  private itemUseCooldown = 0;
  private autopilotItemTimer = 0;
  private autopilotDriftTime = 0;
  private fixedAccumulator = 0;
  private lastSnapshotAt = 0;
  private slot = 0;
  private running = false;

  constructor(
    private canvas: HTMLCanvasElement,
    hudParent: HTMLElement,
    private callbacks: GameCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 1400);
    this.scene.fog = new THREE.Fog(new THREE.Color('#cfe9f7'), 220, 620);
    this.scene.add(makeSkyDome());

    const hemi = new THREE.HemisphereLight('#cfe9ff', '#6b8f3f', 0.85);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#fff4d6', 2.1);
    this.sun.position.set(80, 140, 60);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 400;
    this.sun.shadow.camera.left = -90;
    this.sun.shadow.camera.right = 90;
    this.sun.shadow.camera.top = 90;
    this.sun.shadow.camera.bottom = -90;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.trackVisual = buildTrackMesh(TRACK);
    this.scene.add(this.trackVisual.group);
    this.scene.add(buildScenery(TRACK));
    this.scene.add(this.items.group);

    this.hud = new Hud(hudParent);

    this.kart = new LocalKart({
      onLeaveTrack: () => void this.respawn('fell off the track'),
      onWallHit: (s) => this.audio.wallHit(s),
      onDriftBoost: (kind) => {
        if (kind === 'mini' || kind === 'super') {
          this.audio.driftBoost(kind);
          this.hud.showMessage(kind === 'super' ? 'SUPER BOOST!' : 'Mini boost!', 900, 'boost');
        }
      },
      onLand: () => this.audio.land(),
    });

    const url = new URL(window.location.href);
    this.autopilot = url.searchParams.get('autopilot') === '1' || url.searchParams.get('bot') === '1';

    window.addEventListener('resize', () => this.resize());
    this.resize();
    canvas.addEventListener('pointerdown', () => {
      canvas.focus();
      this.audio.unlock();
    });
    window.addEventListener('keydown', () => this.audio.unlock(), { once: true });
    // Background tabs get no animation frames; keep simulating (without
    // rendering) so a player who alt-tabs for a moment does not freeze on
    // everyone else's screen.  Browsers throttle this to ~1 Hz, so a hidden
    // frame may have to catch up a whole second of physics.
    this.hiddenTimer = window.setInterval(() => {
      if (document.hidden) this.frame(true);
    }, 100);
    void this.hiddenTimer;
    this.start();
  }

  // ------------------------------------------------------------- lifecycle

  private start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setLocal(id: string, name: string, color: string): void {
    this.localId = id;
    this.localName = name;
    this.localColor = color;
    if (this.localMesh) {
      this.scene.remove(this.localMesh.group);
      this.localMesh.dispose();
    }
    this.localMesh = new KartMesh(color, name, true);
    this.localMesh.setSparkColor(0x4cc9f0);
    this.localMesh.group.visible = false;
    this.scene.add(this.localMesh.group);
  }

  setPlayers(players: PlayerPublic[]): void {
    this.players.clear();
    for (const p of players) {
      this.players.set(p.id, p);
      const remote = this.remotes.get(p.id);
      if (remote) {
        remote.mesh.setLabelSuffix(p.connected ? '' : '(reconnecting…)', p.name, p.color);
        remote.mesh.setOpacity(p.connected ? 1 : 0.45);
      }
    }
    // remove karts of players who left
    for (const [id, r] of this.remotes) {
      if (!this.players.has(id)) this.removeRemote(r);
    }
  }

  /**
   * Starts (or resumes) a race for the local player.
   * @param startAt server timestamp of the green light
   * @param resumePos when reconnecting mid-race, the position the server last knew
   */
  beginRace(startAt: number, slot: number, resumePos?: KartNet): void {
    this.mode = 'race';
    this.slot = slot;
    this.race = { startAt, lap: 1, place: 0, finished: false, finishPlace: 0, item: null, active: true };
    this.standings = [];
    this.lastCountdownText = '';
    this.padCooldown = 0;
    this.respawnPending = false;
    if (resumePos) {
      const proj = projectToTrack(TRACK, resumePos, -1, TRACK.samples.length);
      this.kart.reset(resumePos.x, resumePos.y, resumePos.z, resumePos.yaw, proj.progress);
    } else {
      const grid = startGridSlot(TRACK, slot);
      this.kart.reset(grid.pos.x, grid.pos.y, grid.pos.z, grid.yaw, grid.index);
    }
    if (this.localMesh) this.localMesh.group.visible = true;
    this.hud.show();
    this.hud.setLap(1, TOTAL_LAPS);
    this.hud.setPlace(0);
    this.hud.setItem(null);
    this.hud.setRespawnHint(false);
    this.audio.unlock();
    this.audio.startEngine();
    this.canvas.focus();
    // snap the camera behind the kart
    const f = this.kart.forward();
    this.camPos.set(this.kart.x - f.x * 9, this.kart.y + 4.5, this.kart.z - f.z * 9);
  }

  setHeldItem(item: ItemKind | null): void {
    this.race.item = item;
    this.hud.setItem(item);
  }

  beginSpectate(): void {
    this.mode = 'spectate';
    this.race.active = false;
    if (this.localMesh) this.localMesh.group.visible = false;
    this.hud.hide();
    this.audio.stopEngine();
  }

  /** Back to the lobby / results: keeps rendering the garden with a slow orbit. */
  goIdle(): void {
    this.mode = 'idle';
    this.race.active = false;
    if (this.localMesh) this.localMesh.group.visible = false;
    this.hud.hide();
    this.audio.stopEngine();
    for (const r of [...this.remotes.values()]) this.removeRemote(r);
    this.items.setHoneys([]);
    this.items.setWasps([]);
  }

  /** Race is over (results shown) but keep the karts visible for a moment. */
  endRace(): void {
    this.race.active = false;
    this.audio.stopEngine();
    this.hud.hide();
    this.mode = 'idle';
    if (this.localMesh) this.localMesh.group.visible = false;
  }

  private removeRemote(r: RemoteKart): void {
    this.scene.remove(r.mesh.group);
    r.mesh.dispose();
    this.remotes.delete(r.id);
  }

  // ------------------------------------------------------------- network in

  applySnapshot(snap: Snapshot): void {
    this.lastSnapshotAt = performance.now();
    this.standings = snap.standings;
    const seen = new Set<string>();
    for (const k of snap.karts) {
      if (k.id === this.localId) continue;
      seen.add(k.id);
      let r = this.remotes.get(k.id);
      if (!r) {
        const p = this.players.get(k.id);
        r = new RemoteKart(k.id, p?.name ?? 'Racer', p?.color ?? '#ffffff');
        r.pos.set(k.x, k.y, k.z);
        r.yaw = k.yaw;
        r.mesh.group.position.copy(r.pos);
        this.scene.add(r.mesh.group);
        this.remotes.set(k.id, r);
        if (p && !p.connected) r.mesh.setLabelSuffix('(reconnecting…)', p.name, p.color);
      }
      r.lastSeen = snap.t;
      r.buffer.push({ t: snap.t, x: k.x, y: k.y, z: k.z, yaw: k.yaw, v: k.v, f: k.f, d: k.d });
      if (r.buffer.length > 40) r.buffer.splice(0, r.buffer.length - 40);
    }
    for (const r of [...this.remotes.values()]) {
      if (!seen.has(r.id) && snap.t - r.lastSeen > 3000) this.removeRemote(r);
    }
    this.items.setBoxes(snap.boxes);
    this.items.setHoneys(snap.honeys);
    this.items.setWasps(snap.wasps);
    if (this.mode === 'race') {
      const mine = snap.standings.find((s) => s.id === this.localId);
      if (mine) {
        this.race.place = mine.place;
        this.hud.setPlace(mine.place);
        if (!this.race.finished && mine.lap !== this.race.lap) {
          this.race.lap = mine.lap;
          this.hud.setLap(Math.min(TOTAL_LAPS, mine.lap), TOTAL_LAPS);
        }
      }
    }
    this.refreshStandings();
  }

  private refreshStandings(): void {
    if (this.mode !== 'race' && this.mode !== 'spectate') return;
    const rows: StandingRow[] = [];
    for (const s of this.standings) {
      const p = this.players.get(s.id);
      rows.push({
        id: s.id,
        name: p?.name ?? 'Racer',
        color: p?.color ?? '#fff',
        lap: Math.min(TOTAL_LAPS, s.lap),
        place: s.place,
        finished: s.finished,
        connected: p?.connected ?? true,
        isLocal: s.id === this.localId,
        finishTimeMs: p?.finishTimeMs ?? null,
      });
    }
    this.hud.setStandings(rows);
  }

  applyEvent(ev: RaceEvent): void {
    const isMe = 'playerId' in ev && ev.playerId === this.localId;
    const nameOf = (id: string | null) => (id ? this.players.get(id)?.name ?? 'someone' : 'someone');
    switch (ev.type) {
      case 'pickup':
        if (isMe) {
          this.race.item = ev.item;
          this.hud.setItem(ev.item);
          this.audio.pickup();
          if (this.autopilot) this.autopilotItemTimer = 0.8 + Math.random() * 2;
        }
        break;
      case 'itemUsed':
        if (isMe) {
          this.race.item = null;
          this.hud.setItem(null);
          this.audio.useItem();
          if (ev.item === 'nectar') {
            this.kart.applyBoost('nectar', KART.nectarBoostTime);
            this.hud.showMessage('NECTAR BOOST!', 900, 'boost');
          }
        }
        if (ev.item === 'wasp') this.audio.waspBuzz();
        break;
      case 'hit':
        if (isMe && this.mode === 'race') {
          this.kart.spinOut(ev.by === 'honey' ? KART.honeySpinTime : KART.spinTime);
          this.audio.hit();
          this.hud.showMessage(
            ev.by === 'honey' ? `Stuck in ${nameOf(ev.fromId)}'s honey!` : `Stung by ${nameOf(ev.fromId)}'s wasp!`,
            1600,
            'bad',
          );
        } else if (ev.fromId === this.localId && this.mode === 'race') {
          this.hud.showMessage(`You got ${nameOf(ev.playerId)}!`, 1400, 'good');
        }
        break;
      case 'lap':
        if (isMe) {
          this.race.lap = ev.lap;
          this.hud.setLap(ev.lap, TOTAL_LAPS);
          const finalLap = ev.lap === TOTAL_LAPS;
          this.hud.showMessage(finalLap ? 'FINAL LAP!' : `LAP ${ev.lap}`, 1500, finalLap ? 'final' : '');
          this.audio.lap(finalLap);
        }
        break;
      case 'finish':
        if (isMe) {
          this.race.finished = true;
          this.race.finishPlace = ev.place;
          this.hud.setLap(TOTAL_LAPS + 1, TOTAL_LAPS);
          this.hud.showMessage(`FINISHED  ${ev.place}${ordinal(ev.place)}!`, 4000, 'final');
          this.audio.finish(ev.place);
          this.callbacks.onLocalFinished(ev.place);
        } else if (this.mode === 'race') {
          this.hud.showMessage(`${nameOf(ev.playerId)} finished ${ev.place}${ordinal(ev.place)}`, 1600);
        }
        break;
      case 'respawn':
      case 'checkpoint':
        break;
    }
  }

  // ---------------------------------------------------------------- respawn

  async respawn(reason: string): Promise<void> {
    if (this.respawnPending || this.mode !== 'race') return;
    this.respawnPending = true;
    this.kart.respawning = true;
    this.hud.showMessage(reason === 'manual' ? 'Respawning…' : 'Whoops! Back to the last checkpoint…', 1200, 'bad');
    try {
      const r = await this.callbacks.requestRespawn();
      this.kart.reset(r.x, r.y, r.z, r.yaw, r.index);
      this.audio.respawn();
      const f = this.kart.forward();
      this.camPos.set(r.x - f.x * 9, r.y + 4.5, r.z - f.z * 9);
    } catch {
      // still disconnected; try again shortly
      this.kart.respawning = true;
      setTimeout(() => {
        this.respawnPending = false;
        void this.respawn(reason);
      }, 1500);
      return;
    }
    this.respawnPending = false;
  }

  // ------------------------------------------------------------------ frame

  private frame(hidden = false): void {
    this.timer.update();
    const rawDt = this.timer.getDelta();
    // A long-hidden tab may be woken only once a minute; simulate the whole gap.
    const dt = Math.min(hidden ? 75 : 0.1, rawDt);
    const now = this.callbacks.serverNow();

    if (this.mode === 'race') this.updateRace(dt, now, hidden);
    this.updateRemotes(dt, now);
    this.items.update(dt);
    this.trackVisual.boostPadMaterial.map!.offset.y -= dt * 1.5;
    this.updateCamera(dt);
    this.updateSun();
    this.input.endFrame();
    if (hidden) return;
    this.renderer.render(this.scene, this.camera);
    if (this.mode === 'race' || this.mode === 'spectate') this.drawMinimap();
  }

  private drawMinimap(): void {
    const dots = [];
    if (this.mode === 'race') dots.push({ x: this.kart.x, z: this.kart.z, color: this.localColor, isLocal: true });
    for (const r of this.remotes.values()) dots.push({ x: r.pos.x, z: r.pos.z, color: r.color, isLocal: false });
    this.hud.minimap.draw(dots);
  }

  private updateRace(dt: number, now: number, hidden = false): void {
    const sinceStart = now - this.race.startAt;
    const canDrive = sinceStart >= 0 && !this.race.finished;
    this.updateCountdown(sinceStart);

    // one-shot keys
    if (this.input.consume('KeyM')) {
      const muted = this.audio.toggleMute();
      this.hud.showMessage(muted ? 'Sound off' : 'Sound on', 800);
    }
    if (this.input.consume('KeyR') && canDrive && !this.kart.respawning) void this.respawn('manual');
    this.itemUseCooldown = Math.max(0, this.itemUseCooldown - dt);
    if ((this.input.consume('KeyE') || this.input.consume('Enter')) && this.race.item && canDrive && this.itemUseCooldown === 0) {
      this.itemUseCooldown = 0.4;
      this.callbacks.useItem();
    }

    // physics at a fixed 120 Hz for stable handling
    const auto = this.autopilot || this.race.finished;
    let input = auto ? this.autopilotInput(canDrive, 0) : this.input.state;
    this.fixedAccumulator += dt;
    const step = 1 / 120;
    const maxSteps = hidden ? 9000 : 12;
    let guard = 0;
    while (this.fixedAccumulator >= step && guard++ < maxSteps) {
      // the autopilot re-decides every substep so a throttled (hidden) tab
      // does not hold one steering decision for a whole second
      if (auto && guard > 1) input = this.autopilotInput(canDrive, step);
      this.kart.step(step, input, canDrive || this.race.finished);
      this.fixedAccumulator -= step;
    }
    if (guard >= maxSteps) this.fixedAccumulator = 0;

    // soft collisions with other karts
    for (const r of this.remotes.values()) {
      const p = this.players.get(r.id);
      if (p && !p.connected) continue;
      this.kart.resolveKartCollision(r.pos.x, r.pos.z, r.pos.y);
    }

    // boost pads
    this.padCooldown = Math.max(0, this.padCooldown - dt);
    if (this.kart.proj?.boost && this.kart.grounded && this.padCooldown === 0 && canDrive) {
      this.padCooldown = 1.5;
      this.kart.applyBoost('pad', KART.padBoostTime);
      this.audio.boostPad();
    }

    // autopilot item use
    if ((this.autopilot || this.race.finished) && this.race.item && canDrive) {
      this.autopilotItemTimer -= dt;
      if (this.autopilotItemTimer <= 0) {
        this.autopilotItemTimer = 3;
        this.callbacks.useItem();
      }
    }

    // mesh
    if (this.localMesh) {
      const k = this.kart;
      const g = this.localMesh.group;
      g.position.set(k.x, k.y, k.z);
      g.rotation.set(0, k.yaw, 0);
      // pitch with the slope while grounded
      if (k.proj && k.grounded) {
        const slope = Math.atan2(k.proj.ty, Math.hypot(k.proj.tx, k.proj.tz));
        const f = k.forward();
        const facing = f.x * k.proj.tx + f.z * k.proj.tz;
        g.rotation.x = -slope * Math.sign(facing || 1);
      } else if (!k.grounded) {
        g.rotation.x = THREE.MathUtils.clamp(-k.vy * 0.03, -0.35, 0.35);
      }
      const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
      this.localMesh.update(dt, k.speed, steer, {
        boosting: k.boostTimer > 0,
        drifting: k.drift,
        spinning: k.spinTimer > 0,
        airborne: !k.grounded,
        lean: k.lean,
        hop: k.hopOffset,
        spinAngle: k.spinAngle,
        groundY: k.proj?.groundY ?? k.y,
      });
      g.visible = !k.respawning || Math.floor(performance.now() / 80) % 2 === 0;
      if (k.sinceRespawn < 1.5 && !k.respawning) g.visible = Math.floor(performance.now() / 100) % 2 === 0;
    }

    // HUD
    const speedRatio = Math.abs(this.kart.speed) / KART.maxSpeed;
    this.hud.setSpeed(speedRatio / (KART.boostMaxSpeed / KART.maxSpeed), Math.abs(this.kart.speed) * 3.6 * 1.25, this.kart.boostTimer > 0);
    this.hud.setDrift(this.kart.driftCharge / KART.driftChargeTime, this.kart.drift !== 0);
    this.hud.setWrongWay(this.kart.wrongWay && canDrive);
    this.hud.setRespawnHint(this.kart.stuckTimer > 2.5 && canDrive);
    if (sinceStart >= 0) this.hud.setTimer(this.race.finished ? (this.players.get(this.localId)?.finishTimeMs ?? sinceStart) : sinceStart);
    this.audio.updateEngine(speedRatio, input.accel, this.kart.boostTimer > 0, !this.kart.grounded);

    // network
    this.sendAccumulator += dt * 1000;
    if (this.sendAccumulator >= SEND_INTERVAL) {
      this.sendAccumulator = 0;
      const k = this.kart;
      let f = 0;
      if (k.boostTimer > 0) f |= KART_FLAG_BOOST;
      if (k.spinTimer > 0) f |= KART_FLAG_SPIN;
      if (!k.grounded) f |= KART_FLAG_AIR;
      if (input.brake) f |= KART_FLAG_BRAKE;
      this.callbacks.sendKart({
        x: round2(k.x),
        y: round2(k.y),
        z: round2(k.z),
        yaw: round2(k.yaw),
        v: round2(k.speed),
        f,
        d: k.drift,
      });
    }
  }

  private updateCountdown(sinceStart: number): void {
    let text = '';
    let cls = '';
    if (sinceStart < -COUNTDOWN_MS + 800) text = 'READY';
    else if (sinceStart < 0) text = String(Math.min(3, Math.ceil(-sinceStart / 1000)));
    else if (sinceStart < 900) {
      text = 'GO!';
      cls = 'go';
    }
    if (text !== this.lastCountdownText) {
      this.lastCountdownText = text;
      this.hud.showCountdown(text, cls);
      if (text === 'GO!') this.audio.countdownBeep(true);
      else if (text && text !== 'READY') this.audio.countdownBeep(false);
    }
  }

  /** Simple line-following driver used for the testing autopilot and for finished karts. */
  private autopilotInput(canDrive: boolean, dt: number): { accel: boolean; brake: boolean; left: boolean; right: boolean; drift: boolean } {
    const k = this.kart;
    const out = { accel: false, brake: false, left: false, right: false, drift: false };
    if (!canDrive && !this.race.finished) return out;
    const n = TRACK.samples.length;
    const lookahead = 14 + Math.abs(k.speed) * 0.55;
    const laneOffset = ((this.slot % 3) - 1) * 2.2;
    const target = trackPoint(TRACK, wrapIndex(Math.round(k.hint + lookahead), n), laneOffset);
    const f = k.forward();
    const dx = target.x - k.x;
    const dz = target.z - k.z;
    const cross = f.x * dz - f.z * dx; // >0 => target is to the right
    const dot = f.x * dx + f.z * dz;
    const angle = Math.atan2(cross, dot);
    const dead = 0.05;
    if (angle < -dead) out.left = true;
    else if (angle > dead) out.right = true;
    const cruise = this.race.finished ? 16 : Infinity;
    out.accel = k.speed < cruise;
    // Drift into sustained corners; release as soon as the nose points at the
    // target again (or after a while) so the boost is collected instead of
    // spinning in circles.  angle < 0 means the target is on the left, which
    // is a left-hand (drift = +1) drift.
    this.autopilotDriftTime = k.drift !== 0 ? this.autopilotDriftTime + dt : 0;
    if (k.drift === 0) {
      if (Math.abs(angle) > 0.5 && k.speed > 20 && !this.race.finished) out.drift = true;
    } else {
      const stillTurning = k.drift > 0 ? angle < -0.12 : angle > 0.12;
      if (stillTurning && this.autopilotDriftTime < 2.4) out.drift = true;
    }
    return out;
  }

  private updateRemotes(dt: number, now: number): void {
    const renderTime = now - INTERP_DELAY_MS;
    for (const r of this.remotes.values()) {
      const b = r.buffer;
      if (b.length === 0) continue;
      let from = b[0];
      let to = b[b.length - 1];
      for (let i = 0; i < b.length - 1; i++) {
        if (b[i].t <= renderTime && b[i + 1].t >= renderTime) {
          from = b[i];
          to = b[i + 1];
          break;
        }
      }
      let x: number;
      let y: number;
      let z: number;
      let yaw: number;
      if (renderTime >= to.t) {
        // extrapolate a little using the last known velocity
        const extra = Math.min(0.25, (renderTime - to.t) / 1000);
        x = to.x - Math.sin(to.yaw) * to.v * extra;
        z = to.z - Math.cos(to.yaw) * to.v * extra;
        y = to.y;
        yaw = to.yaw;
      } else {
        const span = Math.max(1, to.t - from.t);
        const a = THREE.MathUtils.clamp((renderTime - from.t) / span, 0, 1);
        x = from.x + (to.x - from.x) * a;
        y = from.y + (to.y - from.y) * a;
        z = from.z + (to.z - from.z) * a;
        yaw = lerpAngle(from.yaw, to.yaw, a);
      }
      r.pos.set(x, y, z);
      r.yaw = yaw;
      r.v = to.v;
      r.f = to.f;
      r.d = to.d;
      const proj = projectToTrack(TRACK, r.pos, r.hint, r.hint < 0 ? TRACK.samples.length : 60);
      if (proj.distance < 40) r.hint = proj.progress;
      r.groundY = proj.groundY;
      const g = r.mesh.group;
      g.position.copy(r.pos);
      g.rotation.set(0, yaw, 0);
      if (!(r.f & KART_FLAG_AIR)) {
        const slope = Math.atan2(proj.ty, Math.hypot(proj.tx, proj.tz));
        const facing = -Math.sin(yaw) * proj.tx + -Math.cos(yaw) * proj.tz;
        g.rotation.x = -slope * Math.sign(facing || 1);
      }
      if (r.f & KART_FLAG_SPIN) r.spinAngle += dt * 9;
      else r.spinAngle = 0;
      r.mesh.update(dt, r.v, 0, {
        boosting: (r.f & KART_FLAG_BOOST) !== 0,
        drifting: r.d,
        spinning: (r.f & KART_FLAG_SPIN) !== 0,
        airborne: (r.f & KART_FLAG_AIR) !== 0,
        lean: r.d !== 0 ? -r.d * 0.28 : 0,
        hop: 0,
        spinAngle: r.spinAngle,
        groundY: r.groundY,
      });
      // trim old samples
      while (b.length > 2 && b[1].t < renderTime - 500) b.shift();
    }
  }

  private updateCamera(dt: number): void {
    const cam = this.camera;
    if (this.mode === 'race') {
      const k = this.kart;
      const f = k.forward();
      const boost = k.boostTimer > 0 ? 1 : 0;
      const dist = 8.5 + Math.abs(k.speed) * 0.05 + boost * 1.5;
      const height = 3.6 + (k.grounded ? 0 : 1.2);
      const desired = new THREE.Vector3(k.x - f.x * dist, k.y + height, k.z - f.z * dist);
      const rate = 1 - Math.exp(-dt * 7);
      this.camPos.lerp(desired, rate);
      // never let the camera sink under the road
      if (k.proj) this.camPos.y = Math.max(this.camPos.y, k.proj.groundY + 1.4);
      const look = new THREE.Vector3(k.x + f.x * 5, k.y + 1.3, k.z + f.z * 5);
      this.camLook.lerp(look, 1 - Math.exp(-dt * 12));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      const targetFov = 62 + boost * 10 + Math.min(8, Math.abs(k.speed) * 0.12);
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 5);
      cam.updateProjectionMatrix();
    } else if (this.mode === 'spectate' && this.remotes.size > 0) {
      // follow the current leader
      const leaderId = this.standings.slice().sort((a, b) => a.place - b.place)[0]?.id;
      const target = (leaderId && this.remotes.get(leaderId)) || this.remotes.values().next().value!;
      const f = { x: -Math.sin(target.yaw), z: -Math.cos(target.yaw) };
      const desired = new THREE.Vector3(target.pos.x - f.x * 11, target.pos.y + 5, target.pos.z - f.z * 11);
      this.camPos.lerp(desired, 1 - Math.exp(-dt * 4));
      this.camPos.y = Math.max(this.camPos.y, target.groundY + 1.5);
      this.camLook.lerp(new THREE.Vector3(target.pos.x, target.pos.y + 1, target.pos.z), 1 - Math.exp(-dt * 8));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      cam.fov += (64 - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    } else {
      // slow orbit around the finish gate
      this.idleAngle += dt * 0.12;
      const centre = TRACK.samples[0];
      const radius = 42;
      const desired = new THREE.Vector3(
        centre.x + Math.cos(this.idleAngle) * radius,
        centre.y + 16 + Math.sin(this.idleAngle * 0.7) * 4,
        centre.z + Math.sin(this.idleAngle) * radius,
      );
      this.camPos.lerp(desired, 1 - Math.exp(-dt * 2));
      this.camLook.lerp(new THREE.Vector3(centre.x + 10, centre.y + 3, centre.z), 1 - Math.exp(-dt * 2));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      cam.fov += (58 - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }

  private updateSun(): void {
    // keep the shadow frustum centred on what the camera is looking at
    const t = this.camLook;
    this.sun.target.position.copy(t);
    this.sun.position.set(t.x + 80, t.y + 140, t.z + 60);
  }

  hasRecentSnapshot(): boolean {
    return performance.now() - this.lastSnapshotAt < 2500;
  }
}

function makeSkyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(900, 24, 12);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color('#3d97dd');
  const horizon = new THREE.Color('#cfe9f7');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 900; // -1..1
    const t = THREE.MathUtils.clamp((y + 0.05) / 0.6, 0, 1);
    c.copy(horizon).lerp(top, Math.pow(t, 0.8));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  return mesh;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
