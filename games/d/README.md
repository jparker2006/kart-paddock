# 🌋 Cinder Peak Rally

An original browser-based 3D multiplayer kart racer. Race 2–8 friends around a volcano-island
circuit with an obsidian overpass bridge, a lava-gap jump, drift boosts, and throwable oil slicks.

Built from scratch with Three.js (3D), Socket.IO (multiplayer), and TypeScript — no kart-game
template, no accounts, no database.

## Quick start

Requirements: Node 24.20.0, npm 11.19.0.

```bash
npm ci            # reproducible install from package-lock.json
npm run dev       # frontend (vite) + backend together
```

Open the printed frontend URL (default http://localhost:5173/) in 2–8 browser windows,
enter a name, create a room, share the room link, and race.

## Commands

| Command           | Behavior                                                              |
| ----------------- | --------------------------------------------------------------------- |
| `npm ci`          | Reproducibly install from `package-lock.json`                         |
| `npm run dev`     | Run frontend + backend locally together                               |
| `npm run build`   | Type-check, build static client into `dist/client/`, backend into `dist/server/` |
| `npm start`       | Run the built Node backend (`dist/server/server/main.js`)             |
| `npm run preview` | Serve the built frontend locally for verification                     |

## Configuration

| Variable              | Meaning (default)                                                        |
| --------------------- | ------------------------------------------------------------------------ |
| `BASE_PATH`           | Client dev/build base path, trailing slash (`/`)                         |
| `VITE_GAME_SERVER_URL`| Public backend URL the browser connects to (`http://localhost:3001`)    |
| `CLIENT_PORT`         | Local frontend dev port (`5173`)                                         |
| `PREVIEW_PORT`        | Local built-frontend preview port (`4173`)                               |
| `PORT`                | Backend runtime port (`3001`; honors the provider's value)               |
| `HOST`                | Backend bind address (`0.0.0.0`)                                         |
| `ALLOWED_ORIGINS`     | Comma-separated browser origins (`http://localhost:5173,http://localhost:4173`) |

Copy `.env.example` to `.env` to override locally. Ports use `strictPort`:
a conflict fails loudly instead of silently picking another port.

Backend health: `GET /health` → HTTP 200 `{"ok":true}`.

Production split (organizer step): serve `dist/client/` as static files under the
configured base path, and run `dist/server/` as one persistent Node service over
HTTPS with `VITE_GAME_SERVER_URL` / `ALLOWED_ORIGINS` pointed at the real origins.
The backend cannot move into a serverless function unchanged — rooms, race clocks,
and peer relays are held in process memory by design.

## How to play

- **W / ↑** accelerate · **S / ↓** brake & reverse · **A D / ← →** steer
- **Space** drift (hold while steering; release for a boost — watch the BOOST meter)
- **E** use item · **R** respawn at last checkpoint · **M** mute
- 3 laps around Cinder Peak Circuit. Ember gifts 🎁 grant a **rocket boost** 🚀 or an
  **oil slick** 🛢️ to drop for rivals. The lava-gap jump needs speed — too slow and
  you'll need a respawn. The obsidian bridge crosses *over* the low road; falling off
  lands you below (or in the lava if you're unlucky).
- Host starts the race (2–8 racers). Joining mid-race parks you as a spectator until
  the rematch. Brief disconnects keep your slot for 90s — just rejoin with the same
  browser. A backend restart closes rooms; the UI says so and offers a fresh start.

## Project layout

```
src/shared/track.ts     track math shared by client + server (centerline, checkpoints, jump, bridge)
src/shared/protocol.ts  Socket.IO event types
src/server/main.ts      rooms, race control, authoritative laps/standings, items, health endpoint
src/server/config.ts    PORT/HOST/ALLOWED_ORIGINS
src/client/             Three.js game: physics, world, karts, audio, HUD, lobby
public/                 static assets (favicon)
```

`BASE_PATH` is respected for every asset, route, share link, and storage key
(`import.meta.env.BASE_URL`, namespaced localStorage). No localhost or production
hostnames are hard-coded into gameplay.

## Assets & attribution

All visuals and audio are generated procedurally in code (Three.js geometry,
canvas textures, WebAudio synthesis). No third-party art or audio is bundled,
so there are no attribution requirements.

Dependencies (pinned in `package.json`, locked in `package-lock.json`):
three 0.185.1, socket.io 4.8.3, socket.io-client 4.8.3 (runtime);
typescript 7.0.2, vite 8.2.2, tsx 4.23.13, concurrently 10.0.5, @types/node 24.3.1,
@types/three 0.185.1, puppeteer-core 25.10.0 (dev).

## Automated browser tests

`test/e2e-race.mjs` (3 headless-Chrome clients: lobby → 3-lap race → synchronized
results → rematch) and `test/e2e-edge.mjs` (room isolation, drift boost, both item
effects, backward-lap rejection, lava/respawn, reconnect, 8-player start) drive the
real game through headless Chrome (system browser + `?lowfx` software rendering).
Evidence and result JSON land in `test/evidence/`. The in-page `window.__cpr` hook
(autopilot, input override, teleport, state snapshot) exists only to make those
browser tests deterministic; it grants no advantage a normal client couldn't get
by sending its own inputs.
