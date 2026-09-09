# HyperKart: Nebula Drift

**HyperKart: Nebula Drift** is a complete, original, browser-based online 3D kart-racing game built from scratch using **Three.js** and **Socket.IO**. Designed for the approachable arcade fun of classic kart racers like *Mario Kart*, it features a high-energy synthwave neon aesthetic, responsive arcade kart physics, hop-and-drift mechanics with multi-tier mini-turbo boosts, four interactive combat items, and real-time multiplayer lobbies for 2 to 8 players.

---

## Highlights & Features

- **Multiplayer Lobbies (2–8 Players)**:
  - Create or join rooms via 5-character alphanumeric codes.
  - Shareable direct invite links (e.g. `http://localhost:5173/#room=ABCDE`) that automatically pre-fill the room code for arriving players.
  - Isolated race rooms with authoritative server state machines (`lobby` &rarr; `countdown` &rarr; `racing` &rarr; `finished`).
  - Host start controls enabled once &ge; 2 pilots join; maximum 8 players per room with automatic rejection for late joiners.
  - Interactive rematch voting system to seamlessly start subsequent races without re-creating lobbies.
  - Reconnection grace period using `sessionStorage` tokens to survive brief network dropouts.

- **Original Genuinely 3D Track ("Nebula Drift Highway")**:
  - Smooth 30-control-point 3D Catmull-Rom spline loop with banking and elevation profiles.
  - **Elevated Bridge Overpass**: A highway bridge at $y = 14\text{ m}$ spanning directly over another drivable track section at $y = 0\text{ m}$.
  - **High-Speed Jump Ramp**: A ramp rising to $y = 6.8\text{ m}$ that launches karts over a $35\text{ m}$ deep-space chasm with full ballistic gravity physics.
  - **Underpass Roadway**: Multi-level surface height detection permitting karts on the lower road and karts on the bridge to navigate the same $(X, Z)$ track footprint without clipping or elevation conflicts.
  - **Neon Boost Acceleration Pads**: Glowing chevron-striped track segments granting immediate velocity surges.
  - **Holographic Item Mystery Boxes**: Floating, rotating cubes with 10-second respawn timers.

- **Arcade Kart Physics & Mechanics**:
  - Tight steering, drift hop initiation, and progressive mini-turbo charge levels:
    - **Blue Sparks (Tier 1)**: Hold drift for 0.8s &rarr; +25% boost for 0.8s.
    - **Orange Flames (Tier 2)**: Hold drift for 1.8s &rarr; +45% boost for 1.4s.
    - **Purple Hypercharge (Tier 3)**: Hold drift for 3.0s &rarr; +70% boost for 2.2s.
  - Automatic off-track detection with respawn, as well as manual instant respawn (`R`).
  - Strict 30-checkpoint sequential lap progression (with anti-reverse detection) across 3 authoritative laps.

- **4 Original Power-Up Items**:
  1. **Homing Plasma Rocket**: Locks on to the racer ahead, tracking curves before detonating and causing a 1.8s spinout.
  2. **Pulse Mine**: Drops an explosive obstacle behind your kart to deter trailing pursuers.
  3. **Nitro Core**: Delivers an instantaneous 2.5-second supercharged thrust surge to $120\text{ km/h}$.
  4. **Cosmic Phase Shield**: Surrounds your kart with an orbital forcefield for 6 seconds, granting complete invulnerability against incoming rockets and mines.

- **100% Original & Procedural Presentation**:
  - Zero external 3D models, textures, or audio clips.
  - Low-poly neon racer chassis with spinning wheels, steering front tires, and exhaust thrusters.
  - Procedural road ribbon geometry with canvas-generated asphalt markings and alternating rumble curbs.
  - Dynamic chase camera with speed-dependent FOV zoom and 3 switchable perspectives (Chase Close, Chase Far, Hood/Bumper).
  - Procedural Web Audio API sound synthesizer: dynamic engine RPM frequency modulation, drift tire screeches, boost whooshes, missile launches/explosions, countdown chimes, victory fanfare, and an 8-bar synthwave background soundtrack.

---

## Pilot Controls

