# Live playtest

[Open Kart Paddock](https://kart-paddock.vercel.app).

- Parcel Panic (Astra): /play/a/; direct game /games/a/.
- Bumble Rally (Fable): /play/b/; direct game /games/b/.
- Multiplayer servers: https://kart-paddock-a.onrender.com and https://kart-paddock-b.onrender.com.

Both servers use Render Free, one Node 24.20.0 process each, automatic deploys off, and ALLOWED_ORIGINS=https://kart-paddock.vercel.app. Render supplies PORT=10000; HOST=0.0.0.0. GitHub app access was explicitly approved for kart-paddock only, in addition to the existing probe. No paid plans were selected.

On September 7, 2026, three browser clients joined a public room and started a race in each game. Reloading one client restored its existing race seat in both. Fable briefly showed a stale-update warning during startup; it cleared. Both health endpoints responded successfully. Static HTML/CSS artifact hashes match the local prebuilt output.

These are deployment smoke checks on one Mac. Full human-driven races, three physical computers, sustained latency, and production browser coverage remain untested. The gameplay files were not modified; 62 copied source/config/test files match the frozen submissions. Builder identities are hidden on the launcher until revealed; this is not a security boundary or the final randomized five-game assignment.

Render Free may sleep after 15 minutes without traffic and take about a minute to wake. Rooms are in memory and can disappear on a service restart.

## Gemini / HyperKart: Nebula Drift — September 9, 2026

Game E is the unchanged 39-file frozen Gemini submission. Static assets are compiled with `BASE_PATH=/games/e/` and `VITE_GAME_SERVER_URL=https://kart-paddock-e.onrender.com`; its server runs on Render Free (`srv-dagh1n3l550s73bkp730`), Node 24.20.0, root `games/e`, `npm ci && npm run build`, `npm start`, `/health`, automatic deploys off. No gameplay fixes were applied.

The production launcher includes all five games. Completion times remain in expandable run notes only. Gemini's audit found 43,933,660 total tokens and a $5.375909325 standard API-equivalent token estimate; actual billed cost was not recorded. Muse's recorded cost is $0, with alternative standard ($2.14685385) and Contributor ($0.065432328) estimates shown separately. Rates were checked against official provider documentation on September 9, 2026.

Verified: clean Gemini install/build, public health, nested and framed frontend, three browser tabs sharing a room and starting a race, reload rejoin, and published asset byte matches. Full-race playability and three physical devices remain unverified. Original game defects are retained.
