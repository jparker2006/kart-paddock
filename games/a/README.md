# Parcel Panic

An original browser-based 3D kart racer for **2–8 human drivers**. Tiny delivery karts race three laps around **Postcard Circuit**, a seaside parcel depot with a climbing flyover, a lower crossing, and an air-mail jump with a physical gap. Create a room, share its five-character code or URL, race, compare results, and rematch.

## Requirements and setup

Use **Node 24.20.0** and **npm 11.19.0** (both verified in the build environment).

```sh
npm ci
cp .env.example .env  # optional: defaults already work
npm run dev
```

Open `http://localhost:5173/` on the host computer. The frontend and persistent backend run together, on ports 5173 and 3001. Port conflicts cause errors instead of selecting new ports. The project-local npm cache avoids modifying a global cache.

For friends on the same LAN, set `VITE_GAME_SERVER_URL` to the host computer's reachable backend URL, e.g. `http://YOUR_LAN_IP:3001`, and include `http://YOUR_LAN_IP:5173` in `ALLOWED_ORIGINS`. Restart the development command. Friends open the host's frontend URL. Allow those ports through the host firewall as needed; this project does not configure firewalls or routers. Localhost refers to each player's own computer, so it is only the single-computer default.

## Commands

| Command | Behavior |
| --- | --- |
| `npm ci` | Install exact versions from `package-lock.json` |
| `npm run dev` | Run Vite and the TypeScript Node backend together; stop both if either exits |
| `npm run build` | Type-check all source, compile backend into `dist/server/`, and build browser assets into `dist/client/` |
| `npm start` | Run `dist/server/server/index.js`, reading optional `.env` |
| `npm run preview` | Serve the built frontend, independently of the backend |
| `npm test` | Run deterministic physical-geometry, driving, and checkpoint checks |
| `npm run test:browser` | Run the three-engine race suite against a running client/backend (`TEST_URL` overrides the dev URL) |
| `npm run test:effects` | Exercise drift, items, late joining and rematch in real Chromium clients |
| `npm run test:network` | Run isolated protocol/room/security checks on a test backend |
| `npm run test:deployment` | Verify the prebuilt nested client, eight browsers, iframe and restart; see `TESTING.md` |

To verify a built client locally, run `npm run build`, then run `npm start` and `npm run preview` in separate terminals. Open `http://localhost:4173/`.

## Controls and rules

- **W / Up:** accelerate.
- **S / Down:** brake, then reverse.
- **A / D or Left / Right:** steer.
- **Shift + steering:** drift. Charge until the meter turns gold; release Shift for a boost. Longer drifts earn longer boosts.
- **Space:** use a collected parcel. **Turbo** boosts for three seconds. **Air horn** slows rivals within 18 metres, only on the same track level.
- **R:** rescue your kart to the last earned checkpoint. Falling triggers automatic rescue.
- Click the track to restore keyboard focus after switching windows or interacting with an embedding page.

Collect the floating yellow parcel boxes. A box reappears five seconds after collection. Steering, braking and drift work during a race; no accounts, bots, or provider credentials are required. Sound starts muted; the in-race sound button enables locally synthesized engine and notification audio after a user gesture.

Every lap requires 16 ordered forward checkpoint crossings. A race is three laps. Position is computed from earned checkpoints and local progress, never proximity to the finish alone. Gate checks include lateral and vertical bounds, so the two crossing levels cannot award each other's checkpoints. Rescue does not award gates or laps.

The host starts with at least two connected people. A mid-race arrival waits for the next round. A disconnected driver's slot is reserved for 90 seconds. Reloading or briefly losing the connection reuses the tab's opaque session token. An inactive input stream becomes neutral after 650ms. If the host disconnects, another connected person becomes host. After the first finish, remaining racers have 75 seconds; a race also has a 10-minute safety limit. Unfinished entrants receive DNF, and every client receives the same server-ordered results. The host can immediately start a rematch.

## Configuration and deployment boundary

| Variable | Stage | Default / meaning |
| --- | --- | --- |
| `BASE_PATH` | Client dev/build/preview | `/`; begins and ends with `/`, e.g. `/games/a/` |
| `VITE_GAME_SERVER_URL` | Public client dev/build | `http://localhost:3001`; use the persistent backend's HTTPS URL for production |
| `CLIENT_PORT` | Local frontend dev | `5173`, strict |
| `PREVIEW_PORT` | Local frontend preview | `4173`, strict |
| `PORT` | Backend runtime | `3001`; provider-supplied port is honored |
| `HOST` | Backend runtime | `0.0.0.0` |
| `ALLOWED_ORIGINS` | Backend runtime | `http://localhost:5173,http://localhost:4173`; comma-separated exact browser origins, without path or trailing slash |

