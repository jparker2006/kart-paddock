// Game orchestrator: rendering loop, inputs, HUD, screens, race flow.
import * as THREE from "three";
import { NetClient, loadSession } from "./net.js";
import { GameAudio } from "./audio.js";
import { buildWorld, type WorldHandles } from "./world.js";
import { makeHazardMesh, makeItemBoxMesh, makeKartMesh, type KartMesh } from "./karts.js";
import { createKart, respawnKart, stepKart, PHYS, type KartInput, type KartState } from "./physics.js";
import {
  ITEM_BOXES,
  NUM_CHECKPOINTS,
  TOTAL_LAPS,
  checkpointT,
  gridSlot,
  itemBoxPos,
  sampleAt,
  wrapT,
} from "../shared/track.js";
import type { ItemKind, RoomSnapshot, StandingEntry } from "../shared/protocol.js";

const SEND_HZ = 15;

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
}

function fmtTime(ms: number): string {
  if (ms < 0) ms = 0;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor((ms % 1000) / 100);
  return `${m}:${String(s).padStart(2, "0")}.${t}`;
}

function ord(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

interface RemoteKart {
  mesh: KartMesh;
  tx: number;
  ty: number;
  tz: number;
  tyaw: number;
  lastUpdate: number;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private world: WorldHandles;
  private net = new NetClient();
  private audio = new GameAudio();
  private clock = new THREE.Clock();

  private kart!: KartState;
  private kartMesh!: KartMesh;
  private remotes = new Map<string, RemoteKart>();
  private itemMeshes = new Map<number, THREE.Mesh>();
  private hazards = new Map<string, THREE.Group>();
  private heldItem: ItemKind | null = null;
  private boxesTaken = new Set<number>();

  private keys = new Set<string>();
  private phase: RoomSnapshot["phase"] = "lobby";
  private isWaiting = false;
  private amHost = false;
  private myIndex = 0;
  private countdownAt = 0;
  private raceStartAt = 0;
  private raceEndAt = 0;
  private controlsLocked = true;
  private myFinishMs: number | null = null;
  private standings: StandingEntry[] = [];
  private sendAcc = 0;
  private wrongWayAcc: { t: number; at: number }[] = [];
  private boxSpin = 0;
  private toastTimer: number | null = null;
  private hasSpawned = false;
  private minimapPath: { x: number; y: number }[] = [];
  private lastCountNum = "";
  // test/debug counters
  private countJump = 0;
  private countFell = 0;
  private countLanded = 0;
  private countDriftBoost = 0;

  /** Test hook: place the local kart on the centerline at fraction t. */
  debugTeleport(t: number) {
    if (!this.kart) return;
    const s = sampleAt(wrapT(t));
    respawnKart(this.kart, s.x, s.y + 0.5, s.z, s.yaw, wrapT(t));
  }

  /** Test hook: snapshot of local race state. */
  debugState(): Record<string, unknown> {
    const me = this.standings.find((s) => s.playerId === this.net.playerId);
    return {
      phase: this.phase,
      hasSpawned: this.hasSpawned,
      isWaiting: this.isWaiting,
      amHost: this.amHost,
      x: this.kart?.x, y: this.kart?.y, z: this.kart?.z,
      t: this.kart?.lastT, speed: this.kart?.speed,
      grounded: this.kart?.grounded, onTrack: this.kart?.onTrack,
      lap: me?.lap, nextCp: me?.nextCp, position: me?.position,
      finished: me?.finished ?? false,
      remotes: this.remotes.size,
      standings: this.standings.map((s) => ({ name: s.name, pos: s.position, lap: s.lap, fin: s.finished })),
      jumps: this.countJump, falls: this.countFell, lands: this.countLanded,
      driftBoosts: this.countDriftBoost,
      boosting: (this.kart?.boostTime ?? 0) > 0 || (this.kart?.miniBoostTime ?? 0) > 0,
      drifting: this.kart?.drifting ?? false,
      respawns: this.kart?.respawns ?? 0,
      heldItem: this.heldItem,
      hazards: this.hazards.size,
      code: this.net.code,
      staleSec: this.net.staleSeconds(),
      connected: this.net.connected,
    };
  }

  constructor() {
    const canvas = $("scene") as HTMLCanvasElement;
    // ?lowfx trims GPU cost for weak devices / software rendering (used by automated tests).
    const lowFx = new URLSearchParams(location.search).has("lowfx");
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowFx });
    this.renderer.setPixelRatio(lowFx ? 0.5 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !lowFx;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.camera.position.set(0, 60, 120);

    this.world = buildWorld(this.scene);

    for (const def of ITEM_BOXES) {
      const mesh = makeItemBoxMesh();
      const p = itemBoxPos(def);
      mesh.position.set(p.x, p.y, p.z);
      this.scene.add(mesh);
      this.itemMeshes.set(def.id, mesh);
    }

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.bindInputs();
    this.bindUI();
    this.bindNet();
    this.buildMinimapPath();
  }

  // ---------------- setup ----------------

  private bindInputs() {
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
      if (e.repeat) return;
      this.keys.add(e.code);
      this.audio.unlock();
      if (e.code === "KeyE") this.useItem();
      if (e.code === "KeyR") this.respawn("manual");
      if (e.code === "KeyM") {
        const muted = this.audio.toggleMute();
        this.toast(muted ? "🔇 Muted (M to unmute)" : "🔊 Sound on");
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    ($("scene") as HTMLCanvasElement).addEventListener("click", () => this.audio.unlock());
  }

  private readInput(): KartInput {
    if (this.testInput) return this.testInput;
    if (this.autopilot) return this.autopilotInput();
    const k = this.keys;
    const throttle = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) + (k.has("KeyS") || k.has("ArrowDown") ? -1 : 0);
    const steer = (k.has("KeyA") || k.has("ArrowLeft") ? -1 : 0) + (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0);
    return { throttle, steer, drift: k.has("Space") };
  }

  private bindUI() {
    const stored = loadSession();
    if (stored?.name) ($("input-name") as HTMLInputElement).value = stored.name;
    const hash = location.hash.match(/#\/room\/([A-Za-z0-9]{4})/);
    if (hash) ($("input-code") as HTMLInputElement).value = hash[1].toUpperCase();

    const gesture = () => this.audio.unlock();
    $("btn-create").addEventListener("click", () => {
      gesture();
      const name = this.playerName();
      if (!name) return;
      this.net.createRoom(name);
    });
    $("btn-join").addEventListener("click", () => {
      gesture();
      const name = this.playerName();
      if (!name) return;
      const code = (($("input-code") as HTMLInputElement).value || "").trim().toUpperCase();
      if (code.length !== 4) {
        $("home-error").textContent = "Enter the 4-character room code.";
        return;
      }
      this.net.joinRoom(code, name);
    });
    $("btn-copy").addEventListener("click", () => {
      const link = ($("lobby-link") as HTMLAnchorElement).href;
      if (navigator.clipboard) void navigator.clipboard.writeText(link).then(() => this.toast("Room link copied!"));
      else this.toast(link);
    });
    $("btn-start").addEventListener("click", () => {
      gesture();
      this.net.startRace();
    });
    $("btn-leave").addEventListener("click", () => this.leaveToHome());
    $("btn-wait-leave").addEventListener("click", () => this.leaveToHome());
    $("btn-rematch").addEventListener("click", () => this.net.rematch());
    $("btn-to-lobby").addEventListener("click", () => {
      // Server moves everyone to lobby on rematch; if already there just refresh view.
      this.showLobbyIfPossible();
    });
    $("btn-new-room").addEventListener("click", () => {
      location.hash = "";
      this.show("screen-home");
    });
  }

  private playerName(): string {
    const v = (($("input-name") as HTMLInputElement).value || "").trim().slice(0, 16);
    if (!v) {
      $("home-error").textContent = "Pick a name so your friends recognize you.";
      return "";
    }
    $("home-error").textContent = "";
    return v;
  }

  private bindNet() {
    this.net.on((e) => {
      switch (e.type) {
        case "snapshot":
          this.onSnapshot(e.snap);
          break;
        case "standings":
          this.standings = e.standings;
          this.updateStandingsUI();
          this.checkOwnFinish();
          break;
        case "results":
          this.standings = e.standings;
          this.showResults(e.standings);
          break;
        case "countdown":
          this.countdownAt = e.startsAt;
          break;
        case "started":
          this.raceStartAt = e.startedAt;
          this.controlsLocked = false;
          this.myFinishMs = null;
          this.setMessage("GO!", 1200);
          this.audio.countBeep(true);
          break;
        case "message":
          this.toast(e.text);
          if (/finished in/.test(e.text)) this.setMessage(e.text, 2500);
          break;
        case "granted":
          this.heldItem = e.kind;
          this.audio.pickup();
          this.updateItemUI();
          break;
        case "boxes":
          this.boxesTaken = new Set(e.taken);
          this.syncBoxMeshes();
          break;
        case "hazardNew":
          this.addHazard(e.h.id, e.h.x, e.h.y, e.h.z);
          break;
        case "hazardGone":
          this.removeHazard(e.id);
          break;
        case "peers":
          this.updatePeers(e.peers);
          break;
        case "error":
          this.onNetError(e.message);
          break;
        case "connect":
          this.hideConn();
          this.autoRejoin();
          break;
        case "disconnect":
          this.showConn(`Connection lost (${e.reason}) — retrying… Your slot is kept for 90s.`);
          break;
      }
    });
    this.net.connect();
  }

  // ---------------- screens & flow ----------------

  private show(id: string) {
    for (const s of ["screen-home", "screen-lobby", "screen-waiting", "screen-results", "screen-dead"]) {
      $(s).classList.toggle("hidden", s !== id);
    }
    $("hud").classList.toggle("hidden", !(id === "" || id === "none"));
    if (id !== "") $("hud").classList.add("hidden");
  }

  private showRaceHUD() {
    for (const s of ["screen-home", "screen-lobby", "screen-waiting", "screen-results", "screen-dead"]) {
      $(s).classList.add("hidden");
    }
    $("hud").classList.remove("hidden");
  }

  private onSnapshot(snap: RoomSnapshot) {
    this.phase = snap.phase;
    const me = snap.players.find((p) => p.playerId === this.net.playerId);
    this.amHost = !!me?.isHost;
    this.myIndex = Math.max(0, snap.players.findIndex((p) => p.playerId === this.net.playerId));
    this.isWaiting = !me ? false : snap.phase !== "lobby" && this.isWaitingFor(snap, me.playerId);
    if (snap.phase === "lobby") {
      this.isWaiting = false;
      this.hasSpawned = false;
      this.renderLobby(snap);
      this.show("screen-lobby");
      location.hash = `/room/${snap.code}`;
    } else if (snap.phase === "countdown" || snap.phase === "racing") {
      if (!me) return;
      const waiting = (me as { waiting?: boolean }).waiting ?? this.computeWaiting(snap, me.playerId);
      if (waiting) {
        this.isWaiting = true;
        this.show("screen-waiting");
      } else {
        this.isWaiting = false;
        if (!this.hasSpawned) this.spawnForRace(snap);
        this.showRaceHUD();
        if (snap.phase === "countdown" && snap.countdownEndsAt) {
          this.countdownAt = snap.countdownEndsAt;
          this.controlsLocked = true;
        }
        if (snap.phase === "racing" && snap.raceStartedAt) {
          this.raceStartAt = snap.raceStartedAt;
          if (Date.now() - snap.raceStartedAt > 500) this.controlsLocked = false;
        }
        if (snap.raceEndsAt) this.raceEndAt = snap.raceEndsAt;
      }
    } else if (snap.phase === "finished") {
      if (this.isWaiting) this.show("screen-waiting");
    }
    this.hideConnIfHealthy();
  }

  /** The snapshot PlayerInfo has no `waiting` flag; infer: waiting players have no progress. */
  private computeWaiting(snap: RoomSnapshot, pid: string): boolean {
    const me = snap.players.find((p) => p.playerId === pid);
    if (!me) return false;
    if (snap.phase === "lobby") return false;
    return me.progress === undefined;
  }

  private isWaitingFor(snap: RoomSnapshot, pid: string): boolean {
    return this.computeWaiting(snap, pid);
  }

  private renderLobby(snap: RoomSnapshot) {
    $("lobby-code").textContent = snap.code;
    const base = import.meta.env.BASE_URL as string;
    const link = `${location.origin}${base}#/room/${snap.code}`;
    const a = $("lobby-link") as HTMLAnchorElement;
    a.href = link;
    a.textContent = link;
    const ul = $("lobby-players");
    ul.innerHTML = "";
    for (const p of snap.players) {
      const li = document.createElement("li");
      if (p.playerId === this.net.playerId) li.classList.add("me");
      li.innerHTML = `<span class="dot" style="background:${p.color}"></span> <span></span>${p.connected ? "" : " (away)"}`;
      li.querySelector("span:nth-child(2)")!.textContent = p.name;
      if (p.isHost) {
        const b = document.createElement("span");
        b.className = "host-badge";
        b.textContent = "HOST";
        li.appendChild(b);
      }
      ul.appendChild(li);
    }
    const connected = snap.players.filter((p) => p.connected).length;
    const status = $("lobby-status");
    const start = $("btn-start") as HTMLButtonElement;
    if (!this.amHost) {
      status.textContent = `Waiting for the host to start… (${connected} in room)`;
      start.disabled = true;
    } else if (connected < 2) {
      status.textContent = `Need at least 2 racers (have ${connected}). Share the link!`;
      start.disabled = true;
    } else {
      status.textContent = `Ready! ${connected} racers.`;
      start.disabled = false;
    }
    $("lobby-error").textContent = "";
  }

  private spawnForRace(snap: RoomSnapshot) {
    this.hasSpawned = true;
    // (Re)build karts for everyone racing.
    for (const [, r] of this.remotes) this.scene.remove(r.mesh.group);
    this.remotes.clear();
    if (this.kartMesh) this.scene.remove(this.kartMesh.group);
    const me = snap.players.find((p) => p.playerId === this.net.playerId)!;
    const slot = gridSlot(this.myIndex % 8);
    this.kart = createKart(slot.x, slot.y, slot.z, slot.yaw);
    this.kart.lastT = 0.995;
    // Reconnecting mid-race (or joining with prior progress): resume at the
    // last validated checkpoint instead of the start grid.
    const prog = me.progress;
    if (prog && (prog.lap > 0 || prog.nextCp !== 1)) {
      const cpIdx = (((prog.nextCp - 1) % NUM_CHECKPOINTS) + NUM_CHECKPOINTS) % NUM_CHECKPOINTS;
      const s = sampleAt(checkpointT(cpIdx));
      respawnKart(this.kart, s.x, s.y + 0.5, s.z, s.yaw, checkpointT(cpIdx));
    }
    this.kartMesh = makeKartMesh(me.color, me.name + " (you)", true);
    this.scene.add(this.kartMesh.group);
    for (const p of snap.players) {
      if (p.playerId === this.net.playerId) continue;
      if (p.progress === undefined && snap.phase !== "lobby") continue;
      const mesh = makeKartMesh(p.color, p.name, false);
      const ps = gridSlot(snap.players.indexOf(p) % 8);
      mesh.group.position.set(ps.x, ps.y, ps.z);
      this.scene.add(mesh.group);
      this.remotes.set(p.playerId, { mesh, tx: ps.x, ty: ps.y, tz: ps.z, tyaw: ps.yaw, lastUpdate: Date.now() });
    }
    this.heldItem = null;
    this.myFinishMs = null;
    this.controlsLocked = true;
    this.wrongWayAcc = [];
    this.updateItemUI();
    this.setMessage(snap.phase === "countdown" ? "Get ready…" : "GO!", 1500);
  }

  private checkOwnFinish() {
    const me = this.standings.find((s) => s.playerId === this.net.playerId);
    if (me?.finished && this.myFinishMs === null) {
      this.myFinishMs = me.finishTimeMs ?? Date.now() - this.raceStartAt;
      this.controlsLocked = true;
      this.setMessage(`🏁 Finished ${ord(me.position)} — ${fmtTime(this.myFinishMs)}!`, 5000);
      this.audio.fanfare(me.position <= 3);
    }
  }

  private showResults(standings: StandingEntry[]) {
    this.show("screen-results");
    const ol = $("results-list");
    ol.innerHTML = "";
    for (const s of standings) {
      const li = document.createElement("li");
      if (s.playerId === this.net.playerId) li.classList.add("me");
      const time = s.finished && s.finishTimeMs !== undefined ? ` — ${fmtTime(s.finishTimeMs)}` : " — DNF";
      const off = s.connected ? "" : " (left)";
      li.textContent = `${ord(s.position)} — ${s.name}${time}${off}`;
      li.style.borderLeft = `6px solid ${s.color}`;
      ol.appendChild(li);
    }
    const me = standings.find((s) => s.playerId === this.net.playerId);
    $("results-note").textContent = me
      ? me.position === 1
        ? "🏆 Champion of the Peak!"
        : `You placed ${ord(me.position)}. ${this.amHost ? "Start a rematch when ready!" : "Waiting for the host to start a rematch…"}`
      : this.amHost
        ? "Start a rematch when ready!"
        : "Waiting for the host…";
    ($("btn-rematch") as HTMLButtonElement).disabled = !this.amHost;
    if (!me?.finished || (me.finishTimeMs ?? 0) > 0) {
      if (me && !me.finished) this.audio.fanfare(false);
    }
  }

  private showLobbyIfPossible() {
    if (this.net.snapshot?.phase === "lobby" && this.net.snapshot) {
      this.renderLobby(this.net.snapshot);
      this.show("screen-lobby");
    } else {
      this.toast("Waiting for the host to return to the lobby…");
    }
  }

  private leaveToHome() {
    this.net.leaveRoom();
    location.hash = "";
    this.show("screen-home");
    this.hideConn();
  }

  private onNetError(message: string) {
    if (/Room not found|restart/i.test(message)) {
      $("dead-text").textContent = `${message} Create a new room to keep racing.`;
      this.show("screen-dead");
      this.net.code = null;
      return;
    }
    // contextual error display
    if (!$("screen-lobby").classList.contains("hidden")) $("lobby-error").textContent = message;
    else if (!$("screen-home").classList.contains("hidden")) $("home-error").textContent = message;
    else this.toast(message);
  }

  private autoRejoin() {
    const stored = loadSession();
    if (!stored?.code || this.phase === "lobby" && this.net.snapshot) return;
    const name = ($("input-name") as HTMLInputElement).value.trim() || stored.name || "Racer";
    if (stored.code) {
      this.net.joinRoom(stored.code, name);
    }
  }

  // ---------------- HUD ----------------

  private setMessage(text: string, ms: number) {
    $("hud-message").textContent = text;
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    if (ms > 0) this.toastTimer = window.setTimeout(() => ($("hud-message").textContent = ""), ms);
  }

  private toast(text: string) {
    const t = $("toast");
    t.textContent = text;
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      t.textContent = "";
      ($("hud-message").textContent = "");
    }, 3200);
    // also mirror important messages
    if ($("hud").classList.contains("hidden")) return;
  }

  private showConn(text: string) {
    const b = $("conn-banner");
    b.textContent = text;
    b.classList.remove("hidden");
  }

  private hideConn() {
    $("conn-banner").classList.add("hidden");
  }

  private hideConnIfHealthy() {
    if (this.net.connected && this.net.staleSeconds() < 5) this.hideConn();
  }

  private updateStandingsUI() {
    const ol = $("standings");
    ol.innerHTML = "";
    for (const s of this.standings.slice(0, 8)) {
      const li = document.createElement("li");
      if (s.playerId === this.net.playerId) li.classList.add("me");
      const lapLabel = s.finished ? "FIN" : `${Math.min(s.lap + 1, TOTAL_LAPS)}/${TOTAL_LAPS}`;
      li.textContent = `${s.position}. ${s.name} ${s.connected ? "" : "✖"} · ${lapLabel}`;
      li.style.color = s.color;
      ol.appendChild(li);
    }
    const w = $("waiting-standings");
    if (w) {
      w.innerHTML = "";
      for (const s of this.standings) {
        const li = document.createElement("li");
        const lapLabel = s.finished ? "FINISHED" : `Lap ${Math.min(s.lap + 1, TOTAL_LAPS)}/${TOTAL_LAPS}`;
        li.textContent = `${ord(s.position)} — ${s.name} · ${lapLabel}`;
        w.appendChild(li);
      }
    }
    const me = this.standings.find((s) => s.playerId === this.net.playerId);
    if (me) {
      $("hud-lap").textContent = me.finished ? "FINISHED!" : `LAP ${Math.min(me.lap + 1, TOTAL_LAPS)}/${TOTAL_LAPS}`;
      $("hud-pos").textContent = ord(me.position);
      $("hud-pos").style.color = me.color;
    }
  }

  private updateItemUI() {
    const icon = $("item-icon");
    if (!this.heldItem) {
      icon.textContent = "—";
      ($("item-hint") as HTMLElement).textContent = "grab a 🎁";
    } else if (this.heldItem === "boost") {
      icon.textContent = "🚀";
      ($("item-hint") as HTMLElement).textContent = "E to boost";
    } else {
      icon.textContent = "🛢️";
      ($("item-hint") as HTMLElement).textContent = "E to drop";
    }
  }

  private useItem() {
    if (!this.heldItem || this.controlsLocked || this.phase !== "racing" || this.isWaiting) return;
    const kind = this.heldItem;
    this.heldItem = null;
    this.updateItemUI();
    if (kind === "boost") {
      this.kart.boostTime = PHYS.rocketTime;
      this.audio.boost();
      this.net.useItem(kind, this.kart.x, this.kart.y, this.kart.z);
    } else {
      // drop behind the kart
      const bx = this.kart.x - Math.sin(this.kart.yaw) * 4;
      const bz = this.kart.z - Math.cos(this.kart.yaw) * 4;
      this.net.useItem(kind, bx, this.kart.y, bz);
      this.audio.pickup();
    }
  }

  // ---------------- entities ----------------

  private syncBoxMeshes() {
    for (const [id, mesh] of this.itemMeshes) {
      mesh.visible = !this.boxesTaken.has(id);
    }
  }

  private addHazard(id: string, x: number, y: number, z: number) {
    this.removeHazard(id);
    const g = makeHazardMesh();
    g.position.set(x, y, z);
    this.scene.add(g);
    this.hazards.set(id, g);
  }

  private removeHazard(id: string) {
    const g = this.hazards.get(id);
    if (g) {
      this.scene.remove(g);
      this.hazards.delete(id);
    }
  }

  private updatePeers(peers: Record<string, { x: number; y: number; z: number; yaw: number; speed: number; name: string; color: string }>) {
    const snap = this.net.snapshot;
    for (const [pid, p] of Object.entries(peers)) {
      if (pid === this.net.playerId) continue;
      let r = this.remotes.get(pid);
      if (!r) {
        if (snap?.phase === "lobby") continue;
        const mesh = makeKartMesh(p.color, p.name, false);
        this.scene.add(mesh.group);
        r = { mesh, tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw, lastUpdate: 0 };
        this.remotes.set(pid, r);
      }
      r.tx = p.x;
      r.ty = p.y;
      r.tz = p.z;
      r.tyaw = p.yaw;
      r.lastUpdate = Date.now();
    }
    // drop peers who left
    const snapIds = new Set(snap?.players.map((p) => p.playerId) ?? []);
    for (const [pid, r] of this.remotes) {
      if (!snapIds.has(pid) || (!(pid in peers) && Date.now() - r.lastUpdate > 15000)) {
        this.scene.remove(r.mesh.group);
        this.remotes.delete(pid);
      }
    }
  }

  // ---------------- respawn / minimap ----------------

  private respawn(reason: "manual" | "fell") {
    if (!this.kart || this.phase !== "racing" || this.controlsLocked || this.isWaiting) return;
    if (reason === "manual" && this.myFinishMs !== null) return;
    const snap = this.net.snapshot;
    const me = snap?.players.find((p) => p.playerId === this.net.playerId);
    const nextCp = me?.progress?.nextCp ?? 1;
    const lap = me?.progress?.lap ?? 0;
    void lap;
    const cpIdx = (((nextCp - 1) % NUM_CHECKPOINTS) + NUM_CHECKPOINTS) % NUM_CHECKPOINTS;
    const s = sampleAt(checkpointT(cpIdx));
    respawnKart(this.kart, s.x, s.y + 0.5, s.z, s.yaw, checkpointT(cpIdx));
    if (reason === "fell") {
      this.audio.splash();
      this.toast("🌋 Lava bath! Respawning…");
    }
  }

  private buildMinimapPath() {
    // fit track bounds
    let minX = 1e9;
    let maxX = -1e9;
    let minZ = 1e9;
    let maxZ = -1e9;
    const N = 140;
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i < N; i++) {
      const s = sampleAt(i / N);
      pts.push({ x: s.x, z: s.z });
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    this.minimapPath = pts.map((p) => ({
      x: 8 + ((p.x - minX) / (maxX - minX)) * 154,
      y: 8 + ((p.z - minZ) / (maxZ - minZ)) * 154,
    }));
  }

  private drawMinimap() {
    const c = $("minimap") as HTMLCanvasElement;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, 170, 170);
    g.strokeStyle = "#8a8a9a";
    g.lineWidth = 5;
    g.beginPath();
    this.minimapPath.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.closePath();
    g.stroke();
    const dot = (t: number, color: string, r: number) => {
      const i = Math.floor(wrapT(t) * this.minimapPath.length) % this.minimapPath.length;
      const p = this.minimapPath[i];
      g.fillStyle = color;
      g.beginPath();
      g.arc(p.x, p.y, r, 0, Math.PI * 2);
      g.fill();
    };
    for (const s of this.standings) {
      if (s.playerId === this.net.playerId) continue;
      dot(s.t, s.color, 3);
    }
    if (this.kart) dot(this.kart.lastT, "#ffffff", 4);
  }

  // ---------------- main loop ----------------

  run() {
    this.show("screen-home");
    this.renderer.setAnimationLoop(() => this.frame());
    // auto-join via share link if we have a session
    const hash = location.hash.match(/#\/room\/([A-Za-z0-9]{4})/);
    const stored = loadSession();
    if (hash && stored?.name) {
      ($("input-name") as HTMLInputElement).value = stored.name;
      // wait for socket connect (autoRejoin handles it)
    }
    setInterval(() => this.healthCheck(), 1000);
  }

  private healthCheck() {
    if (this.phase !== "racing" && this.phase !== "countdown") return;
    if (this.isWaiting) return;
    if (!this.net.connected) {
      this.showConn("Connection lost — retrying… Your slot is kept for 90s.");
    } else if (this.net.staleSeconds() > 6) {
      this.showConn("No race updates for a while — connection may be stale. Retrying…");
    } else {
      this.hideConnIfHealthy();
    }
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.elapsedTime;
    const now = Date.now();

    // countdown display
    if ((this.phase === "countdown" || this.phase === "racing") && !this.isWaiting && this.hasSpawned) {
      if (this.countdownAt > now) {
        const n = Math.ceil((this.countdownAt - now) / 1000);
        const label = n > 3 ? "" : String(n);
        if (label !== this.lastCountNum) {
          this.lastCountNum = label;
          if (label) this.audio.countBeep(false);
        }
        $("hud-countdown").textContent = label;
      } else {
        if (this.lastCountNum !== "GO") {
          this.lastCountNum = "GO";
          window.setTimeout(() => {
            if (this.lastCountNum === "GO") $("hud-countdown").textContent = "";
          }, 900);
          $("hud-countdown").textContent = "GO!";
        }
      }
      // race clock
      if (this.raceStartAt > 0 && this.myFinishMs === null) {
        $("hud-time").textContent = fmtTime(now - this.raceStartAt);
      } else if (this.myFinishMs !== null) {
        $("hud-time").textContent = fmtTime(this.myFinishMs);
      }
    } else {
      $("hud-countdown").textContent = "";
    }

    if (this.hasSpawned && !this.isWaiting && (this.phase === "racing" || this.phase === "countdown")) {
      this.stepLocalKart(dt, now, elapsed);
    } else if (this.isWaiting || !this.hasSpawned) {
      // gentle orbit while waiting / in menus
      const t = elapsed * 0.06;
      this.camera.position.set(Math.sin(t) * 150, 90, Math.cos(t) * 150);
      this.camera.lookAt(0, 0, -5);
      this.camera.fov = 60;
      this.camera.updateProjectionMatrix();
    }

    // remote kart interpolation
    for (const [, r] of this.remotes) {
      const g = r.mesh.group;
      const k = Math.min(1, 10 * dt);
      g.position.x += (r.tx - g.position.x) * k;
      g.position.y += (r.ty - g.position.y) * k;
      g.position.z += (r.tz - g.position.z) * k;
      let d = r.tyaw - g.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      g.rotation.y += d * Math.min(1, 12 * dt);
    }

    // item boxes spin/bob
    this.boxSpin += dt;
    for (const [, m] of this.itemMeshes) {
      if (!m.visible) continue;
      m.rotation.y += dt * 2;
      m.position.y += Math.sin(this.boxSpin * 3 + m.position.x) * dt * 0.6;
    }

    this.world.update(elapsed, dt);
    if (!this.isWaiting && this.hasSpawned) this.drawMinimap();
    this.renderer.render(this.scene, this.camera);
  }

  private stepLocalKart(dt: number, now: number, _elapsed: number) {
    const input = this.readInput();
    const sub = 2;
    const sdt = dt / sub;
    for (let i = 0; i < sub; i++) {
      const ev = stepKart(this.kart, input, sdt, now, this.controlsLocked);
      if (ev.driftBoost) {
        this.countDriftBoost += 1;
        this.audio.boost();
        this.toast("⚡ Drift boost!");
      }
      if (ev.jumped) {
        this.countJump += 1;
        this.audio.boost();
      }
      if (ev.landed) this.countLanded += 1;
      if (ev.fell) {
        this.countFell += 1;
        this.respawn("fell");
        break;
      }
    }

    // item pickup
    if (this.phase === "racing" && !this.controlsLocked && !this.heldItem) {
      for (const def of ITEM_BOXES) {
        if (this.boxesTaken.has(def.id)) continue;
        const mesh = this.itemMeshes.get(def.id);
        if (!mesh || !mesh.visible) continue;
        const dx = this.kart.x - mesh.position.x;
        const dz = this.kart.z - mesh.position.z;
        const dy = this.kart.y - mesh.position.y;
        if (dx * dx + dz * dz < 3.6 * 3.6 && Math.abs(dy) < 3.5) {
          this.net.requestItem(def.id, this.kart.x, this.kart.y, this.kart.z);
          break;
        }
      }
    }

    // slick collision
    if (this.kart.grounded && now > this.kart.slickImmuneUntil && this.kart.spinTime <= 0) {
      for (const [, g] of this.hazards) {
        const dx = this.kart.x - g.position.x;
        const dz = this.kart.z - g.position.z;
        if (dx * dx + dz * dz < 2.3 * 2.3 && Math.abs(this.kart.speed) > 4) {
          this.kart.spinTime = PHYS.spinTime;
          this.kart.slickImmuneUntil = now + 4000;
          this.kart.speed *= 0.4;
          this.audio.spin();
          this.toast("🛢️ Oil slick! Hold on!");
          break;
        }
      }
    }

    // wrong-way detection
    this.wrongWayAcc.push({ t: this.kart.lastT, at: now });
    while (this.wrongWayAcc.length > 0 && now - this.wrongWayAcc[0].at > 1800) this.wrongWayAcc.shift();
    if (this.wrongWayAcc.length > 5 && Math.abs(this.kart.speed) > 6 && this.phase === "racing" && !this.controlsLocked) {
      const first = this.wrongWayAcc[0].t;
      const last = this.wrongWayAcc[this.wrongWayAcc.length - 1].t;
      let d = last - first;
      if (d > 0.5) d -= 1;
      if (d < -0.5) d += 1;
      $("hud-wrongway").classList.toggle("hidden", d >= -0.002);
    } else {
      $("hud-wrongway").classList.add("hidden");
    }

    // sync mesh
    const g = this.kartMesh.group;
    g.position.set(this.kart.x, this.kart.y, this.kart.z);
    g.rotation.y = this.kart.yaw;
    // lean into steering
    const steerLean = (this.readInputSteer() ?? 0) * 0.08;
    g.rotation.z = -steerLean;
    for (const w of this.kartMesh.wheels) w.rotation.x += (this.kart.speed / 0.42) * dt;
    this.kartMesh.setDriftSparks(this.kart.drifting && this.kart.driftCharge > 0.25);
    ($("boost-fill") as HTMLElement).style.width = `${Math.round(this.kart.driftCharge * 100)}%`;

    // audio engine
    this.audio.engine(this.kart.speed, this.phase === "racing" && !this.controlsLocked);

    // chase camera
    const fx = Math.sin(this.kart.yaw);
    const fz = Math.cos(this.kart.yaw);
    const camDist = 9.5 + Math.abs(this.kart.speed) * 0.06;
    const wantX = this.kart.x - fx * camDist;
    const wantZ = this.kart.z - fz * camDist;
    const wantY = this.kart.y + 4.2;
    const ck = Math.min(1, 6 * dt);
    this.camera.position.x += (wantX - this.camera.position.x) * ck;
    this.camera.position.y += (wantY - this.camera.position.y) * ck;
    this.camera.position.z += (wantZ - this.camera.position.z) * ck;
    this.camera.lookAt(this.kart.x + fx * 7, this.kart.y + 1.2, this.kart.z + fz * 7);
    const boosting = this.kart.boostTime > 0 || this.kart.miniBoostTime > 0;
    const wantFov = boosting ? 76 : 64;
    this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, 5 * dt);
    this.camera.updateProjectionMatrix();

    // send state @ SEND_HZ
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / SEND_HZ && this.phase === "racing") {
      this.sendAcc = 0;
      this.net.sendKart({
        x: this.kart.x,
        y: this.kart.y,
        z: this.kart.z,
        yaw: this.kart.yaw,
        speed: this.kart.speed,
        t: this.kart.lastT,
      });
    }
  }

  // ---- autopilot (used by automated browser tests; pure-pursuit driver) ----
  private autopilot = false;
  private testInput: KartInput | null = null;
  private testInputTimer: number | null = null;

  /** Test hook: override inputs for ms milliseconds (null clears). */
  debugDrive(input: KartInput | null, ms = 0) {
    if (this.testInputTimer) {
      window.clearTimeout(this.testInputTimer);
      this.testInputTimer = null;
    }
    this.testInput = input;
    if (input && ms > 0) {
      this.testInputTimer = window.setTimeout(() => {
        this.testInput = null;
        this.testInputTimer = null;
      }, ms);
    }
  }

  /** Test hook: trigger item use as if E was pressed. */
  debugUseItem() {
    this.useItem();
  }

  /** Test hook: trigger a manual respawn. */
  debugRespawn() {
    this.respawn("manual");
  }

  private autopilotInput(): KartInput {
    const s = this.kart;
    if (!s) return { throttle: 0, steer: 0, drift: false };
    const lookAhead = 0.012 + Math.min(0.02, Math.abs(s.speed) * 0.0006);
    const target = sampleAt(s.lastT + lookAhead);
    const dx = target.x - s.x;
    const dz = target.z - s.z;
    const wantYaw = Math.atan2(dx, dz);
    let d = wantYaw - s.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const steer = Math.max(-1, Math.min(1, d * 2.2));
    const sharp = Math.abs(d) > 0.45;
    return {
      throttle: sharp ? 0.25 : 1,
      steer,
      drift: Math.abs(steer) > 0.65 && Math.abs(s.speed) > 15,
    };
  }
  private readInputSteer(): number | null {
    const k = this.keys;
    return (k.has("KeyA") || k.has("ArrowLeft") ? -1 : 0) + (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0);
  }
}
