# Lead Engine Stage 1c — captured from the running app

Captured 2026-08-19 by driving the real app with Playwright against the branch
`feat/lead-engine-stage1c`, signed in through the dev-login bypass, against the
**dev** Supabase project (`anjvztjiokcgiyhobknq`) — never production.

The annotations are burned into the `-annotated.png` files; the `-clean.png`
files are the same pages with no markers.

| File | What it shows |
|---|---|
| `pipeline-board-light-annotated.png` | `/admin/pipeline` with all four stages populated |
| `pipeline-board-light-clean.png` | same, unannotated |
| `campaign-revenue-light-annotated.png` | `/admin/insights/campaign-revenue` |
| `campaign-revenue-light-clean.png` | same, unannotated |

## Why there are no dark-mode shots

**The admin surface is light-only, and this is pre-existing — not something
Stage 1c introduced.** I verified it rather than assuming: dark is implemented
as a `.dark` *class* variant in `app/globals.css` (Tailwind v4
`@custom-variant dark (&:is(.dark *))`), not via `prefers-color-scheme`. Forcing
that class on the existing `/admin/dashboard` makes its headings, sidebar labels
and stat numbers disappear exactly as it does on the new pages — the admin
components were never built against those tokens.

Shipping "dark mode" screenshots of a surface that has no working dark mode
would have misrepresented it, so they were deleted after capture.

## The data behind these shots

Seeded into the dev database specifically so the screenshots show meaningful
state rather than an empty board:

- **Consult Booked** — Jordan Rivera (1 day, green), Priya Raman (4 days, amber),
  Marcus Bell (9 days, red). This stage's thresholds are amber ≥ 3 days, red ≥ 7.
- **Consulted** — Ana Sousa (2 days, green), Tomas Lindqvist (7 days, amber).
  Different thresholds: amber ≥ 5, red ≥ 14.
- **Won** — Kaia Okafor $1,200.00, Deshawn Price $895.00.
- **Lost** — Elena Duarte, closed by a no-show.

Two contacts carry first-touch attribution to `spring_speed_camp` (Instagram);
Deshawn Price deliberately carries none, so the campaign-revenue report shows a
real campaign row *and* a non-zero unattributed bucket side by side.

## A bug these screenshots found

The first capture rendered **"'s coaching pipeline."** and **"Every won deal in
's pipeline"** — `business_settings.display_name` is seeded as an empty string,
and neither page had a fallback for a blank name. That would have shipped to any
install where the owner had not filled in Business Settings, which includes
production today. Fixed in `449032e0`; these shots are from after the fix and
read "The coaching pipeline."
