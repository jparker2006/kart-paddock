# Community ratings for Kart Paddock

## Problem Statement
Podcast viewers need to rate the five original AI-built kart games and see useful shared community results. The current site supports playing and model reveals but does not collect votes. Expected initial audience is 20–200 visitors. Ratings must persist beyond a browser or deployment without introducing accounts or altering any game submission.

## Solution
Add an accessible 1–5-star overall rating to each game’s launcher card and its surrounding player page. Remember an anonymous browser voter and allow edits. Present shared averages, vote counts, rating distributions, and an animated community leaderboard. Keep voting open indefinitely. Games with fewer than five ratings are marked Early results and are not competitively ordered. Keep the existing play-card order and blind reveal behavior unchanged.

## User Stories
1. As a viewer, I want to rate any game independently so that I need not play all five.
2. As a viewer, I want a clear overall question so that I understand what I am rating.
3. As a viewer, I want 1 Poor, 3 Okay, and 5 Excellent anchors so that the scale is understandable.
4. As a viewer, I want to give a broken game a low rating so that reliability affects my judgment.
5. As a viewer, I want to vote without an account so that participation is quick.
6. As a returning viewer, I want my browser to remember my votes so that I can see what I submitted.
7. As a viewer, I want to revise a rating so that my opinion can change after more play.
8. As a viewer, I want an edited rating to replace my old vote so that I am not counted twice.
9. As a viewer, I want a clear Save rating action so that inspecting stars does not accidentally submit.
10. As a viewer, I want confirmation after saving so that I know my vote counted.
11. As a viewer, I want an error and retry path when saving fails so that failed votes are not presented as recorded.
12. As a viewer, I want aggregate results shared across browsers so that these are community statistics.
13. As a viewer, I want the mean rating and vote count per game so that I can assess both score and participation.
14. As a viewer, I want the five-bin distribution so that I can see agreement or polarization.
15. As a viewer, I want low-sample games marked Early results so that one vote does not imply a winner.
16. As a viewer, I want only games with five or more ratings in ranked positions so that the leaderboard has a minimum sample.
17. As a viewer, I want tied averages shown as ties so that insignificant ordering is not implied.
18. As a viewer, I want the game-selection order preserved so that voting does not hide a game.
19. As a viewer, I want results available before or after model reveal so that participation is casual.
20. As a viewer, I want animated statistics so that community feedback feels engaging.
21. As a viewer sensitive to motion, I want reduced-motion support so that animation is optional.
22. As a keyboard or screen-reader user, I want labeled rating controls and save feedback so that I can participate.
23. As a phone user, I want rating and results controls that fit my screen so that I can vote comfortably.
24. As a viewer, I want votes to remain after site deployments so that the poll can stay open.
25. As an organizer, I want no fabricated votes so that the audience statistics remain honest.
26. As an organizer, I want original submissions preserved so that the experiment remains authentic.
27. As an organizer, I want durable free-plan storage so that this small feature avoids a paid subscription.
28. As an organizer, I want secrets kept on the server so that viewers cannot directly access the database.
29. As an organizer, I want input validation and basic throttling so that accidental duplicates and casual abuse are limited.
30. As an organizer, I want test votes isolated and removable so that deployment validation does not pollute results.

## Implementation Decisions
- Preserve the static Vercel site and compiled games. Add small same-origin Node Vercel Functions via the existing Build Output deployment process. Game source is read-only throughout.
- Use Neon Free Postgres through Vercel Marketplace or the official Neon signup, selecting only the explicit free plan. No paid upgrade. Keep credentials in server-only environment variables and local ignored environment configuration. Ask for user action only for an unavoidable login, verification, binding agreement, or paid-plan blocker.
- Store one rating row per anonymous browser voter and game. Each row contains a hashed opaque browser token, a stable game key, integer stars constrained to 1–5, and creation/update timestamps. Never collect names, email, or fingerprinting data. Browser storage clearing or switching browsers can permit another vote; this is a casual poll, not identity verification.
- A browser generates a cryptographically random token and stores it locally. Send it only to same-origin ratings endpoints; store a server-side hash. Do not return individual voter records publicly.
- Use an atomic upsert and unique voter/game key to prevent duplicate writes or concurrent retry inflation. Aggregate directly from durable rating rows; no cached count increments.
- API: read aggregate statistics for all five fixed game keys; read this browser’s saved ratings using its opaque token; submit or replace a single game’s rating. Strictly validate game keys, integer star values, token format, body size, and method. Reject cross-origin writes and apply modest durable per-token throttling. Do not claim this prevents a determined anonymous attacker.
- Display average rounded to one decimal, exact count, and counts for each star value. Sort eligible games by exact mean descending, using stable game order only within exact ties; use competition ranks for ties. Empty games show No ratings yet. Games below five votes show Early results separately in original order.
- Retain existing model reveal and cost information and keep completion time in expandable notes. Do not expose model identity in unrevealed leaderboard labels.
- Add rating forms to the launcher and player wrapper pages, outside game iframes. Explicit save/update button, selected-star state, pending state, success text, and retry-safe errors. Read public results on load and after a successful vote; provide manual refresh rather than continuous polling.
- Use lightweight CSS/Web Animations for bars and numbers; GSAP is optional rather than a requirement. Animation must reflect real server values and respect reduced motion. No charts invented from zero-data states.
- Provide a visible short explanation of anonymous browser-based voting and the five-vote threshold. No login, account management, or blind-vote gating.
- Keep preview/test data isolated from the public poll through server-controlled environment configuration. Test fixtures must not be counted in production aggregates.

## Testing Decisions
- Prefer the highest behavior seam: the deployed website interacting with its real API and a separate test dataset. The user explicitly approved this seam, including separate browser sessions and failure/retry checks.
- Test API/database integration externally: valid save, replacement without count growth, simultaneous duplicate saves, invalid values/game/token, throttling, separate voters, distribution totals, empty results, and aggregate persistence.
- Test UI behavior in two independent browser voter contexts: save and edit, reload persistence, another voter seeing shared aggregates, early-results transition at five votes, exact ties, failure display/retry, and reveal independence.
- Validate narrow and desktop layout, keyboard operation, live feedback, and reduced-motion behavior. Confirm plain numeric labels remain usable without animations.
- Test real deployed Vercel-to-Neon connectivity. Verify public production endpoints and UI load, and verify no test records appear in public statistics.
- Hash-check frozen game files before and after implementation. Original gameplay must have zero source changes.
- Completion requires all meaningful API integration checks passing, successful production deployment, browser evidence for the core voting journeys, and concise setup/verification documentation. Clearly report any unverified scenario.

## Out of Scope
Accounts, strict one-person voting guarantees, podcast-judge ballots, mandatory play verification, gameplay fixes, separate failure ballots, multi-criterion ratings, comments, pairwise ranking, voting deadlines, paid infrastructure, realtime subscription streams, analytics tracking, and redesigning the game interfaces.

## Further Notes
Human approval delays and harness differences make build duration unsuitable as a headline competitive metric; its existing historical notes remain. Infrastructure code and voting UI may evolve, but the five game submissions remain frozen. Zero-vote production is a valid initial state. Never seed public results to make charts look impressive.
