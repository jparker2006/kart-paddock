# Live playtest

[Open Kart Paddock](https://kart-paddock.vercel.app).

- Parcel Panic (Astra): /play/a/; direct game /games/a/.
- Bumble Rally (Fable): /play/b/; direct game /games/b/.
- Multiplayer servers: https://kart-paddock-a.onrender.com and https://kart-paddock-b.onrender.com.

Both servers use Render Free, one Node 24.20.0 process each, automatic deploys off, and ALLOWED_ORIGINS=https://kart-paddock.vercel.app. Render supplies PORT=10000; HOST=0.0.0.0. GitHub app access was explicitly approved for kart-paddock only, in addition to the existing probe. No paid plans were selected.

On September 7, 2026, three browser clients joined a public room and started a race in each game. Reloading one client restored its existing race seat in both. Fable briefly showed a stale-update warning during startup; it cleared. Both health endpoints responded successfully. Static HTML/CSS artifact hashes match the local prebuilt output.

These are deployment smoke checks on one Mac. Full human-driven races, three physical computers, sustained latency, and production browser coverage remain untested. The gameplay files were not modified; 62 copied source/config/test files match the frozen submissions. Builder identities are hidden on the launcher until revealed; this is not a security boundary or the final randomized five-game assignment.

Render Free may sleep after 15 minutes without traffic and take about a minute to wake. Rooms are in memory and can disappear on a service restart.
