# Bumble Rally 🐝

An online 3D kart-racing game for 2–8 friends that runs in the browser. Race three laps around
the **Garden Loop** as bee-buggies: climb the hill, cross the garden-hose bridge above the start
straight, launch off the bumblebee ramp, drift for boosts and sting the racer ahead with an angry wasp.

- **Client:** static site built with Vite 8 + TypeScript 7 + Three.js (procedural art, no external assets).
- **Backend:** one persistent Node 24 process (Socket.IO 4) that owns rooms, race state, checkpoints,
  laps, items and results. Everything is in memory; no database or third-party service is needed.
- **Deployment boundary:** the client and backend are independent. The client is configured at build
  time with the backend's public URL and can live under any base path (for example nested inside another
  website); the backend can run anywhere a long-lived Node process is allowed (it is *not* a serverless
  function).

---

## Quick start

Requirements: Node 24.20.0 and npm 11.19.0 (other Node 24 releases should work too).

```bash
npm ci          # reproducible install from package-lock.json
npm run dev     # backend on http://localhost:3001 + client on http://localhost:5173
```

Open <http://localhost:5173>, enter a name and **Create a room**. Friends join with the 5-letter room code
or the invite link (`?room=CODE`). When at least two racers are in the lobby the host presses **Start race**.

### Commands

| Command            | What it does                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `npm ci`           | Install exact dependencies from the lockfile.                                                 |
| `npm run dev`      | Run backend (`tsx watch`) and Vite dev server together, with hot reload.                      |
| `npm run build`    | Type-check everything, build the client into `dist/client/`, compile the backend into `dist/server/`. |
| `npm start`        | Run the built backend (`node dist/server/server/index.js`).                                   |
| `npm run preview`  | Serve the built client from `dist/client/` on the preview port (honours `BASE_PATH`).         |
| `npm run typecheck`| Type-check client and server without emitting.                                                |

Ports are never silently changed: if a configured port is busy the process reports the conflict and exits.

### Configuration

Copy `.env.example` to `.env` for local overrides. All values are optional.

| Variable               | Stage            | Meaning                                                                                     | Default                                         |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `BASE_PATH`            | client dev/build | URL prefix the client is served from, with trailing slash (e.g. `/games/a/`).               | `/`                                             |
| `VITE_GAME_SERVER_URL` | client dev/build | Public origin of the backend the browser connects to (HTTPS in production).                 | `http://localhost:3001`                         |
| `CLIENT_PORT`          | client dev       | Vite dev-server port.                                                                        | `5173`                                          |
| `PREVIEW_PORT`         | client preview   | Port for `npm run preview`.                                                                  | `4173`                                          |
| `PORT`                 | backend runtime  | Backend listen port (hosting providers inject this).                                        | `3001`                                          |
| `HOST`                 | backend runtime  | Backend bind address.                                                                       | `0.0.0.0`                                       |
| `ALLOWED_ORIGINS`      | backend runtime  | Comma-separated browser origins allowed for HTTP + WebSocket (add the production site here). | `http://localhost:5173,http://localhost:4173`   |

Only `VITE_`-prefixed variables reach the browser bundle; nothing secret is needed by the client.

Example production build for a client hosted under `https://site.example/games/a/` talking to a backend at
`https://bumble-rally.example.com`:

```bash
BASE_PATH=/games/a/ VITE_GAME_SERVER_URL=https://bumble-rally.example.com npm run build
```

and run the backend with `ALLOWED_ORIGINS=https://site.example PORT=<provider port> npm start`.

### Health check

`GET /health` on the backend returns `200` with a small JSON document (`{"ok":true,...}`) once the server
is listening. Any other path returns 404 except `/`, which prints a short plain-text description.

---

## How to play

### Controls (keyboard)

| Key                          | Action                                                            |
| ---------------------------- | ----------------------------------------------------------------- |
| `W` / `↑`                    | Accelerate                                                        |
| `S` / `↓`                    | Brake, then reverse                                               |
| `A` `D` / `←` `→`            | Steer                                                             |
| `Shift` or `Space`           | Hold while turning to drift; release for a mini/super boost       |
| `E` / `Enter`                | Use the held item                                                 |
| `R`                          | Respawn at the last checkpoint (if you are stuck)                 |
| `M`                          | Mute / unmute                                                     |

