import { createServer } from 'node:http';
import { Server } from 'socket.io';
import {
  type CharacterMsg,
  type CreateMsg,
  type FinishMsg,
  type HitMsg,
  type JoinMsg,
  type KartState,
  type PickupAck,
  type PickupMsg,
  type ShutdownMsg,
  type UseItemMsg,
  type JoinAck,
} from '../../src/shared/protocol.js';
import { config } from './env.js';
import { RoomManager, sanitizeName, normalizeCharacter, type Room, type Player } from './rooms.js';
import { Race } from './race.js';

const packageVersion = '1.0.0';

const httpServer = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/health/') {
    const body = JSON.stringify({
      ok: true,
      status: 'ready',
      version: packageVersion,
      uptimeSec: Math.round(process.uptime()),
      rooms: roomManager.roomCount,
      players: roomManager.playerCount,
    });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Not found. This server only hosts game sockets and /health.' }));
});

const allowedAll = config.allowedOrigins.includes('*');

const io = new Server(httpServer, {
  cors: {
    origin: (origin, cb) => {
      if (!origin || allowedAll || config.allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
    methods: ['GET', 'POST'],
  },
  // engine-level gate: actually reject handshakes from disallowed origins
  allowRequest: (req, allow) => {
    const origin = req.headers.origin as string | undefined;
    if (!origin || allowedAll || config.allowedOrigins.includes(origin)) {
      allow(null, true);
    } else {
      allow(null, false);
    }
  },
  transports: ['websocket', 'polling'],
  pingInterval: 5000,
  pingTimeout: 20000,
  perMessageDeflate: false,
});

const roomManager = new RoomManager(io);

function failAck(ack: ((a: { ok: boolean; error?: string }) => void) | undefined, error: string): void {
  ack?.({ ok: false, error });
}

io.on('connection', (socket) => {
  let bound: { roomCode: string; playerId: string } | null = null;

  socket.on('room:create', (msg: CreateMsg, ack?: (a: JoinAck) => void) => {
    const res = roomManager.createRoom(sanitizeName(msg?.name), normalizeCharacter(msg?.character));
    if ('error' in res) return failAck(ack, res.error);
    const { room, player } = res;
    roomManager.attach(socket, room, player);
    bound = { roomCode: room.code, playerId: player.id };
    ack?.({ ok: true, token: player.token, room: room.info(player.id) });
    room.emitRoom(io);
  });

  socket.on('room:join', (msg: JoinMsg, ack?: (a: JoinAck) => void) => {
    const res = roomManager.joinRoom(
      String(msg?.code ?? ''),
      sanitizeName(msg?.name),
      normalizeCharacter(msg?.character),
      typeof msg?.token === 'string' ? msg.token : undefined,
      socket.id
    );
    if ('error' in res) return failAck(ack, res.error);
    const { room, player } = res;
    roomManager.attach(socket, room, player);
    bound = { roomCode: room.code, playerId: player.id };
    ack?.({ ok: true, token: player.token, room: room.info(player.id) });
    if (room.race && (room.phase === 'racing' || room.phase === 'countdown' || room.phase === 'results')) {
      socket.emit('race:snapshot', room.race.snapshotFor(player));
    }
    room.emitRoom(io);
  });

  socket.on('room:character', (msg: CharacterMsg, ack?: (a: JoinAck) => void) => {
    const ctx = current();
    if (!ctx) return failAck(ack, 'You are not in a room.');
    ctx.player.character = normalizeCharacter(msg?.character);
    ack?.({ ok: true });
    ctx.room.emitRoom(io);
  });

  socket.on('room:start', (ack?: (a: JoinAck) => void) => {
    const ctx = current();
    if (!ctx) return failAck(ack, 'You are not in a room.');
    if (!ctx.player.isHost) return failAck(ack, 'Only the host can start the race.');
    if (!ctx.room.race) ctx.room.race = new Race(io, ctx.room);
    const res = ctx.room.race.start();
    if (!res.ok) return failAck(ack, res.error);
    ack?.({ ok: true });
  });

  socket.on('room:rematch', (ack?: (a: JoinAck) => void) => {
    const ctx = current();
    if (!ctx) return failAck(ack, 'You are not in a room.');
    if (!ctx.player.isHost) return failAck(ack, 'Only the host can start the next race.');
    if (ctx.room.phase !== 'results' && ctx.room.phase !== 'lobby') {
      return failAck(ack, 'Wait for the current race to finish.');
    }
    if (!ctx.room.race) ctx.room.race = new Race(io, ctx.room);
    const res = ctx.room.race.start();
    if (!res.ok) return failAck(ack, res.error);
    ack?.({ ok: true });
  });

  socket.on('room:lobby', (ack?: (a: JoinAck) => void) => {
    const ctx = current();
    if (!ctx) return failAck(ack, 'You are not in a room.');
    if (!ctx.player.isHost) return failAck(ack, 'Only the host can return everyone to the lobby.');
    if (ctx.room.phase === 'racing' || ctx.room.phase === 'countdown') {
      return failAck(ack, 'A race is running. Finish it first.');
    }
    ctx.room.race?.dispose();
    ctx.room.race = null;
    ctx.room.phase = 'lobby';
    for (const p of ctx.room.players.values()) {
      p.lastState = null;
      p.item = null;
      p.place = null;
      p.finishTimeMs = null;
      p.waiting = false;
    }
    ack?.({ ok: true });
    ctx.room.emitRoom(io);
  });

  socket.on('room:leave', () => {
    if (!bound) return;
    const room = roomManager.rooms.get(bound.roomCode);
    const player = room?.players.get(bound.playerId);
    if (room && player) {
      if (room.phase === 'racing' || room.phase === 'countdown') {
        roomManager.disconnectPlayer(room, player, true);
      } else {
        roomManager.removePlayer(room, player);
        room.emitRoom(io);
      }
    }
    socket.leave(bound.roomCode);
    bound = null;
  });

  socket.on('state', (s: KartState) => {
    if (!bound || !s) return;
    const room = roomManager.rooms.get(bound.roomCode);
    const player = room?.players.get(bound.playerId);
    if (!room || !player || !room.race) return;
    room.race.handleState(player, s);
  });

  socket.on('pickup', (msg: PickupMsg, ack?: (a: PickupAck) => void) => {
    if (!bound) return ack?.({ ok: false });
    const room = roomManager.rooms.get(bound.roomCode);
    const player = room?.players.get(bound.playerId);
    if (!room || !player || !room.race) return ack?.({ ok: false });
    const res = room.race.handlePickup(player, Number(msg?.box ?? -1));
    ack?.(res);
  });

  socket.on('item:use', (msg: UseItemMsg) => {
    if (!bound) return;
    const room = roomManager.rooms.get(bound.roomCode);
    const player = room?.players.get(bound.playerId);
    if (!room || !player || !room.race) return;
    room.race.handleUseItem(player, {
      kind: msg?.kind,
      x: Number(msg?.x) || 0,
      y: Number(msg?.y) || 0,
      z: Number(msg?.z) || 0,
      yaw: Number(msg?.yaw) || 0,
    });
  });

  socket.on('item:hit', (msg: HitMsg) => {
    if (!bound) return;
    const room = roomManager.rooms.get(bound.roomCode);
    const player = room?.players.get(bound.playerId);
    if (!room || !player || !room.race) return;
    room.race.handleHit(player, { kind: msg?.kind === 'spin' ? 'spin' : 'slip', by: msg?.by, proj: msg?.proj });
  });

  socket.on('race:finish', (msg: FinishMsg) => {
    if (!bound) return;
    const room = roomManager.rooms.get(bound.roomCode);
    const player = room?.players.get(bound.playerId);
    if (!room || !player || !room.race) return;
    room.race.handleFinish(player, { lap: Number(msg?.lap ?? 0) });
  });

  function current(): { room: Room; player: Player } | null {
    if (!bound) return null;
    const room = roomManager.rooms.get(bound.roomCode);
    const player = room?.players.get(bound.playerId);
    if (!room || !player) return null;
    return { room, player };
  }

  socket.on('disconnect', () => {
    if (!bound) return;
    const room = roomManager.rooms.get(bound.roomCode);
    const player = room?.players.get(bound.playerId);
    // Ignore stale disconnects (the seat was taken over by a reconnect).
    if (player && player.socketId !== socket.id) return;
    if (room && player) {
      roomManager.disconnectPlayer(room, player, false);
      room.race?.checkAllFinished(room, io);
    }
  });
});

// Relay kart states at a fixed cadence to smooth out bursts.
setInterval(() => {
  for (const room of roomManager.rooms.values()) {
    if ((room.phase === 'racing' || room.phase === 'countdown') && room.race) {
      room.race.broadcastStates();
    }
  }
}, 1000 / 15);

// Periodic sweeps for stale players and dead rooms.
setInterval(() => roomManager.sweep(), 5000);

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[harvest-rush] Port ${config.port} is already in use. Free it or set PORT to another value.`);
  } else {
    console.error('[harvest-rush] Server error:', err);
  }
  process.exit(1);
});

httpServer.listen(config.port, config.host, () => {
  console.log(`[harvest-rush] backend listening on http://${config.host}:${config.port} (health: GET /health)`);
  console.log(`[harvest-rush] allowed origins: ${allowedAll ? '*' : config.allowedOrigins.join(', ')}`);
});

function shutdown(reason: string): void {
  const msg: ShutdownMsg = { reason };
  io.emit('shutdown', msg);
  io.disconnectSockets(true);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', () => shutdown('The game server was stopped.'));
process.on('SIGTERM', () => shutdown('The game server is restarting.'));
