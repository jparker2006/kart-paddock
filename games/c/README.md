# Harvest Rush 🎃🏁

A cozy autumn **3D kart-racing game for 2–8 human players**, built from scratch with
TypeScript, Three.js and Socket.IO. Race your friends around **Cider Creek Raceway**:
a dirt loop with a big hill climb, a windmill overpass that crosses above the start
straight, and a wooden-ramp jump over Cider Creek (fall short and you splash).

Every race is **3 laps**. Drift for turbo, grab items from crates, and finish first.

---

## Quick start

Requires **Node.js ≥ 24** and npm.

```bash
npm ci          # reproducible install from the lockfile
npm run dev     # backend on :3001 + frontend on :5173 (hot reload)
```

Open **http://localhost:5173**, enter a name, **Create a room**, and share the
4-character code (or the invite link) with friends on other computers.

### All commands

| Command | What it does |
| --- | --- |
| `npm ci` | Reproducibly install from `package-lock.json` |
| `npm run dev` | Run the backend (`tsx watch`) and Vite dev server together |
| `npm run build` | Type-check, build the static client into `dist/client/` and the Node backend into `dist/server/` |
| `npm start` | Run the built Node backend (`node dist/server/src/index.js`) |
| `npm run preview` | Serve the built frontend locally (`vite preview`) |
| `npm run typecheck` | Type-check both client and server without emitting |
| `npx tsx tools/check-track.ts` | Validate the track layout (clearances, gap geometry) |
| `node tools/e2e/*.mjs` | Real-browser E2E tests (see *Testing* below) |

## Configuration

Copy `.env.example` to `.env` for local overrides. All variables are optional.

| Variable | Stage | Meaning | Default |
| --- | --- | --- | --- |
| `BASE_PATH` | client dev + build | Base path the client is served under, with leading **and** trailing slash (e.g. `/games/a/`) | `/` |
| `VITE_GAME_SERVER_URL` | client dev + build | Public URL of the game backend | `http://localhost:3001` |
| `CLIENT_PORT` | client dev | Vite dev server port (conflicts are reported, never silently moved) | `5173` |
| `PREVIEW_PORT` | client preview | `vite preview` port | `4173` |
| `PORT` | backend runtime | Backend listen port (honors the provider's `PORT`) | `3001` |
| `HOST` | backend runtime | Backend bind address | `0.0.0.0` |
| `ALLOWED_ORIGINS` | backend runtime | Comma-separated browser origins allowed to connect (HTTP + WebSocket). Use `*` to allow any. | `http://localhost:5173,http://localhost:4173` |

The backend is a single long-lived Node process (WebSocket state relay, rooms,
race arbitration) — it is **not** serverless-compatible. It exposes
`GET /health` (HTTP 200 `{ok:true,...}` when ready). Production traffic is
HTTPS/WSS terminated by the host; no secrets live in the browser configuration.

### Deployment boundary

The client is a static bundle (build with `BASE_PATH=/games/a/` and your public
`VITE_GAME_SERVER_URL`) that can be hosted anywhere — e.g. under a nested path on
Vercel — while the backend runs as one persistent Node service (e.g. Render) with
`ALLOWED_ORIGINS` set to the client origin. Every asset, route, invite link and
storage key is derived from `BASE_PATH` at build/runtime, so the game works at
`/` or nested, standalone or in an iframe (click once to focus/enable audio).

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Accelerate |
| `S` / `↓` | Brake / reverse |
| `A` `D` / `←` `→` | Steer |
| `SPACE` (or `Shift`) | Drift — hold through a corner for a mini-turbo (3 tiers) |
| `E` | Use item |
| `R` | Respawn at the last checkpoint |
| `M` | Mute / unmute |

## Items

Crate icons on the track hold one of three items (weighted by race position):

- 🧃 **Cider Turbo** — instant speed boost
- 🍯 **Honey Drop** — drops sticky honey behind you; karts that hit it slip and slow
- 🌽 **Corn Cobber** — fires forward and spins out the first kart it hits

Orange arrow pads on the track give a free boost.

## Architecture

- **Client** (`src/client/`): Three.js renderer, custom arcade kart physics
  (fixed-step, spline-based ground queries with two independent track levels),
  checkpoint/lap progression (sequential boundary crossings — cutting, reversing
  or respawning can never produce a false lap), items, HUD, minimap, WebAudio
  synthesizer (no audio files).
- **Shared protocol** (`src/shared/protocol.ts`): typed Socket.IO payloads.
- **Server** (`server/src/`): rooms (2–8 humans, codes, invite links, join
  mid-race as a waiting player), race state machine (countdown → racing →
  results), 15 Hz state relay, live standings, finish arbitration with
  server-side validation and DNF handling, reconnect-by-token with race
  snapshots. Rooms are in-memory only — a backend restart resets rooms, and the
  UI explains that and offers a fresh start.
- **Testing** (`tools/`): track validator plus real-Chromium E2E scripts
  (`tools/e2e/`, playwright-core) that drive up to 8 simultaneous clients.

## Testing performed

All multiplayer scenarios were exercised with real Chromium browser clients
(see `tools/e2e/`): 3-player full races with consistent results and rematch,
an 8-player race (with DNF handling), mid-race reload reconnection, two-room
isolation, the jump, the overpass, and the production build under `/games/a/`.

## Asset attribution

All 3D models, textures, sounds and the track are **procedurally generated by
this repository's own code** — no external art or audio assets are used.
Libraries: [three](https://github.com/mrdoob/three.js) (MIT),
[socket.io](https://socket.io) (MIT), [socket.io-client](https://socket.io) (MIT);
dev tooling: Vite (MIT), tsx (MIT), TypeScript (Apache-2.0), playwright-core
(Apache-2.0, E2E testing only).
