# Full-screen draft preview — annotated screenshots

Captured on 2026-08-22 by driving the **real app** with Playwright against the dev
clone (`npm run dev`, port 3050), signed in as a real admin session. Every image is
the actual route in an actual browser — no harness, no storybook, no mockup.

Annotations are burned into the PNGs. Each is composed at the capture's exact pixel
width (2880) and never upscaled; only height is padded for the title banner and the
caption legend.

| File | What it shows |
|---|---|
| `01-preview-full-screen.png` | `/preview/test` — an unpublished draft at full width, the step CTA rewritten onto the preview base, and the "not published" pill |
| `02-test-run.png` | Submitting the real form: the owner's own success message, the reported next step, the captured values, and "Nothing was saved" |
| `03-builder-header.png` | The new **Preview** button in the builder header, beside the unchanged "Live page" |
| `04-cards.png` | `/admin/funnels/<id>` — the never-published step now previews its draft and gains a Preview button; the published step is deliberately untouched |
| `05-nothing-to-preview.png` | `/preview/test/thanks` — a page with no draft yet, which says so rather than 404ing |

## What was verified, not assumed

- **`/go/test` returns 404 anonymously** — `curl` against the running dev server. That
  is the state the whole feature exists to work around.
- **`/preview/test` returns 404 anonymously** — a second browser context with no
  cookie. The gate fails closed and answers 404, never a redirect.
- **The CTA href is `/preview/test/index`**, read out of the rendered DOM. That is the
  base-path rewrite doing its job, not an assumption about what the renderer did.
- **Exactly one Preview link renders on the funnel detail page**, pointing at
  `/preview/test/thanks` — the unpublished step, never the published one.

## One defect these screenshots caught

`02-test-run.png` originally listed `athlete_name` / `parent_name` — the database
column names — to a coach. Every unit test passed, because nothing asserted which of
the two strings came back. The endpoint now returns the field's **label**, and two new
tests pin it.

## Note on the environment

The dev clone was missing `funnels.kind` (migration `00205`), so `/admin/funnels` and
`/admin/pages` returned 500 before these were captured — a pre-existing drift in the
clone, unrelated to this branch (`listFunnels` in `lib/db/funnels.ts` is untouched
here). `00205` is additive and idempotent; it was applied to **dev only** to make
those two screens reachable. Prod is unaffected and was never contacted.
