# Results layout refresh — September 9, 2026

Presentation-only change to the community board. Homepage and prompt copy remain unchanged. No game, API, voting, or persistence code changed.

- Each game has an independent article with name/model identity on the left and score/count on the right.
- Rank appears only when eligible (five ratings). No leading placeholder or reserved empty column.
- Native Rating breakdown disclosure below the information row replaces the far-right plus. Its target is at least 44px tall; expanded details retain the histogram and revealed source link.
- Empty and unavailable results do not show a fabricated zero average.
- Existing GSAP histogram/reordering behavior and global reduced-motion CSS remain in place.

## Verification

Used an isolated local HTTP fixture, with no production rating writes:

- One rating per game: all five scores/counts shown, all ranks hidden.
- Five-vote threshold and ties: 5/6 ratings at 5.0 receive ranks 1/1; a third eligible game receives rank 3. Four-rating game remains unranked. Zero-rating game says No ratings yet and has no score.
- Model reveal shows the correct name under each game; expanding Parcel Panic shows its histogram and pinned Astra source link.
- Initial HTTP 503 shows unavailable status; Refresh recovers to populated results.
- Desktop browser and 375px-wide iframe screenshots inspected. Name, score, count, and disclosure remain legible without visible horizontal overflow. This is a narrow-browser layout check, not a physical phone test.
- Separate parallel layout review and mechanical pre-scan completed. Spacing/identity grouping findings addressed with a scoped 4px scale, optional ranks, and aligned score/count. Final layout detector returned no findings.
- `node --check site/ratings.js` and `npm run assemble` passed.
- SHA-256 comparison: all 340 frozen source and distribution files unchanged.

The repeated rows/dividers are deliberate comparison structure. The existing 420px section minimum height is retained to reduce short-state movement. Native disclosure semantics and existing reduced-motion handling were inspected in source; this pass did not rerun physical-device or assistive-technology testing.
