# Verification record

Local verification performed on 7 September 2026. All browsers ran on this computer, against local persistent Node processes. These are automated browser tests, not a three-person usability study or a production hosting test.

## Toolchain and command checks

- Node `v24.20.0`, npm `11.19.0` verified in the execution environment.
- Installed exact TypeScript `7.0.2`, Vite `8.2.2`, Three.js `0.185.1`, and Socket.IO server/client `4.8.3`.
- `npm ci` succeeded from the project lockfile. npm reported zero known vulnerabilities at verification time.
- `npm run build` passed type-checking and produced both `dist/client/` and `dist/server/`.
- `npm run dev` ran the frontend and backend together.
- `npm start` and `npm run preview` ran the built backend and static frontend independently.
- Additional backend, preview, and combined dev invocations exited with explicit port-conflict errors instead of selecting alternate ports. Evidence: `artifacts/commands-report.json`.
- Root and nested-path production builds succeeded. The final output in `dist/` uses the default root path and default local backend URL.
- Vite reports a bundle-size advisory for the roughly 628 KB uncompressed / 165 KB gzip client bundle, which includes Three.js. This is a warning, not a failed build.

## Actual browser clients

| Engine | Version | Mode | Verified |
| --- | --- | --- | --- |
| Chromium / Chrome for Testing | 153.0.8010.12 | Windowed | Lobby, three valid laps, jump/landing, lower and upper crossing, matching results, rematch |
| Firefox | 155.0 | Headless, real browser engine | Same complete race; reload restored the same driver in the ongoing rematch |
| WebKit | 26.6 | Headless, real browser engine | Same complete race; keyboard rescue preserved earned checkpoints |

The three engines ran concurrently with independent browser sessions, names and reconnect tokens. Each rendered the actual Three.js game and sent normal control inputs. Test drivers used keyboard events through the browser client's regular input handler. They read public diagnostics for steering; they did not set positions, gates, laps, finish times or server state. Each completed **48 ordered gate crossings / three valid laps**, with three jump launches and landings and traversal of both crossing levels. Results were compared across all three clients and were identical. No uncaught client JavaScript errors were recorded.

The final three-engine run used the **built** frontend at `http://localhost:4173/` and the **built** backend at `http://localhost:3001/`. The same full race was also verified earlier with the development client.

Evidence: `artifacts/browser-report.json`, `artifacts/results-chromium.png`, `artifacts/results-firefox.png`, `artifacts/results-webkit.png`, `artifacts/jump.png`, and `artifacts/overpass.png`.

The in-app browser was also used to inspect the actual rendered home screen. An early headless Chromium automation run suffered input timing problems; the successful complete Chromium races used its normal windowed mode. Firefox and WebKit completed in headless mode. WebKit testing is **not** a claim of testing the Safari application. Microsoft Edge and the Safari application were not separately launched.

## Eight-player and integration checks

The separately built `/games/a/` client used a separately running backend on port 3101 and static preview on port 4174.

- Eight real Chromium browser contexts joined the same lobby and entered the same eight-player race.
- A ninth browser received the eight-driver room-full message.
- Keyboard acceleration moved one racer in the built game while the other participants remained synchronized.
- Another real browser created an isolated room, which stayed in the lobby while the eight-person room raced.
- A real browser offline/online cycle displayed a connection warning and restored the same racer to the ongoing race.
- The static client loaded its observed JS/CSS assets below `/games/a/assets/`. The room URL retained `/games/a/?room=…`.
- The game ran in a cross-origin iframe hosted on another local port. Its lobby, race start, focused keyboard acceleration and sound activation control worked.
- The backend was actually stopped and restarted. The browser explained that the old room no longer existed and successfully created a new room.

Evidence: `artifacts/deployment-report.json`, `artifacts/eight-browser-lobby.png`, `artifacts/eight-browser-race.png`, `artifacts/disconnected.png`, `artifacts/iframe-race.png`, and `artifacts/nested-home.png`.

## Drift, parcels and late arrivals

Two real windowed Chromium clients drove with the regular keyboard handler while a third browser joined late. The late browser displayed **Next dispatch** and stayed outside the active race. The driving clients charged a drift past the boost threshold, received a boost, collected both Turbo and Air horn parcels, used them, and observed a rival slowed by the horn. When the host rematched after results, the waiting browser became an active racer.

Evidence: `artifacts/effects-report.json`, `artifacts/items-and-drift.png`, and `artifacts/late-join.png`.

## Deterministic and protocol tests

`npm test` passed seven checks covering:

1. Two physical road surfaces at the crossing, separated by 14m.
2. Rejection of premature and backward finish crossings.
3. Rejection of a gate crossed at the wrong height and of out-of-order checkpoints.
4. Rescue preserving checkpoint count and lap count.
5. Ground contact staying on the correct overpass deck.
6. A full three-lap physical drive with jump landings and no rescues.
7. Consistent ranking by finish time and earned progress.

`npm run test:network` passed independent **protocol-client** checks for health, eight-driver capacity, ninth-driver rejection, host-only starts, two-person minimum, isolated rooms, token reconnect, mid-race waiting, malformed/position-forging input rejection, host transfer, and rejection of unpermitted HTTP polling and WebSocket origins. Both permitted WebSocket and long-polling transports worked. These protocol clients are additional coverage and are not counted as real browser clients.

Evidence: `artifacts/network-report.json`.

## Reproduction

Start `npm start` and `npm run preview` in separate terminals after building. Install browsers once with the command in README, then run:

```sh
npm test
npm run test:network
TEST_URL=http://localhost:4173/ PLAYWRIGHT_BROWSERS_PATH=artifacts/browsers npm run test:browser
TEST_URL=http://localhost:4173/ PLAYWRIGHT_BROWSERS_PATH=artifacts/browsers npm run test:effects
```

For the nested integration suite, reserve ports 3101, 4174 and 4180, then:

```sh
BASE_PATH=/games/a/ VITE_GAME_SERVER_URL=http://localhost:3101 npm run build
PLAYWRIGHT_BROWSERS_PATH=artifacts/browsers npm run test:deployment
npm run build  # restore the normal local root build afterward
```

The deployment suite starts and stops only its own local backend, preview and embedding fixture. A host environment that restricts browser subprocesses may require authorization to launch the installed test browsers.

## Limits of the evidence

- No deployment, publishing, paid services, WAN gameplay, public HTTPS/WSS endpoint, or external production host was tested.
- Eight browsers were tested through lobby/start/synchronization, not an eight-driver three-lap finish. The complete shared race used three real browser engines.
- Desktop keyboard input is implemented; mobile touch and gamepads are not.
- No manual three-human fun/balance assessment or exhaustive browser/device performance matrix was performed.
- Scenery is decorative. Physical gameplay uses the sampled road surfaces, gravity, kart contacts and soft curbs; it is an arcade simulation, not a general rigid-body world.
- Backend rooms and results are intentionally memory-only. A restart loses them, with the recovery UI verified.
- Significant network latency can add visible interpolation delay. No rollback/client-authoritative prediction, horizontal server scaling, competitive anti-cheat service, or persistent account system is provided.
