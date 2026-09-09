# Community ratings

The live poll stores one editable 1–5-star rating per browser and game. A random browser token is hashed before storage. No accounts, names, or emails are collected by the feature. Clearing storage or using another browser allows another vote; this is a casual community poll, not verified one-person voting.

The mean, count, and five-bin distribution come directly from rating rows. Games need five ratings to rank. Exact mean ties share competition ranks; unranked games remain in their original order. Results update on load, save, or manual refresh. Game cards never reorder and model identities remain controlled by Reveal models. Rating dialogs live outside the frozen game iframes.

## Infrastructure

Neon Free project `kart-paddock-ratings` (`wild-star-95018642`), Washington DC, is connected through Vercel Marketplace to `kart-paddock`. Auth is disabled. The explicitly selected Free plan is $0; no paid upgrade was provisioned. Plan limits can change; consult [Neon pricing](https://neon.com/pricing). Vercel injects server-only `DATABASE_URL` into production, preview, and development. Never copy it into static files, browser JavaScript, or Git.

The same-origin Node 24 Vercel Function at `/api/ratings` uses Neon's HTTP serverless driver. Production always uses the `community` namespace. Nonproduction defaults to `preview`; local tests use a unique `test-*` namespace. A client cannot choose a namespace. Preview deployments share preview test data and do not affect public scores.

`GET` returns aggregates and, with a valid `X-Voter-Token`, that browser's ratings. `POST` requires same-origin JSON containing a fixed game key `a`–`e` and integer `stars` 1–5. A database unique key and atomic upsert prevent duplicate inflation. A durable per-token limit allows 30 updates per minute. This is basic abuse protection, not protection against deliberate creation of fresh identities. Failed saves display an error and retain the selection for explicit retry.

## Setup and commands

Use the existing Node 24 / npm environment. From this repository:

```sh
npm ci
vercel env pull .env.ratings.local --environment=development --yes
npm run db:migrate
npm run test:ratings
npm run assemble
npm run dev:ratings
```

The environment file is ignored by Git. Migration creates two constrained tables idempotently. Tests use the actual Neon database, isolate their records, and clean them up in a finally block. The local review server binds only to localhost:4310. For independent local browser identities, use localhost and 127.0.0.1; they share preview aggregates but have different browser storage.

For a launcher-only release, preserve all compiled games:

```sh
npm run assemble
vercel deploy --prebuilt --yes
# After preview verification:
vercel deploy --prebuilt --prod --yes
```

No browser testing requires changing game backend allowed origins or gameplay. Preview game servers may reject the preview origin; ratings remain independently testable.

## Verification — September 9, 2026

- Real Neon API integration suite: 9 passing tests, zero failures. Empty results, save/restore/edit, concurrent duplicate writes, separate voters, four-to-five eligibility, distributions, validation, cross-origin rejection, throttling, and unavailable-service responses passed.
- Browser: two independent voter identities, edit without count inflation, reload persistence, shared aggregates, exact ties, small-sample labels, expanded distributions, and independent model reveals passed.
- Hosted preview: a real Vercel Function saved a vote to Neon and returned the updated aggregate.
- Failure/retry: stopped the local server, attempted an edit, observed connection error with retained selection, restarted it, and saved successfully without an extra vote.
- Player wrapper: arrow-key selection, Enter save, native modal controls. Narrow 390px layout had no horizontal overflow. Reduced-motion emulation returned the final score and a 0s bar transition. Desktop and narrow layouts were visually inspected.
- All 285 files in the pre-feature frozen-game hash baseline were unchanged. No `games/` file was edited or rebuilt.
- Preview fixtures were removed after testing. Public `community` data was never seeded. Database contained zero ratings before production release.

This is browser and API verification on one Mac, not a test with physical independent devices or a 200-user load test. Game correctness is intentionally outside this feature. See `verification/community-ratings.json` for release evidence.
