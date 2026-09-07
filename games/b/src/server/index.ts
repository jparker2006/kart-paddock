import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { loadDotEnv, readConfig, isOriginAllowed } from './env.ts';
import { RoomManager } from './roomManager.ts';
import type { ClientToServer, ServerToClient } from '../shared/protocol.ts';
import { GAME_NAME } from '../shared/constants.ts';

loadDotEnv();
const config = readConfig();
const VERSION = '1.0.0';
const startedAt = Date.now();

const rooms = new RoomManager();

const httpServer = createServer((req, res) => {
  const origin = req.headers.origin;
  const originOk = isOriginAllowed(origin, config.allowedOrigins);
  if (origin && originOk) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health' || url.pathname === '/health/') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(
      JSON.stringify({
        ok: true,
        game: GAME_NAME,
        version: VERSION,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        rooms: rooms.count(),
        players: rooms.playerCount(),
      }),
    );
    return;
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`${GAME_NAME} backend ${VERSION}. The game client is served separately. GET /health for status.\n`);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
});

const io = new Server<ClientToServer, ServerToClient>(httpServer, {
  cors: {
    origin: (origin, cb) => {
      if (isOriginAllowed(origin, config.allowedOrigins)) cb(null, true);
      else cb(new Error(`Origin ${origin} is not allowed`));
    },
    credentials: false,
  },
  // Browsers behind strict proxies fall back to long-polling; both work over HTTPS/WSS.
  transports: ['websocket', 'polling'],
  // Generous ping timeout so a busy or briefly frozen tab is not dropped.
  pingInterval: 5000,
  pingTimeout: 20000,
  maxHttpBufferSize: 64 * 1024,
  serveClient: false,
});

io.on('connection', (socket) => {
  socket.emit('server:info', { version: VERSION, time: Date.now() });
  rooms.attach(socket);
});

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n[server] Port ${config.port} is already in use on ${config.host}.\n` +
        `         Stop the other process or set PORT to a free port. Refusing to pick a random port.\n`,
    );
  } else {
    console.error('[server] failed to start:', err);
  }
  process.exit(1);
});

httpServer.listen(config.port, config.host, () => {
  console.log(`[server] ${GAME_NAME} backend ${VERSION} listening on http://${config.host}:${config.port}`);
  console.log(`[server] health check: GET /health`);
  console.log(`[server] allowed origins: ${config.allowedOrigins.join(', ')}`);
});

function shutdown(signal: string) {
  console.log(`[server] ${signal} received, shutting down`);
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