A **Leave room** button sits at the top of the race view for anyone who has to quit mid-race.

Click the game once so it has keyboard focus (also required when embedded in an iframe); audio starts on
that first click or key press, as browsers require.

### Items

| Item            | Effect                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| 🍯 Nectar Boost | A long burst of speed.                                                   |
| 🫠 Honey Puddle | Drops a sticky puddle behind you; anyone who drives through spins out.  |
| 🐝 Angry Wasp   | Flies up the track and stings the next racer ahead of you.              |

Drive through the golden honey-jar boxes on the track to receive an item (racers further back get more
wasps). Orange chevron pads give a speed boost; the one before the yellow-and-black bumblebee ramp helps you clear the jump.

### Track features

- **Elevation:** the hill climbs to ~19 m; the hilltop has no barriers, so drifting wide sends you off the
  cliff and back to the last checkpoint.
- **Bridge:** the garden-hose bridge crosses 10 m above the start straight. Racers drive underneath it on
  every lap and over it a little later.
- **Jump:** the striped bumblebee ramp launches you over a 22 m gap. Too slow and you fall through and respawn.
- **Checkpoints:** 10 ordered checkpoints (the finish line is one of them). A lap only counts when all of
  them are crossed in order, so reversing over the line, cutting, or falling from the bridge onto the road
  below can never award a lap. Respawns put you just past the last checkpoint you *did* cross.

### Rooms & connection

- Rooms hold 2–8 players and are isolated from each other. Anyone joining while a race is running watches
  the leader and joins the next race.
- If your connection drops briefly, the client reconnects automatically and you resume in the same race
  (your seat is kept for 90 s). The lobby list shows who is reconnecting.
- If the backend restarts, all rooms are lost. The client explains this and lets you start a new room.
  A yellow banner warns whenever the race view might be stale.
- Session data is kept per tab in `sessionStorage` and preferences in `localStorage`, both namespaced by
  the base path so several embedded apps on one origin do not collide.

---

## Architecture

```
src/
  shared/      track spline, constants and protocol types used by both sides
  server/      Node backend: HTTP health endpoint, Socket.IO rooms, race logic
  client/      browser client: UI screens, networking, Three.js game
    game/      kart physics, track/scenery meshes, HUD, minimap, audio, items
```

- **Movement** is simulated on each player's own client (responsive driving) and reported to the server
  20 times a second. Other karts are interpolated with a ~120 ms buffer.
- **Everything competitive is server-authoritative:** the server projects each reported position onto
  the shared track spline (searching only near the racer's last known position, which keeps the bridge
  and the road beneath it apart), advances checkpoints strictly in order, counts laps, records finish
  times on its own clock, computes live placements, hands out items, simulates wasps and honey puddles,
  detects hits and decides respawn points. All clients therefore see the same results.
- **Race flow:** lobby → 4 s countdown (server timestamp, clients sync their clocks) → racing → results.
  The race ends when everyone has finished or 60 s after the first finisher. The host can start a rematch
  straight from the results or go back to the lobby.
- **Rendering** is true 3D (perspective chase camera, shadows, elevation, a bridge you drive under).

### Testing aid

Appending `?autopilot=1` to the client URL makes that client drive itself along the racing line (and use
items). It exists so multiplayer races can be exercised with several browser tabs; it is not a gameplay
feature and is not advertised in the UI. In development builds `window.__bumble` exposes the game object.

---

## Assets & attribution

All visuals are generated procedurally with Three.js primitives and canvas textures, and all sound is
synthesised with the Web Audio API. There are no third-party art or audio assets and nothing to attribute
beyond the npm dependencies listed in `package.json` (MIT licensed: three, socket.io, socket.io-client,
vite, typescript, tsx, concurrently, and their type packages).

## Browser support

Current desktop Chrome/Edge, Firefox and Safari with WebGL 2 and keyboard input. The page also works
inside an iframe; click the game to give it focus.