Vite reads `.env` and shell variables; shell values take precedence. Public client configuration is baked into the static build and requires rebuilding when changed. Backend runtime values are read at startup. Never put secrets in `VITE_` variables.

Example packaging for a later organizer:

```sh
BASE_PATH=/games/a/ VITE_GAME_SERVER_URL=https://YOUR_BACKEND_HOST npm run build
```

Place the **contents** of `dist/client/` beneath `/games/a/` in the static website. A share link is the existing game URL plus `?room=ABCDE`; it preserves the base path and uses no client-side history route or root-relative gameplay assets. All visuals are generated in the client; no model, texture, audio, font, worker, WASM, CDN, or service-worker requests need special routing. Do not rewrite the separate backend as a serverless function.

Run **one persistent Node process**, using `npm start`, with `PORT` from the hosting provider and `ALLOWED_ORIGINS=https://YOUR_WEBSITE_ORIGIN`. A proxy must support Socket.IO's `/socket.io/` HTTP/WebSocket traffic. An HTTPS backend URL yields secure WebSocket traffic automatically. A health probe can call **GET `/health`**, which returns HTTP 200 and JSON when listening. This backend does not serve the frontend. No database, managed realtime service, sticky multi-instance setup, or credentials are used. Multiple backend instances would have separate rooms and are not supported.

The static page can stand alone or be framed, for example:

```html
<iframe src="/games/a/" title="Parcel Panic" allow="autoplay; fullscreen"
  style="width:100%;height:800px;border:0"></iframe>
```

Keep a usable desktop-sized viewport. Pointer interaction focuses the game for keyboard input, and audio resumes only after interaction. Browser session storage is namespaced by game, version, base path, and backend URL. Separate tabs are separate players unless a browser duplicates their session storage; a duplicated driver token replaces the old connection and explains this to the old tab. Browser storage restrictions fall back to in-memory play, but a page reload then cannot recover its token.

Rooms are in memory. A full server restart loses them. The client shows connection loss and, on reconnection, explains that the room no longer exists and lets the player create or join a new room. Empty rooms expire after three minutes. Stale updates pause outgoing controls and show a warning.

## Architecture

- `src/shared/track.ts`: original sampled 3D figure-eight route, surfaces, ramp/gap and parcel positions.
- `src/server/physics.ts`: fixed-step arcade kart motion, gravity, road contacts, drift, rescue, checkpoints and placement.
- `src/server/index.ts`: rooms, opaque reconnect tokens, start/rematch, authoritative simulation at 60Hz, snapshots near 20Hz, item effects, CORS/WebSocket origin checks, timeouts and results.
- `src/client/world.ts`: Three.js scene, procedural island/depot/kart geometry, generated sign textures, batched scenery, chase camera and effects.
- `src/client/main.ts`: accessible lobby/race/results UI, input at 30Hz, interpolation, connection state, base-safe invites, local audio and read-only diagnostics.

The client submits only bounded control inputs. It cannot submit positions, checkpoints, lap counts or results. Inputs and lobby fields are validated, messages are bounded, and inputs are rate limited. Names are escaped in HTML and rendered as text on texture canvases. Origin restrictions are enforced for both polling and WebSocket handshakes; non-browser clients without an Origin header are allowed. This is a small friends' game, not a public competitive anti-abuse service.

## Dependencies and asset attribution

Runtime libraries are pinned exactly: Three.js **0.185.1** and Socket.IO server/client **4.8.3** (MIT). TypeScript **7.0.2** and Vite **8.2.2** are pinned. Additional exact development dependency versions appear in `package.json` and the lockfile. The optional Rapier library is not used; the road-contact and arcade physics implementation is original.

Every kart, track segment, building, island, palm, parcel, boat, balloon, cloud, sign texture, UI graphic and sound was authored procedurally for this project. No downloaded game art, audio, copied racing template, external font, or AI image/audio service was used. No third-party asset attribution is required beyond retaining dependency licenses when redistributing bundled software. Library license files are installed with their packages. `ASSETS.md` records the source inventory.

## Verification

See `TESTING.md` for the final actual test matrix and limitations, plus `artifacts/` for machine-readable reports and screenshots. Browser automation drives real rendered browser clients using keyboard events; separate protocol tests are labeled as such. Local tests do not establish production hosting or WAN reliability.

To install test browsers within this project:

```sh
PLAYWRIGHT_BROWSERS_PATH=artifacts/browsers npx playwright install chromium firefox webkit
PLAYWRIGHT_BROWSERS_PATH=artifacts/browsers npm run test:browser
```

The game targets current desktop browsers with WebGL2 and keyboard input. Mobile touch/gamepad controls and accessibility alternatives to real-time visual driving are not implemented. Connections with significant latency may show interpolation delay; there is no rollback or client-side authority. Track-edge curbs slow the kart but do not prevent driving off; R is always available. Rooms and results do not survive backend restarts.
