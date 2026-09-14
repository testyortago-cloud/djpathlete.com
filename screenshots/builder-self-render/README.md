# Builder self-render — evidence index

Spec: [`docs/superpowers/specs/2026-09-14-builder-self-render-design.md`](../../docs/superpowers/specs/2026-09-14-builder-self-render-design.md).
Ledger: [`.superpowers/sdd/2026-09-14-builder-self-render/`](../../.superpowers/sdd/2026-09-14-builder-self-render/) (`task-8-report.md`, `island-placeholder-report.md`).

**Read this first:** the PNGs are NOT all current behaviour. `01`–`05` were captured during the
verification run that *found* the island-placeholder bug — they show the critic filing a false
"empty band" finding and the reviser fabricating a testimonial to fill it. That bug was fixed
afterwards (commit `faaca4c2`). `06`–`07` were captured after the fix and show the same sections
rendering as labelled placeholders instead of blank rectangles. Do not read `02` or `04` as
current output of the review stage — they document the fault, not the shipped behaviour.

## The PNGs, in order

| # | File | Shows | Fix state |
|---|---|---|---|
| 01 | `01-the-page-before-the-review.png` | The real builder, real route, the page as saved before Polish is pressed. | before |
| 02 | `02-the-art-director-describes-the-picture.png` | The review streaming 21 live findings (7 from the art lens) — including two `empty-band` findings that turned out to be false, caused by the island bug. | before |
| 03 | `03-the-page-the-finding-is-about.png` | The real published preview at 1200px, the width the render is drawn at, next to one of the art lens's TRUE picture-only findings (low-contrast body text). | before |
| 04 | `04-proposed-not-applied.png` | The reviser's proposal: 10 ops, 2 of which rewrite sections that were blank only in the render — including a fabricated testimonial quote attributed to an invented person. This is the fault itself, proposed but never applied. | before |
| 05 | `05-the-band-that-is-only-empty-in-the-picture.png` | The real "proof" section on the live page — it actually carries a genuine testimonial (Wayde van Niekerk), proving the `empty-band` finding in `02` was an artefact of the render, not a real defect. | before |
| 06 | `06-the-band-that-used-to-look-empty.png` | The same "proof" section as the critic now sees it: a dashed, labelled placeholder box ("a live testimonial feed appears here…") instead of a blank rectangle. | **after** |
| 07 | `07-the-form-placeholder.png` | The "signup" form section's island, same treatment — a labelled placeholder instead of a blank panel. | **after** |

## The A/B logs (`ab-index-*.txt`)

Each is one document run through `scripts/ab-self-render-critics.ts`: the full critic panel runs
twice against the *same* document and the *same* deterministic audit findings — once with no
render (arm A, today's pre-feature behaviour) and once with the render handed to the art lens
(arm B). Nothing else differs between the two arms. This is the controlled evidence that showing
the model a picture of the page, rather than just its JSON, changes what the art critic finds —
not a claim, a diff.

Chronologically:

- `ab-index-7f5da342-2026-09-14145907.txt`, `ab-index-5ac26645-2026-09-14150147.txt` — the
  original controlled runs, one per document (Task 8's "Evidence A"). Both predate the island fix.
- `ab-index-7f5da342-2026-09-14153021.txt` — a rerun after an earlier prompt fix (the art brief no
  longer claims "YOU HAVE PICTURES" on turns with no render). Still predates the island fix — arm B
  still files `empty-band (proof)` at high severity.
- `ab-index-7f5da342-2026-09-14153938.txt` — island placeholders are in, but the critic's note about
  them was not yet strengthened. Kept deliberately: one residual finding about the *space around*
  the placeholder survives, which is what motivated the final wording.
- `ab-index-7f5da342-2026-09-14154134.txt` — the fix as shipped, two independent rounds. No art
  finding in either round calls an island-backed section empty or missing content.

## Other files

- `render-tiles/` — the actual PNG tiles handed to the art critic during the A/B runs above, at the
  exact sizes it received them (an overview plus 1200-wide slices).
- `capture-log.txt` — the full transcript (findings, proposal ops, assertions) behind PNGs `01`–`05`.