| Action | Primary Key | Secondary Key | Description |
| :--- | :--- | :--- | :--- |
| **Accelerate** | `W` | `Up Arrow` | Drive forward (up to $90\text{ km/h}$ base speed) |
| **Brake / Reverse** | `S` | `Down Arrow` | Decelerate, brake, or reverse |
| **Steer Left** | `A` | `Left Arrow` | Turn kart left |
| **Steer Right** | `D` | `Right Arrow` | Turn kart right |
| **Drift / Hop** | `Space` | `Left Shift` | Hop into turn and hold to charge Mini-Turbo |
| **Use Item** | `E` | `Enter` | Fire rocket, lay mine, use nitro, or activate shield |
| **Manual Respawn** | `R` | — | Reset kart upright onto the center of the track |
| **Change Camera** | `C` | — | Cycle between Close Chase, Far Chase, and Bumper View |
| **Mute Audio** | `M` | — | Toggle procedural sound effects and music |

---

## Quick Start & Running Commands

The project requires **Node.js &ge; 24.0.0** and **npm &ge; 11.0.0**.

### 1. Installation
Install all dependencies using a clean install:
```bash
npm ci
```

### 2. Development Mode
Run both the backend game server and the Vite development client concurrently:
```bash
npm run dev
```
- **Browser Client**: [http://localhost:5173](http://localhost:5173)
- **Backend Server**: [http://localhost:3001](http://localhost:3001)
- **Health Check**: [http://localhost:3001/health](http://localhost:3001/health)

*(You can also run them individually via `npm run dev:client` and `npm run dev:server`.)*

### 3. Production Build
Compile both the frontend (Vite & TypeScript) and backend (TypeScript) into `dist/`:
```bash
npm run build
```
- Client bundle output: `dist/client/`
- Server compiled output: `dist/server/` and `dist/shared/`

### 4. Production Server
Start the standalone Node.js production server:
```bash
npm start
```
The production server listens on port `3001`, exposes the Socket.IO server, provides `/health`, and serves the compiled static client from `dist/client`.

### 5. Client Preview
Preview the production client build locally using Vite's preview server:
```bash
npm run preview
```
- **Preview Client**: [http://localhost:4173](http://localhost:4173)

### 6. Automated Verification Suite
Run the comprehensive multi-client Puppeteer verification suite:
```bash
npm test
```

---

## Configuration & Environment Variables

Copy `.env.example` to `.env` to customize settings:
```bash
cp .env.example .env
```

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `BASE_PATH` | `/` | Base URL path prefix for client assets and routing (e.g. `/` or `/games/kart/`). |
| `VITE_GAME_SERVER_URL` | `http://localhost:3001` | Public backend URL used by the browser client to connect via Socket.IO. |
| `CLIENT_PORT` | `5173` | Local HTTP port for the Vite development server. |
| `PREVIEW_PORT` | `4173` | Local HTTP port for the Vite production preview server. |
| `PORT` | `3001` | HTTP and WebSocket port for the Node.js/Express backend server. |
| `HOST` | `0.0.0.0` | Host interface for backend server binding. |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:4173` | Comma-separated list of allowed origins for Express CORS and Socket.IO. |

### Subpath Deployment Example
To build and serve the application under a custom prefix like `/games/kart/`:
```bash
BASE_PATH=/games/kart/ npm run build
BASE_PATH=/games/kart/ npm start
```
The game client and health checks will be served under `http://localhost:3001/games/kart/` and `http://localhost:3001/games/kart/health`.

---

## Architecture & Codebase Structure

```
gemini-kart/
├── index.html                   # Game UI markup, HUD, overlays, and minimap canvas
├── package.json                 # Pinned dependencies, engines, and run scripts
├── vite.config.ts               # Vite configuration with dynamic base and strict ports
├── tsconfig.json                # Shared TypeScript base configuration
├── tsconfig.client.json         # DOM/ES2022 client TypeScript configuration
├── tsconfig.server.json         # NodeNext server TypeScript configuration
├── scripts/
│   ├── run-build.js             # Cross-platform build orchestrator
│   ├── run-client.js            # Dev client launcher
│   ├── run-dev.js               # Concurrent dev launcher with signal forwarding
│   ├── run-preview.js           # Preview launcher
│   └── run-server.js            # Dev server launcher
├── src/
│   ├── shared/
│   │   ├── constants.ts         # Physics parameters, kart color palettes, tuning values
│   │   ├── trackData.ts         # 30-point 3D Catmull-Rom spline, overpass/jump geometry
│   │   └── types.ts             # Shared data models, network protocol events, transforms
│   ├── server/
│   │   ├── index.ts             # Express & Socket.IO server entry, /health, static serving
│   │   ├── RaceRoom.ts          # Room state machine, authoritative lap tracking, projectiles
│   │   └── RoomManager.ts       # Room lifecycle management and room code generation
│   └── client/
│       ├── audio/
│       │   └── SoundSystem.ts   # 100% procedural Web Audio API SFX and synthwave music
│       ├── game/
│       │   ├── CheckpointTracker.ts # Checkpoint validation, 3-lap tracking, progress
│       │   ├── ItemManager.ts   # Item box collision, roulette cycling, item triggers
│       │   └── KartController.ts# Arcade kart physics, drift mini-turbo, jump trajectory
│       ├── gfx/
│       │   ├── ItemRenderer.ts  # 3D mystery boxes, rockets, mines, explosion VFX
│       │   ├── KartModel.ts     # Procedural 3D racer models, wheels, drift sparks
│       │   ├── SceneManager.ts  # Three.js scene, dynamic chase camera, starfield
│       │   └── TrackRenderer.ts # 3D road ribbon, curbs, overpass bridge, jump ramp
│       ├── net/
│       │   └── NetworkClient.ts # Socket.IO client, 25Hz sync, Hermite/slerp interpolation
│       ├── ui/
│       │   ├── Minimap.ts       # 2D canvas minimap with multi-level overpass indicator
│       │   └── UIManager.ts     # Menu, lobby roster, speedometer, drift gauge, results
│       ├── main.ts              # Game loop orchestrating physics, rendering, and networking
│       └── style.css            # Synthwave HUD styling, responsive glassmorphic cards
└── test/
    ├── full-verification.js     # Master Puppeteer test covering all 10 racing scenarios
    └── run-all-tests.js         # Automated end-to-end test runner
```

---

## Verification & Automated Testing

The project includes an end-to-end verification suite (`test/full-verification.js`) executed with real headless Google Chrome instances. The suite authoritatively validates all core requirements:

1. **Multiplayer Lobby Orchestration**: 3 independent browser contexts (Alice, Bob, Charlie) join a room using room codes and direct shareable URLs with custom colors.
2. **Synchronized Race Countdown**: Server-orchestrated 3-second countdown initiates synchronized race transitions across all clients.
3. **Real-Time 3D Driving & Network Sync**: Alice drives forward, triggering speedometer updates; Bob and Charlie receive synchronized transforms in real time.
4. **3D Surface & Overpass Geometry**: Verifies surface queries on the elevated overpass ($y = 14.0\text{ m}$), the underpass directly below ($y = 0.0\text{ m}$), the jump lip ($y = 6.8\text{ m}$), and the $35\text{ m}$ chasm gap.
5. **Hop-and-Drift Mechanics**: Verifies power-sliding, spark charge thresholds, and mini-turbo boost acceleration release.
6. **Respawn Recovery**: Bob triggers manual respawn (`R`), resetting kart orientation and placing the vehicle back on the road.
7. **Authoritative 3-Lap Progression**: Checkpoint sequencing completes 3 laps, triggers the finish sequence, displays the winner podium leaderboard, and handles rematch voting.
8. **Room Isolation**: Separate pilot Dan creates a second room; rosters and state machines remain strictly isolated between Room A and Room B.
9. **Network Fault Tolerance**: Bob simulates brief offline network disconnection; the reconnection banner displays and automatically recovers session state when back online.
10. **Lobby Capacity Enforcement**: Room scales up to 8 racers; a 9th racer attempting to join is rejected with an informative error modal.

---

## Asset Attribution & Originality Notice

All assets in this project are **100% original and procedurally generated**:
- **3D Geometry**: Procedurally constructed using Three.js buffer geometries (box, cylinder, extrude, and tube primitives).
- **Textures**: Dynamically drawn on HTML5 canvas elements (asphalt striping, checkered finish banners, chevron boost arrows, and neon rumble strips).
- **Audio & Music**: Synthesized entirely in real-time via the browser's Web Audio API using dynamic oscillators, gain envelopes, biquad filters, and noise buffers.
- No third-party proprietary 3D models, textures, sound files, or pre-packaged kart game kits are used.
