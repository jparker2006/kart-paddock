// Cinder Peak Rally — persistent Node backend (Socket.IO + plain HTTP).
// Deployable as a single long-lived Node service (e.g. Render web service).
// No database; rooms live in memory. A backend restart loses rooms and
// clients are told to create a new room.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Server, type Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import {
  KART_COLORS,
  NUM_CHECKPOINTS,
  TOTAL_LAPS,
  FINISH_TIMEOUT_MS,
  checkpointT,
  queryNear,
  sampleAt,
  itemBoxPos,
  ITEM_BOXES,
  wrapT,
} from "../shared/track.js";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type ClientToServerEvents,
  type ItemKind,
  type KartReport,
  type PlayerInfo,
  type RoomPhase,
  type RoomSnapshot,
  type ServerToClientEvents,
  type StandingEntry,
} from "../shared/protocol.js";
import { loadConfig } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface Player {
  playerId: string;
  name: string;
  color: string;
  socketId: string | null;
  connected: boolean;
  waiting: boolean; // joined mid-race; sits out until rematch
  lastT: number;
  lap: number;
  nextCp: number;
  finished: boolean;
  finishTimeMs?: number;
  lastReport: (KartReport & { at: number }) | null;
  removalTimer?: NodeJS.Timeout;
}

interface Hazard {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

interface Room {
  code: string;
  hostId: string;
  phase: RoomPhase;
  players: Map<string, Player>;
  countdownEndsAt?: number;
  raceStartedAt?: number;
  raceEndsAt?: number;
  countdownTimer?: NodeJS.Timeout;
  finishTimer?: NodeJS.Timeout;
  tickTimer?: NodeJS.Timeout;
  peersTimer?: NodeJS.Timeout;
  emptyTimer?: NodeJS.Timeout;
  boxesTaken: Map<number, NodeJS.Timeout>;
  hazards: Map<string, Hazard>;
}

const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, { code: string; playerId: string }>();

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  for (;;) {
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
}

function sanitizeName(name: string): string {
  const n = (name ?? "").trim().slice(0, 16);
  return n.length > 0 ? n : "Racer";
}

function colorFor(room: Room): string {
  const used = new Set([...room.players.values()].map((p) => p.color));
  for (const c of KART_COLORS) if (!used.has(c)) return c;
  return KART_COLORS[room.players.size % KART_COLORS.length];
}

function progressScore(p: Player): number {
  const done = p.lap * NUM_CHECKPOINTS + ((p.nextCp - 1 + NUM_CHECKPOINTS) % NUM_CHECKPOINTS);
  const legStart = checkpointT((p.nextCp - 1 + NUM_CHECKPOINTS) % NUM_CHECKPOINTS);
  const frac = wrapT(p.lastT - legStart);
  return done + Math.min(frac, 0.2) * 5;
}

function standingsOf(room: Room): StandingEntry[] {
  const list = [...room.players.values()].filter((p) => !p.waiting);
  list.sort((a, b) => {
    if (a.finished && b.finished) return (a.finishTimeMs ?? 0) - (b.finishTimeMs ?? 0);
    if (a.finished) return -1;
    if (b.finished) return 1;
    return progressScore(b) - progressScore(a);
  });
  return list.map((p, i) => ({
    playerId: p.playerId,
    name: p.name,
    color: p.color,
    lap: p.lap,
    nextCp: p.nextCp,
    t: p.lastT,
    finished: p.finished,
    finishTimeMs: p.finishTimeMs,
    position: i + 1,
    connected: p.connected,
  }));
}

function snapshotOf(room: Room, forPlayer?: string): RoomSnapshot {
  const players: PlayerInfo[] = [...room.players.values()].map((p) => ({
    playerId: p.playerId,
    name: p.name,
    color: p.color,
    connected: p.connected,
    isHost: p.playerId === room.hostId,
    progress:
      room.phase === "lobby" || p.waiting
        ? undefined
        : {
            lap: p.lap,
            nextCp: p.nextCp,
            t: p.lastT,
            finished: p.finished,
            finishTimeMs: p.finishTimeMs,
          },
  }));
  void forPlayer;
  return {
    code: room.code,
    phase: room.phase,
    players,
    countdownEndsAt: room.countdownEndsAt,
    raceStartedAt: room.raceStartedAt,
    raceEndsAt: room.raceEndsAt,
    serverNow: Date.now(),
  };
}

function emitSnapshot(room: Room, io: Server) {
  const snap = snapshotOf(room);
  for (const p of room.players.values()) {
    if (p.socketId) io.to(p.socketId).emit("room:snapshot", snapshotOf(room));
  }
  void snap;
}

function clearRaceTimers(room: Room) {
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  if (room.finishTimer) clearTimeout(room.finishTimer);
  if (room.tickTimer) clearInterval(room.tickTimer);
  if (room.peersTimer) clearInterval(room.peersTimer);
  room.countdownTimer = undefined;
  room.finishTimer = undefined;
  room.tickTimer = undefined;
  room.peersTimer = undefined;
}

function destroyRoom(code: string) {
  const room = rooms.get(code);
  if (!room) return;
  clearRaceTimers(room);
  if (room.emptyTimer) clearTimeout(room.emptyTimer);
  for (const [, t] of room.boxesTaken) clearTimeout(t);
  for (const [, h] of room.hazards) clearTimeout(h.timer);
  rooms.delete(code);
}

function racers(room: Room): Player[] {
  return [...room.players.values()].filter((p) => !p.waiting);
}

function attachSocketToPlayer(io: Server, socket: TypedSocket, room: Room, player: Player) {
  if (player.socketId && player.socketId !== socket.id) {
    // previous stale socket: leave it; it will disconnect on its own
  }
  player.socketId = socket.id;
  player.connected = true;
  if (player.removalTimer) {
    clearTimeout(player.removalTimer);
    player.removalTimer = undefined;
  }
  if (room.emptyTimer) {
    clearTimeout(room.emptyTimer);
    room.emptyTimer = undefined;
  }
  socketToRoom.set(socket.id, { code: room.code, playerId: player.playerId });
  socket.join(room.code);
  socket.emit("room:snapshot", snapshotOf(room));
  socket.emit("item:boxes", [...room.boxesTaken.keys()]);
  for (const h of room.hazards.values()) {
    socket.emit("hazard:new", { id: h.id, ownerId: h.ownerId, x: h.x, y: h.y, z: h.z });
  }
  if (room.phase === "racing" || room.phase === "finished") {
    socket.emit("race:standings", standingsOf(room));
  }
  if (room.phase === "finished") {
    socket.emit("race:results", standingsOf(room));
  }
  emitSnapshot(room, io);
}

function startCountdown(io: Server, room: Room) {
  clearRaceTimers(room);
  for (const p of room.players.values()) {
    p.lastT = 0.997;
    p.lap = 0;
    p.nextCp = 1;
    p.finished = false;
    p.finishTimeMs = undefined;
    p.lastReport = null;
  }
  for (const [, t] of room.boxesTaken) clearTimeout(t);
  room.boxesTaken.clear();
  for (const [, h] of room.hazards) clearTimeout(h.timer);
  room.hazards.clear();
  room.phase = "countdown";
  room.countdownEndsAt = Date.now() + 4000;
  room.raceStartedAt = undefined;
  room.raceEndsAt = undefined;
  io.to(room.code).emit("race:countdown", {
    startsAt: room.countdownEndsAt,
    serverNow: Date.now(),
  });
  emitSnapshot(room, io);
  room.countdownTimer = setTimeout(() => {
    room.phase = "racing";
    room.raceStartedAt = Date.now();
    room.countdownEndsAt = undefined;
    io.to(room.code).emit("race:started", { startedAt: room.raceStartedAt, serverNow: Date.now() });
    emitSnapshot(room, io);
    room.tickTimer = setInterval(() => {
      io.to(room.code).emit("race:standings", standingsOf(room));
    }, 400);
    room.peersTimer = setInterval(() => {
      const peers: Record<string, KartReport & { name: string; color: string }> = {};
      for (const p of room.players.values()) {
        if (p.waiting || !p.lastReport) continue;
        peers[p.playerId] = {
          x: p.lastReport.x,
          y: p.lastReport.y,
          z: p.lastReport.z,
          yaw: p.lastReport.yaw,
          speed: p.lastReport.speed,
          name: p.name,
          color: p.color,
        };
      }
      io.to(room.code).emit("kart:peers", peers);
    }, 66);
  }, 4000);
}

function finishRace(io: Server, room: Room, reason: string) {
  if (room.phase !== "racing") return;
  clearRaceTimers(room);
  room.phase = "finished";
  room.raceEndsAt = undefined;
  const results = standingsOf(room);
  io.to(room.code).emit("race:results", results);
  io.to(room.code).emit("race:message", { text: reason });
  emitSnapshot(room, io);
}

function handleKartState(io: Server, room: Room, player: Player, r: KartReport) {
  if (room.phase !== "racing" || player.waiting || player.finished) {
    player.lastReport = { ...r, at: Date.now() };
    return;
  }
  player.lastReport = { ...r, at: Date.now() };
  // Authoritative checkpoint / lap tracking from reported position.
  // The local query window keeps bridge/underpass levels distinct; if the
  // client legitimately jumped (respawn/reconnect), rebase the hint.
  let hint = player.lastT;
  if (typeof r.t === "number" && Number.isFinite(r.t)) {
    const rt = wrapT(r.t);
    let diff = Math.abs(rt - hint);
    diff = Math.min(diff, 1 - diff);
    if (diff > 0.06) hint = rt;
  }
  const q = queryNear(r.x, r.z, hint, 0.05);
  player.lastT = q.t;
  const expected = player.nextCp;
  if (expected !== 0) {
    // Checkpoint 0 is the finish line itself: it is validated by the forward
    // wrap below, not by proximity (its radius overlaps the approach and
    // would otherwise swallow the crossing and block lap counting).
    const cp = sampleAt(checkpointT(expected));
    const dx = r.x - cp.x;
    const dz = r.z - cp.z;
    const dy = r.y - cp.y;
    if (dx * dx + dz * dz < 11 * 11 && Math.abs(dy) < 4.5) {
      player.nextCp = (expected + 1) % NUM_CHECKPOINTS;
    }
  }
}

function handleKartStateWithWrap(
  io: Server,
  room: Room,
  player: Player,
  r: KartReport,
  prevT: number,
) {
  handleKartState(io, room, player, r);
  if (room.phase !== "racing" || player.waiting || player.finished) return;
  const crossedForward = prevT > 0.9 && player.lastT < 0.1;
  if (crossedForward && player.nextCp === 0) {
    player.lap += 1;
    player.nextCp = 1;
    if (player.lap >= TOTAL_LAPS) {
      player.finished = true;
      player.finishTimeMs = Date.now() - (room.raceStartedAt ?? Date.now());
      io.to(room.code).emit("race:message", {
        text: `${player.name} finished in ${formatTime(player.finishTimeMs)}!`,
      });
      io.to(room.code).emit("race:standings", standingsOf(room));
      const active = racers(room);
      const allDone = active.every((p) => p.finished || !p.connected);
      const anyConnectedRacing = active.some((p) => !p.finished && p.connected);
      if (allDone || active.filter((p) => p.finished).length === active.length) {
        finishRace(io, room, "Race complete!");
        return;
      }
      if (!room.finishTimer && anyConnectedRacing) {
        const firstOrder = standingsOf(room);
        void firstOrder;
        room.raceEndsAt = Date.now() + FINISH_TIMEOUT_MS;
        emitSnapshot(room, io);
        room.finishTimer = setTimeout(() => {
          finishRace(io, room, "Time expired — remaining racers ranked by progress.");
        }, FINISH_TIMEOUT_MS);
      }
    }
  }
}

function formatTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mm = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${String(mm).padStart(2, "0")}`;
}

// ---------------- HTTP (health + optional static client) ----------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const base = req.headers.origin ?? "";
  void base;
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/health" || url.pathname.startsWith("/socket.io")) return false;
  const candidates = [
    join(__dirname, "../../client"), // built: dist/server/server -> dist/client
    join(__dirname, "../../dist/client"), // dev via tsx: src/server -> dist/client
  ];
  for (const root of candidates) {
    try {
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = normalize(join(root, p));
      if (!file.startsWith(root)) continue;
      const st = await stat(file).catch(() => null);
      let target = file;
      if (!st) {
        // SPA fallback for hash-less deep links
        if (extname(file) === "") target = join(root, "index.html");
        else continue;
        const st2 = await stat(target).catch(() => null);
        if (!st2 || !st2.isFile()) continue;
      } else if (st.isDirectory()) {
        target = join(file, "index.html");
      }
      const data = await readFile(target);
      res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
      res.end(data);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

// ---------------- main ----------------

async function main() {
  const config = loadConfig();
  const httpServer = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    if (req.method === "GET") {
      try {
        if (await serveStatic(req, res)) return;
      } catch {
        // fall through
      }
      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, game: "cinder-peak-rally", rooms: rooms.size }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not found" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (config.allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`Origin not allowed: ${origin}`));
      },
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (raw) => {
    const socket = raw as TypedSocket;

    socket.on("room:create", ({ name, playerId }) => {
      if (rooms.size > 500) {
        socket.emit("room:error", { message: "Server is full, try again later." });
        return;
      }
      const code = makeCode();
      const room: Room = {
        code,
        hostId: "",
        phase: "lobby",
        players: new Map(),
        boxesTaken: new Map(),
        hazards: new Map(),
      };
      rooms.set(code, room);
      const pid = playerId ?? randomUUID();
      const player: Player = {
        playerId: pid,
        name: sanitizeName(name),
        color: KART_COLORS[0],
        socketId: null,
        connected: false,
        waiting: false,
        lastT: 0.997,
        lap: 0,
        nextCp: 1,
        finished: false,
        lastReport: null,
      };
      room.players.set(pid, player);
      room.hostId = pid;
      attachSocketToPlayer(io, socket, room, player);
    });

    socket.on("room:join", ({ code, name, playerId }) => {
      const normalized = (code ?? "").trim().toUpperCase();
      const room = rooms.get(normalized);
      if (!room) {
        socket.emit("room:error", {
          message: "Room not found. It may have closed after a server restart — create a new room.",
        });
        return;
      }
      const pid = playerId ?? randomUUID();
      const existing = room.players.get(pid);
      if (existing) {
        // Reconnect (same playerId): resume slot, even mid-race.
        existing.name = sanitizeName(name) || existing.name;
        existing.waiting = false;
        attachSocketToPlayer(io, socket, room, existing);
        return;
      }
      if (room.players.size >= MAX_PLAYERS) {
        socket.emit("room:error", { message: "Room is full (8 racers max)." });
        return;
      }
      const waiting = room.phase === "racing" || room.phase === "countdown";
      const player: Player = {
        playerId: pid,
        name: sanitizeName(name),
        color: colorFor(room),
        socketId: null,
        connected: false,
        waiting,
        lastT: 0.997,
        lap: 0,
        nextCp: 1,
        finished: false,
        lastReport: null,
      };
      room.players.set(pid, player);
      attachSocketToPlayer(io, socket, room, player);
      if (waiting) {
        socket.emit("race:message", { text: "Race in progress — you will join the next race." });
      }
    });

    socket.on("room:leave", () => {
      const ref = socketToRoom.get(socket.id);
      if (!ref) return;
      const room = rooms.get(ref.code);
      socketToRoom.delete(socket.id);
      socket.leave(ref.code);
      if (!room) return;
      room.players.delete(ref.playerId);
      if (room.hostId === ref.playerId) {
        const next = [...room.players.values()].find((p) => p.connected);
        if (next) {
          room.hostId = next.playerId;
          io.to(room.code).emit("race:message", { text: `${next.name} is now the host.` });
        }
      }
      if (room.players.size === 0) {
        destroyRoom(room.code);
        return;
      }
      // If everyone left mid-race, reset room to lobby.
      if (racers(room).filter((p) => p.connected).length === 0 && room.phase !== "lobby") {
        clearRaceTimers(room);
        room.phase = "lobby";
      }
      emitSnapshot(room, io);
    });

    socket.on("race:start", () => {
      const ref = socketToRoom.get(socket.id);
      if (!ref) return;
      const room = rooms.get(ref.code);
      if (!room || room.phase !== "lobby") return;
      if (room.hostId !== ref.playerId) {
        socket.emit("room:error", { message: "Only the host can start the race." });
        return;
      }
      const ready = [...room.players.values()].filter((p) => p.connected && !p.waiting);
      if (ready.length < MIN_PLAYERS) {
        socket.emit("room:error", { message: `Need at least ${MIN_PLAYERS} racers to start.` });
        return;
      }
      // Waiting players from a previous race rejoin the lobby pool automatically.
      for (const p of room.players.values()) p.waiting = false;
      startCountdown(io, room);
    });

    socket.on("race:rematch", () => {
      const ref = socketToRoom.get(socket.id);
      if (!ref) return;
      const room = rooms.get(ref.code);
      if (!room || room.phase !== "finished") return;
      if (room.hostId !== ref.playerId) {
        socket.emit("room:error", { message: "Only the host can start a rematch." });
        return;
      }
      for (const p of room.players.values()) {
        if (!p.connected) room.players.delete(p.playerId);
        else p.waiting = false;
      }
      room.phase = "lobby";
      room.countdownEndsAt = undefined;
      room.raceStartedAt = undefined;
      room.raceEndsAt = undefined;
      emitSnapshot(room, io);
    });

    socket.on("kart:state", (r) => {
      const ref = socketToRoom.get(socket.id);
      if (!ref) return;
      const room = rooms.get(ref.code);
      const player = room?.players.get(ref.playerId);
      if (!room || !player) return;
      if (typeof r?.x !== "number" || typeof r?.z !== "number") return;
      const prevT = player.lastT;
      handleKartStateWithWrap(io, room, player, r, prevT);
    });

    socket.on("item:request", ({ boxId, x, y, z }) => {
      const ref = socketToRoom.get(socket.id);
      if (!ref) return;
      const room = rooms.get(ref.code);
      const player = room?.players.get(ref.playerId);
      if (!room || !player || room.phase !== "racing" || player.waiting) return;
      if (room.boxesTaken.has(boxId)) return;
      const def = ITEM_BOXES.find((b) => b.id === boxId);
      if (!def) return;
      const pos = itemBoxPos(def);
      const d2 = (x - pos.x) ** 2 + (z - pos.z) ** 2;
      if (d2 > 9 * 9 || Math.abs(y - pos.y) > 5) return;
      const kind: ItemKind = Math.random() < 0.5 ? "boost" : "slick";
      const timer = setTimeout(() => {
        room.boxesTaken.delete(boxId);
        io.to(room.code).emit("item:boxes", [...room.boxesTaken.keys()]);
      }, 10000);
      room.boxesTaken.set(boxId, timer);
      socket.emit("item:granted", { kind });
      io.to(room.code).emit("item:boxes", [...room.boxesTaken.keys()]);
    });

    socket.on("item:use", ({ kind, x, y, z }) => {
      const ref = socketToRoom.get(socket.id);
      if (!ref) return;
      const room = rooms.get(ref.code);
      const player = room?.players.get(ref.playerId);
      if (!room || !player || room.phase !== "racing" || player.waiting) return;
      if (kind === "slick") {
        const id = randomUUID();
        const timer = setTimeout(() => {
          room.hazards.delete(id);
          io.to(room.code).emit("hazard:gone", { id });
        }, 45000);
        room.hazards.set(id, { id, ownerId: player.playerId, x, y, z, expiresAt: Date.now() + 45000, timer });
        io.to(room.code).emit("hazard:new", { id, ownerId: player.playerId, x, y, z });
      }
      // "boost" is applied client-side; nothing to relay.
    });

    socket.on("disconnect", () => {
      const ref = socketToRoom.get(socket.id);
      socketToRoom.delete(socket.id);
      if (!ref) return;
      const room = rooms.get(ref.code);
      const player = room?.players.get(ref.playerId);
      if (!room || !player) return;
      player.connected = false;
      player.socketId = null;
      if (room.hostId === player.playerId) {
        const next = [...room.players.values()].find((p) => p.connected);
        if (next) {
          room.hostId = next.playerId;
          io.to(room.code).emit("race:message", {
            text: `${player.name} disconnected. ${next.name} is now the host.`,
          });
        }
      }
      // Keep the slot briefly so a short disconnect can rejoin the same race.
      player.removalTimer = setTimeout(() => {
        const r = rooms.get(room.code);
        const pl = r?.players.get(player.playerId);
        if (!pl || pl.connected) return;
        r!.players.delete(player.playerId);
        if (r!.players.size === 0) {
          // Nobody left: give stragglers a minute, then free the room.
          r!.emptyTimer = setTimeout(() => {
            const rr = rooms.get(room.code);
            if (rr && [...rr.players.values()].every((p) => !p.connected)) {
              destroyRoom(room.code);
            }
          }, 60000);
          return;
        }
        if (r!.hostId === player.playerId) {
          const next = [...r!.players.values()].find((p) => p.connected);
          if (next) r!.hostId = next.playerId;
        }
        emitSnapshot(r!, io);
      }, 90000);
      emitSnapshot(room, io);
    });
  });

  httpServer.listen(config.port, config.host, () => {
    console.log(`[cinder-peak-rally] backend on http://${config.host}:${config.port}`);
    console.log(`[cinder-peak-rally] allowed origins: ${config.allowedOrigins.join(", ")}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
