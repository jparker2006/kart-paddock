// Network client: Socket.IO connection, session persistence, stale detection.
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ItemKind,
  KartReport,
  RoomSnapshot,
  ServerToClientEvents,
  StandingEntry,
} from "../shared/protocol.js";

export type NetEvent =
  | { type: "snapshot"; snap: RoomSnapshot }
  | { type: "standings"; standings: StandingEntry[] }
  | { type: "results"; standings: StandingEntry[] }
  | { type: "countdown"; startsAt: number }
  | { type: "started"; startedAt: number }
  | { type: "message"; text: string }
  | { type: "granted"; kind: ItemKind }
  | { type: "boxes"; taken: number[] }
  | { type: "hazardNew"; h: { id: string; ownerId: string; x: number; y: number; z: number } }
  | { type: "hazardGone"; id: string }
  | { type: "peers"; peers: Record<string, KartReport & { name: string; color: string }> }
  | { type: "error"; message: string }
  | { type: "connect" }
  | { type: "disconnect"; reason: string };

type Handler = (e: NetEvent) => void;

interface Session {
  playerId: string;
  name: string;
  code: string;
}

function storageKey(): string {
  // Namespace by base path so multiple embedded games never collide.
  const base = import.meta.env.BASE_URL ?? "/";
  return `cinder-peak-rally:${base}:session`;
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s.playerId || !s.code) return null;
    return s;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null) {
  try {
    if (!s) localStorage.removeItem(storageKey());
    else localStorage.setItem(storageKey(), JSON.stringify(s));
  } catch {
    /* storage unavailable — game still works for the session */
  }
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `p-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export class NetClient {
  readonly playerId: string;
  name = "";
  code: string | null = null;
  snapshot: RoomSnapshot | null = null;
  lastServerMsgAt = 0;
  connected = false;

  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private handlers = new Set<Handler>();
  private serverUrl: string;

  constructor() {
    this.serverUrl = (import.meta.env.VITE_GAME_SERVER_URL as string | undefined) ?? "http://localhost:3001";
    const existing = loadSession();
    this.playerId = existing?.playerId ?? makeId();
    if (existing) {
      this.name = existing.name;
      this.code = existing.code;
    }
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  private emit(e: NetEvent) {
    if (e.type !== "peers") this.lastServerMsgAt = Date.now();
    for (const h of this.handlers) {
      try {
        h(e);
      } catch (err) {
        console.error(err);
      }
    }
  }

  connect() {
    if (this.socket) return;
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(this.serverUrl, {
      reconnection: true,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      transports: ["websocket", "polling"],
    });
    this.socket = socket;

    socket.on("connect", () => {
      this.connected = true;
      this.lastServerMsgAt = Date.now();
      this.emit({ type: "connect" });
    });
    socket.on("disconnect", (reason) => {
      this.connected = false;
      this.emit({ type: "disconnect", reason });
    });
    socket.on("connect_error", (err) => {
      this.emit({ type: "error", message: `Cannot reach game server (${this.serverUrl}). ${err.message}` });
    });
    socket.on("room:snapshot", (snap) => {
      this.snapshot = snap;
      this.code = snap.code;
      saveSession({ playerId: this.playerId, name: this.name, code: snap.code });
      this.emit({ type: "snapshot", snap });
    });
    socket.on("race:countdown", ({ startsAt }) => this.emit({ type: "countdown", startsAt }));
    socket.on("race:started", ({ startedAt }) => this.emit({ type: "started", startedAt }));
    socket.on("race:standings", (s) => {
      this.lastServerMsgAt = Date.now();
      this.emit({ type: "standings", standings: s });
    });
    socket.on("race:results", (s) => this.emit({ type: "results", standings: s }));
    socket.on("race:message", ({ text }) => this.emit({ type: "message", text }));
    socket.on("item:granted", ({ kind }) => this.emit({ type: "granted", kind }));
    socket.on("item:boxes", (taken) => this.emit({ type: "boxes", taken }));
    socket.on("hazard:new", (h) => this.emit({ type: "hazardNew", h }));
    socket.on("hazard:gone", ({ id }) => this.emit({ type: "hazardGone", id }));
    socket.on("kart:peers", (peers) => this.emit({ type: "peers", peers }));
    socket.on("room:error", ({ message }) => this.emit({ type: "error", message }));
  }

  get socketId(): string | null {
    return this.socket?.id ?? null;
  }

  createRoom(name: string) {
    this.name = name;
    this.socket?.emit("room:create", { name, playerId: this.playerId });
  }

  joinRoom(code: string, name: string) {
    this.name = name;
    this.socket?.emit("room:join", { code, name, playerId: this.playerId });
  }

  leaveRoom() {
    this.socket?.emit("room:leave");
    this.code = null;
    this.snapshot = null;
    saveSession(null);
  }

  startRace() {
    this.socket?.emit("race:start");
  }

  rematch() {
    this.socket?.emit("race:rematch");
  }

  sendKart(r: KartReport) {
    this.socket?.emit("kart:state", r);
  }

  requestItem(boxId: number, x: number, y: number, z: number) {
    this.socket?.emit("item:request", { boxId, x, y, z });
  }

  useItem(kind: ItemKind, x: number, y: number, z: number) {
    this.socket?.emit("item:use", { kind, x, y, z });
  }

  /** Seconds since any meaningful server message. */
  staleSeconds(): number {
    if (!this.lastServerMsgAt) return 0;
    return (Date.now() - this.lastServerMsgAt) / 1000;
  }
}
