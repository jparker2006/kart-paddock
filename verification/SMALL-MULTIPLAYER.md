# Small production multiplayer check

September 9, 2026. The published Render backends were exercised sequentially, with at most six automated Socket.IO WebSocket clients connected at once: two three-player rooms per game. Both rooms started a race, then clients sent normal-shaped input or synthetic position reports at 15–20 Hz for roughly 30 seconds. One non-host client disconnected for 1.5 seconds and resumed its original seat.

| Game | Two rooms / six clients | Room isolation | Same-seat reconnect | Unexpected disconnects | State-update gap p95 / max |
| --- | --- | --- | --- | --- | --- |
| Astra / Parcel Panic | Pass | Pass | Pass | 0 | 96 / 1,139 ms |
| Fable / Bumble Rally | Pass | Pass | Pass | 0 | 101 / 862 ms |
| GLM / Harvest Rush | Pass | Pass | Pass | 0 | 113 / 340 ms |
| Muse / Cinder Peak Rally | Pass | Pass | Pass | 0 | 109 / 1,895 ms |
| Gemini / HyperKart | Pass | Pass | Pass | 0 | 79 / 860 ms |

Every client received updates containing only players belonging to its room, including three-player packets. Gap measurements are interarrival times on the test Mac, excluding the deliberate disconnected interval. They include network and client scheduling effects and are not server CPU measurements or direct latency measurements. Different game broadcast frequencies mean the numbers are not a model ranking. Occasional gaps were substantially larger than the typical intervals.

Gemini caveat: its room roster did not immediately mark a disconnected player offline. The first test stopped at that assertion. Source inspection established that its disconnect path does not broadcast a fresh roster immediately, while live race synchronization excludes disconnected players. A targeted repeat verified the missing player in live sync, restored identity on reconnect, and resumed updates. The stale roster flag is retained as an observed submission limitation, not repaired. Both the initial results and the final results are preserved.

This is a modest networking smoke test, not a capacity ceiling or a full browser playthrough. Client-authoritative games received synthetic, gently varying positions; Astra received throttle/steering input. No full laps, item-heavy races, rematches, graphics performance, mobile play, three physical computers, or hundreds of users were verified. No gameplay or ratings data was altered. All test clients disconnected; explicit room leave was used where supported, with original expiry/grace cleanup otherwise. All 340 frozen source/build files still match the previous baseline.

Reproduce deliberately with `node scripts/small-multiplayer-test.mjs --live` from the repository root. It uses the installed Socket.IO client from Game A without changing that game. `--games=e` repeats only Gemini while retaining the other final results. Do not schedule this as a keep-alive.

- [Final machine-readable results](small-multiplayer.json)
- [Initial run, including Gemini roster timeout](small-multiplayer-initial.json)
