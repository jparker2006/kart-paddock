import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { RoomManager } from './RoomManager.js';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  KartColorId,
  KartTransform,
  ItemType,
} from '../shared/types.js';
import { SERVER_TICK_RATE } from '../shared/constants.js';

dotenv.config();

const port = parseInt(process.env.PORT || '3001', 10);
const host = process.env.HOST || '0.0.0.0';
const rawAllowedOrigins = process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:4173';
const allowedOrigins = rawAllowedOrigins
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const basePath = process.env.BASE_PATH || '/';
const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Also allow origin if in development or matching hostname
      return callback(null, true);
    },
    credentials: true,
  })
);

app.use(express.json());

const server = http.createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const roomManager = new RoomManager(io);

// Lightweight health check endpoint (available at /health and at ${normalizedBase}health)
const healthHandler = (_req: express.Request, res: express.Response) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    rooms: roomManager.getRoomCount(),
    timestamp: Date.now(),
  });
};

app.get('/health', healthHandler);
if (normalizedBase !== '/') {
  app.get(`${normalizedBase}health`, healthHandler);
}

// Serve static client build if dist/client exists
const currentFileUrl = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFileUrl);
const candidateClientPaths = [
  path.resolve(currentDir, '../client'),
  path.resolve(currentDir, '../../dist/client'),
];
const clientDistPath = candidateClientPaths.find((p) => fs.existsSync(p));

if (clientDistPath) {
  const mountRoute = normalizedBase === '/' ? '/' : normalizedBase.replace(/\/$/, '');
  app.use(mountRoute, express.static(clientDistPath));
  if (mountRoute !== '/') {
    app.get(mountRoute, (_req, res) => {
      res.sendFile(path.join(clientDistPath, 'index.html'));
    });
  }
  app.get(`${mountRoute === '/' ? '' : mountRoute}/*`, (req, res, next) => {
    if (req.path.includes('/health')) return next();
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Handle WebSocket connections
io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  let currentRoomCode: string | null = null;
  let currentPlayerId: string | null = null;

  socket.on('create_room', ({ playerName, color }) => {
    const playerId = `p_${socket.id.substring(0, 6)}_${Date.now().toString(36)}`;
    const reconnectToken = `tok_${Math.random().toString(36).substring(2, 10)}`;
    const room = roomManager.createRoom(playerId);
    currentRoomCode = room.code;
    currentPlayerId = playerId;

    socket.join(room.code);
    room.addPlayer(socket.id, playerId, playerName, color, reconnectToken);
    socket.emit('joined_room', { roomCode: room.code, playerId, reconnectToken });
    room.broadcastRoomState();
  });

  socket.on('join_room', ({ roomCode, playerName, color, reconnectToken }) => {
    const upperCode = roomCode.toUpperCase().trim();
    const room = roomManager.getRoom(upperCode);
    if (!room) {
      socket.emit('error_message', `Room "${upperCode}" not found. Please check the code or create a new room.`);
      return;
    }

    if (room.getPlayerCount() >= 8) {
      socket.emit('error_message', `Room "${upperCode}" is full (maximum 8 players).`);
      return;
    }

    const playerId = `p_${socket.id.substring(0, 6)}_${Date.now().toString(36)}`;
    const token = reconnectToken || `tok_${Math.random().toString(36).substring(2, 10)}`;
    currentRoomCode = room.code;
    currentPlayerId = playerId;

    socket.join(room.code);
    room.addPlayer(socket.id, playerId, playerName, color, token);
    socket.emit('joined_room', { roomCode: room.code, playerId, reconnectToken: token });
    room.broadcastRoomState();
  });

  socket.on('rejoin_room', ({ roomCode, playerId, reconnectToken }) => {
    const upperCode = roomCode.toUpperCase().trim();
    const room = roomManager.getRoom(upperCode);
    if (!room) {
      socket.emit('error_message', 'Room not found or server was restarted. Please return to the lobby.');
      return;
    }

    const player = room.reconnectPlayer(socket.id, playerId, reconnectToken);
    if (!player) {
      socket.emit('error_message', 'Reconnect session expired or invalid. Please join again.');
      return;
    }

    currentRoomCode = room.code;
    currentPlayerId = playerId;
    socket.join(room.code);
    socket.emit('joined_room', { roomCode: room.code, playerId, reconnectToken });
    room.broadcastRoomState();
  });

  socket.on('select_color', (color: KartColorId) => {
    if (!currentRoomCode || !currentPlayerId) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room) return;

    const player = room.players.get(currentPlayerId);
    if (player && room.status === 'lobby') {
      player.color = color;
      room.broadcastRoomState();
    }
  });

  socket.on('start_race', () => {
    if (!currentRoomCode || !currentPlayerId) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room) return;

    // Only room host can start
    if (room.hostId === currentPlayerId) {
      const started = room.startCountdown();
      if (!started) {
        socket.emit('error_message', 'Need at least 2 players in the room to start the race.');
      }
    }
  });

  socket.on('kart_update', (transform) => {
    if (!currentRoomCode || !currentPlayerId) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room || room.status !== 'racing') return;

    room.updatePlayerTransform(currentPlayerId, transform);
  });

  socket.on('collect_item_box', (boxId: number) => {
    if (!currentRoomCode || !currentPlayerId) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room || room.status !== 'racing') return;

    room.collectItemBox(currentPlayerId, boxId);
  });

  socket.on('use_item', (data) => {
    if (!currentRoomCode || !currentPlayerId) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room || room.status !== 'racing') return;

    room.useItem(currentPlayerId, data);
  });

  socket.on('mine_triggered', (mineId: string) => {
    if (!currentRoomCode || !currentPlayerId) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room || room.status !== 'racing') return;

    room.triggerMine(mineId, currentPlayerId);
  });

  socket.on('request_rematch', () => {
    if (!currentRoomCode || !currentPlayerId) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room) return;

    room.voteRematch(currentPlayerId);
  });

  socket.on('disconnect', () => {
    if (currentRoomCode) {
      const room = roomManager.getRoom(currentRoomCode);
      if (room) {
        room.handleDisconnect(socket.id);
      }
    }
  });
});

// Fixed interval server game tick
const tickIntervalMs = 1000 / SERVER_TICK_RATE;
let lastTickTime = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastTickTime) / 1000, 0.1);
  lastTickTime = now;
  roomManager.updateTick(dt);
}, tickIntervalMs);

// Start HTTP server with strict port conflict handling
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[FATAL ERROR] Port ${port} is already in use.`);
    console.error(`To fix, free port ${port} or set PORT in your environment.\n`);
    process.exit(1);
  } else {
    console.error('[FATAL SERVER ERROR]', err);
    process.exit(1);
  }
});

server.listen(port, host, () => {
  console.log(`\n======================================================`);
  console.log(`  HYPERKART SERVER STARTED SUCCESSFULLY`);
  console.log(`  Listening on: http://${host}:${port}`);
  console.log(`  Health Check: http://${host}:${port}/health`);
  console.log(`  Allowed Origins: ${allowedOrigins.join(', ')}`);
  console.log(`======================================================\n`);
});
