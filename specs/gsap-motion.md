# Kart Paddock motion brief and implementation spec

## Problem Statement
The launcher works but its interaction feedback is abrupt and inconsistent. Viewers arriving from the podcast should encounter a crafted, playful arcade with immediate controls, a satisfying model reveal, and smooth transitions on phones. Animation must not obstruct play, distort voting data, or change frozen submissions.

## Solution
Use GSAP for a coherent motion system: crisp race-broadcast timing with restrained arcade playfulness. Make Reveal models the signature moment. Add a brief arrival, sliding tab indicator, immediate view transitions, tactile buttons, animated rating sheets, subtle desktop image hover, and server-confirmed rating feedback. Follow with a measured performance pass.

## User Stories
1. As a new visitor, I want a short arrival sequence so that the page feels deliberately composed.
2. As a returning visitor in the same visit, I want the arrival skipped so that navigation remains fast.
3. As a viewer, I want all controls usable immediately so that animations never impose a wait.
4. As a viewer, I want model names revealed in a coordinated sequence so that the experiment has a memorable reveal.
5. As a viewer on Results, I want model names revealed beside each game so that I can connect scores with builders.
6. As a viewer, I want hide/reveal to work during animation so that rapid clicks remain predictable.
7. As a viewer switching tabs, I want the underline to glide and the new content to appear promptly so that navigation feels connected.
8. As a keyboard user, I want tabs and dialogs to retain native focus and keyboard behavior so that motion never blocks access.
9. As a phone visitor, I want a short rating-sheet entrance and exit so that the sheet feels responsive.
10. As a voter, I want selected stars to respond so that my choice is clear.
11. As a voter, I want one small star pulse and a checkmark only after a successful save so that confirmation is truthful.
12. As a voter, I want failed saves to retain their existing retry behavior so that animation does not disguise failure.
13. As a voter, I want edits to replace my rating so that satisfying feedback does not change voting rules.
14. As a results viewer, I want real score changes and vote distributions to animate so that changes are understandable.
15. As a results viewer, I want unchanged values to remain still so that refreshes do not imply new results.
16. As a desktop visitor, I want a slight image zoom on hover so that cards feel responsive.
17. As a touchscreen visitor, I want immediate tap feedback without hover dependency so that controls work naturally.
18. As a viewer sensitive to motion, I want reduced-motion preferences honored so that the site remains comfortable.
19. As a visitor on a slower phone, I want small animation assets and limited frame work so that polish does not cause jank.
20. As an organizer, I want every original game and the experiment prompt preserved so that the comparison remains authentic.
21. As an organizer, I want preview test votes isolated and removed so that testing does not affect public rankings.
22. As a viewer, I want the page usable if the animation library cannot load so that motion is an enhancement.

## Implementation Decisions
- Use the official GreenSock core, timeline, and performance skills as reviewed guidance. Prefer first-party relevance over unverified popularity counts. No external skill scripts or global skill installation are needed.
- Preserve the approved dark, minimal layout, copy, model identity labels, phone warning, copy icon, and backend. Change launcher presentation and player-wrapper presentation only.
- Pin GSAP; bundle and serve it locally with the site. Avoid additional animation plugins unless needed. Keep the added motion bundle below 45 KiB gzip.
- Arrival runs once per browser-tab visit; animate the headline and only initially visible cards for under 500 ms total. Content is visible by default and never waits on a loader.
- Model names slide a short distance through a crop with a short stagger, about 500 ms total for five names. No countdown or scrambled text. Animate the active view; hidden views show the current reveal state when visited.
- Typical interaction durations are 150–250 ms; use decelerating easing, no elastic bounce. Button press response starts immediately. New interactions replace conflicting tweens rather than queueing them.
- Native dialogs keep focus handling, Escape, and semantic controls. The rating sheet enters and exits with a small translation/fade; reopening interrupts closing safely.
- Save feedback follows successful API response only: selected stars pulse once, button confirms with a checkmark. Editing restores the update action. Scores and distributions reflect real aggregate values only.
- Prefer transform and opacity animation. Results bars animate scale rather than width. Do not add continuous scrolling handlers, scroll pinning, custom cursors, sound, confetti, or infinite animation.
- Reduced-motion mode presents final states immediately; changes to the preference finish and clean up active animation. Preserve fallback functionality without GSAP.

## Testing Decisions
- Use the already approved highest seam: browser interactions with the existing website and real preview ratings API. No new testing interface or gameplay fixtures.
- Record a before/after load comparison under matching viewport and CPU conditions. Distinguish lab samples from field Core Web Vitals; do not claim a device-independent performance guarantee.
- Exercise reveal/hide and tab changes rapidly under 4x CPU throttling; verify final state, focus, and no stuck styles.
- Verify arrival once, dialog open/close/Escape, desktop hover, button feedback, copied icon, and phone warning.
- Verify preview rating save/edit and unchanged vote count, star/check feedback, distributions, retry feedback, and clean fixtures afterward. Preserve all API semantics.
- Check 390px mobile and desktop layout, reduced motion, no library fallback, and absence of animation-induced layout shifts.
- Compare frozen game hashes before/after and keep game/backend/prompt diffs empty. Build, deploy to Vercel, and verify live artifacts and interactions.

## Out of Scope
Gameplay changes, touch-driving controls, pricing changes, ranking-rule changes, public test votes, paid services, a site redesign, custom cursors, sound, confetti, scrolling takeovers, animation on every scroll, and broad framework migrations.

## Further Notes
The user approved this motion package and requested a performance pass. Precision and responsiveness take priority over spectacle. The implementation is complete only when the live deployment is verified and its evidence and limitations are recorded.
