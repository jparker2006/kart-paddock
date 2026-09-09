# Motion system

GSAP 3.15.0 is pinned and bundled locally by `npm run assemble`. The browser bundle is about 29 KiB gzip. No external animation CDN or additional GSAP plugins are required. The source lives in the launcher build scripts; no game code is touched.

The animation layer is optional: existing controls own state and API calls. It adds once-per-tab-visit arrival, a model-name reveal sequence, tab indicator/view transitions, button press feedback, desktop screenshot hover, dialog transitions, rating-save pulse, and results animation. Transforms and opacity carry motion; the scoreboard keeps its actual server values. Save confirmation is triggered only after a successful API response. Rapid inputs replace current tweens; reduced-motion preferences finish active transitions and present final states. Without the bundle, the original interactions remain usable.

Run `npm ci`, then `npm run assemble`. For local browser checks with the real preview ratings API, run `npm run dev:ratings` using the existing ignored environment file. Deploy with the established Vercel prebuilt workflow. Never rebuild or edit the frozen games for launcher changes.

## Verification

Spec: [GSAP motion](specs/gsap-motion.md). Measurements: [verification JSON](verification/gsap-motion.json).

At 390×844 with 4× CPU slowdown and browser cache disabled, three local baseline loads and three animated returning loads all recorded CLS 0 and no long tasks. Median load event timing was 114.3 ms before and 117.8 ms after; these small local differences are not evidence of a speedup or meaningful regression. The added motion bundle is under the 45 KiB gzip budget.

A separate first-visit sample, including arrival initialization, recorded LCP 180 ms and one 106 ms long task (56 ms beyond the long-task threshold). This is retained as a limitation rather than hidden behind the returning-visit results. A 20-second real-interaction sample recorded a 17.5 ms 95th-percentile frame interval, a 33.3 ms maximum frame interval, no long tasks, and a maximum observed event duration of 72 ms. This is a laboratory sample on one Mac, not field INP, WAN loading, or a physical low-end phone benchmark.

Browser checks passed for reveal/hide repeats, tab switching, rating save/edit, failed save/retry, sheet closing/Escape, reduced motion, blocked-library fallback, copy confirmation, desktop hover, and the phone play warning. Preview fixture votes were removed. All 340 frozen source and built-file hashes match the pre-design baseline; backend and original prompt are unchanged.

## Guidance used

First-party skills were reviewed as text; no remote skill scripts were executed or globally installed. Selection was based on source relevance, not unverified popularity scores:

- [GSAP Core](https://github.com/greensock/gsap-skills/blob/main/skills/gsap-core/SKILL.md)
- [GSAP Timeline](https://github.com/greensock/gsap-skills/blob/main/skills/gsap-timeline/SKILL.md)
- [GSAP Performance](https://github.com/greensock/gsap-skills/blob/main/skills/gsap-performance/SKILL.md)
