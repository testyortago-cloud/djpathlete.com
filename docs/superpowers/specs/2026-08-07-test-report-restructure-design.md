# Test Report Restructure — Design

**Date:** 2026-08-07
**Status:** Approved, ready for planning
**Scope:** Spec A of four. Presentation only — no migration, no new data.
**Supersedes the layout of:** `55d0a296..81e24937` (the 2026-08-06 three-page report)

---

## Why

Darren reviewed the `/athlete/<token>` test report on camera and gave ~7 minutes of
feedback. His summary: *"looks really good… just need to condense it a bit more so
there's no real duplication, and be consistent with some of the visuals."*

He was right about the duplication, and it is worse than he described. The weakest
category is rendered **six times** across two pages:

| Page | Section | Occurrence |
|---|---|---|
| 2 | KPI tile `Focus — <cat>` | 1 |
| 2 | "Where you're strong and where you're not" bar list | 2 |
| 2 | "Category breakdown" card | 3 |
| 2 | "Testing categories covered" chips | 4 |
| 2 | Coaching cue (derived from focus) | 5 |
| 3 | "One signal across your testing" | 6 |

Page 3 repeats itself too: "Where you stand" renders `tests.slice(0, 4)` as circles,
then "Test by test" renders **all** tests — including those same four — in a
different visual idiom.

There are seven distinct visual idioms for what is fundamentally one quantity
("a score"): sparkline, `ScoreBar`, `RangeBar`, `MetricCompare` circles, `KpiTile`
numerals, `BandPill`, `CategoryChips`.

## Decisions

Settled with the owner during brainstorming. Where the owner delegated, the call
and its reasoning are recorded so it can be revisited rather than re-derived.

| # | Decision | Decided by |
|---|---|---|
| 1 | **Audience is the athlete only.** Anything that serves only Darren's coaching decisions is cut from the report; the admin Arena view at `/admin/clients/[id]/arena` is where diagnostics live. | Owner |
| 2 | **Two pages, masthead strip.** The cover page is deleted; name, sport, date and a small portrait become a banner across the top of page 1. | Owner |
| 3 | **Focal points = 2 × (weakest category + the test dragging it + one instruction).** | Owner |
| 4 | **"Athlete Performance Index", shorthand "API"**, explained in one line under the number. Code keeps `athleteScore` — this repo has `app/api/` throughout. | Owner |
| 5 | **Biggest mover prefers improvement.** Show the largest *positive* delta; fall back to the largest decline only when nothing improved. | Delegated — see below |
| 6 | **Sparkline survives as the one second idiom.** | Delegated — see below |
| 7 | **Assessments: latest expanded, older behind a disclosure.** | Delegated — see below |
| 8 | **Arena is left exactly as it is.** | Delegated — see below |
| 9 | **Green bands do not print as fills.** | Delegated — see below |

### 5 — Biggest mover polarity

Darren said both *"biggest mover or biggest change"* and *"the main one to focus on
is improvement"*. Today's code picks the largest **absolute** delta, so a bad testing
week makes the hero of page 1 a red −14%.

Selection becomes: the largest positive `deltaPct`; if no test improved, the largest
decline, flagged `isDecline`. Rationale — the hero is normally celebratory, which is
what he asked for, but the report never lies by omission: when everything went
backwards the block says so plainly rather than vanishing. Declines remain visible in
the page-2 rows either way, so no result is ever hidden.

### 6 — The sparkline stays

The rule is **one idiom per kind of information**, not one idiom total. The score
track cannot encode history; a trend line can. One small, quiet, consistently-placed
sparkline per test row is the only exception, and it is the only remaining chart type
besides the track.

### 7 — Assessments

Darren: *"maybe this previous assessment, maybe this is a drop-down."* The most
recent battery renders expanded. Older batteries collapse into a native `<details>`
labelled "N earlier assessments" — no JS, and `details { open }` is forced in print
so nothing is lost on paper.

### 8 — Arena is untouched

The panels cut from the public report are simply cut, not relocated. Migrating them
into Arena is speculative work for an audience of one who has not asked for it. If
Darren misses a panel he will say so, and moving it then is cheap.

### 9 — Print treatment of the green bands

This is the trap in Darren's banding request. Chrome's Save-as-PDF has **Background
graphics off by default**, so `print-color-adjust: exact` is only a request. White
text on a green band that fails to print is *invisible text* — a silent, total
failure on the medium this document is designed for.

Therefore: on screen, green bands are filled. **In print, green bands become white
ground with dark ink and a 2px primary top rule.** The banding rhythm survives as
rules rather than fills, legibility is guaranteed regardless of the viewer's print
settings, and it saves ink on a document meant to be printed. This is not a
compromise — it is what the medium requires.

**Amended 2026-08-07 after implementation review — "dark ink" is not one value.**
This decision originally said `color: var(--foreground)` and reasoned only about the
light scope. That is wrong. `ReportShell` puts the scope class, `test-report` and
`print-document` on the **same element**, so the print rule also fires in
`.athlete-arena`, where `--foreground` is near-white — white on unpainted paper.

The generalisable rule, which applies to every future print or fallback style here:
**the two scopes define the same token NAMES with OPPOSITE POLARITY.** A token being
defined in both scopes does not make it safe; that only guarantees it resolves, not
that it resolves to a usable colour. Anything that must stay legible when its
background is dropped needs its ink chosen **per scope**:
`.report-light .report-band-green { color: var(--foreground) }` and
`.athlete-arena .report-band-green { color: var(--primary-foreground) }`.

## Out of scope

Tracked as their own specs; this one must not grow to include them.

- **Spec B — Coach commentary.** Darren's own words on the report. This spec
  reserves the slot and renders nothing when empty.
- **Spec C — Limb vs limb.** `performance_tests` stores one `result_value`; L/R
  needs a schema change. **Note for whoever writes Spec C:** an earlier draft of this
  section promised a head start — that `RangeBar` already accepted `left`/`right`
  props. **That component was deleted by this branch.** The head start no longer
  exists; L/R rendering will be built on `ScoreTrack`
  (`components/public/report/panels/ScoreTrack.tsx`) from scratch.
- **Spec D — Editable reference ranges.** The 17 ranges in
  `lib/coach-intel/test-normalization.ts` stay hardcoded here.

## Design

### Page 1 — four bands

1. **Masthead** *(green)* — name, sport · position · age, test date, "N tests over
   M months", 84×108 portrait. Replaces the entire cover page.
2. **Index + mover** *(white)* — two columns.
   - Left: **Athlete Performance Index**, `API` pill, big numeral, score track, and
     the one-line explanation: *"The average of your five category scores. Every test
     is scored 0–100 against DJP's coaching standards — 50 is Trained, 100 is Elite."*
     Below it a single line: *"Strongest: Endurance 73."*
   - Right: **biggest mover**, accent-orange, the only accent moment on the page —
     delta, test name, `43.5 → 48.2 cm`, dates, its own track.
3. **Focal points** *(surface)* — two cards, each: category name, band pill, score,
   track, the culprit test named with its value, and one instruction.
4. **Coach's note** *(white)* — reserved slot, renders nothing until Spec B.

### Page 2 — three bands

1. **Section head** *(green)* — "The full verdict / Test by test", plus one line
   explaining the track so page 2 stands alone.
2. **Test rows** *(white)* — one row per test: name + date, value + unit, score
   track, direction-aware delta, sparkline, PR pill. Every test, once. Footnote:
   Elite/Trained are DJP standards, not measured averages, never percentiles.
3. **Assessments** *(surface)* — per decision 7.

### The one idiom — `ScoreTrack`

Every score in the report renders through one component at one scale: left edge is
the reference-range floor, a tick at the midpoint is **Trained**, the right edge is
**Elite**, and a dot sits at the score.

This is load-bearing beyond consistency. The 0–100 score *is* the athlete's position
between the range floor and Elite — so drawing that scale explains how the number is
made, which is Darren's *"how are the headline numbers created?"* answered visually
instead of in a paragraph. It also makes "Bench 54, Squat 68" legible at a glance.

Replaces: `KpiTile`, `ScoreBar`, `RangeBar`, `MetricCompare`, `CategoryChips`.

## Modules

### `lib/test-report/scoring.ts`

```ts
export interface FocalPoint {
  category: RadarCategory
  score: number
  band: Band
  /** Lowest-scoring test in the category — what drags the average. */
  culprit: ScoredTest
}

export interface BiggestMover {
  test: ScoredTest & { deltaPct: number; previous: number }
  /** True only when NO test improved and this is the least-bad result. */
  /**
   * Three states, not a boolean. Amended during implementation: when every test's
   * change rounds to zero the mover is neither an improvement nor a decline, and a
   * page keying off a boolean printed "Biggest improvement" above "0%".
   */
  direction: "improved" | "flat" | "declined"
}
```

- `ReportScores.focus` → `ReportScores.focalPoints: FocalPoint[]`.
  Derivation: take `Math.max(0, Math.min(2, categories.length - 1))` categories from
  the bottom of the sorted list, lowest first. So 3+ categories → 2 focal points,
  2 → 1, 1 or 0 → none. The `max(0, …)` is not decoration: `categories.length - 1`
  is `-1` on an empty list, and a negative count passed to `slice` silently returns
  the wrong end of the array. **The top-ranked category
  is never a focal point** — labelling an athlete's best quality a focal point is
  wrong, and it is the failure mode a naive "take the last two" produces at
  `categories.length === 2`.
- `culprit` = the lowest-scoring scorable member test. Categories only exist in
  `categories` when they have ≥1 scorable test, so `culprit` is always present.
- `biggestMover` per decision 5. A test with `deltaPct !== null` always has
  `previous !== null` (both require ≥2 results); the type narrowing must be derived,
  not asserted.
- `strongest` is retained and used in exactly one line under the API.

### `lib/test-report/cues.ts`

The 5 × 3 `CUES` matrix is kept — the structure is right and the tone rule
("candid but constructive, name the gap then give the instruction") stands.

**All 15 strings are rewritten to one sentence.** They are currently 2–3 sentences
each; two focal points would put six sentences of generic advice on page 1, which is
precisely the "reduce some of the wording… a bit less overwhelming" note. The culprit
test is named in the line above the cue, so the cue no longer needs to establish
context.

`selectCue(focus)` → `cueFor(fp: FocalPoint): string`, still a pure matrix lookup.

### Components

| Action | Component |
|---|---|
| **New** | `ScoreTrack`, `ReportMasthead`, `IndexBlock`, `MoverBlock`, `FocalPointCard`, `CoachNoteSlot`, `TestRow`, `AssessmentBatteries` |
| **Delete** | `ReportCover`, `KpiTile`, `ScoreBar`, `RangeBar`, `MetricCompare`, `CategoryChips`, `CueBlock`, `panels/SectionHeading` |
| **Rewrite** | `ReportHeadline` → `ReportPageOne`, `ReportVerdict` → `ReportPageTwo` |
| **Adapt** | `ReportPage` — gains banding slots; keeps `break-after: page` |
| **Unchanged** | `ReportShell`, `BandPill`, `Sparkline` |

`panels/SectionHeading` is deleted because bands now carry their own eyebrow — the
new pages have no caller for it. The identically-named
`components/admin/arena/SectionHeading.tsx` is a **different file** and must not be
touched; deleting the wrong one breaks the Arena view.

`ReportShell` is deliberately untouched: `.report-light` and `.athlete-arena` define
the same token names, which is what makes the theme toggle need zero component
changes. New band classes must follow that rule — declare tokens in both scopes.

### `app/globals.css`

New `.report-band` / `.report-band-green` / `.report-band-alt` inside the
`.test-report` scope, built only from existing tokens (no new hex, no new colours).
Plus the print rules from decision 9.

## Data flow

Unchanged. `getTestReportData()` → `buildReportScores()` → components. No new
queries, no new columns, no change to the projection that keeps `notes` and
`video_url` out of the public payload.

## Error and empty states

- **No tests** — the existing single honest page is kept, updated to the masthead.
- **One category** — focal-points band omitted entirely, not padded.
- **No deltas** (every test logged once) — mover band omitted.
- **Unscorable tests** (custom, or a 1RM with no body weight) — the row renders with
  its value and no track. A test the athlete performed must always appear.
- **No assessments** — band omitted.
- **No photo** — the masthead portrait falls back to the monogram panel.

## Testing

Per the house lesson on tests that pass without verifying their claim, each of these
must fail if the defect returns.

- `scoring.test.ts` — `focalPoints` at 0 / 1 / 2 / 3+ categories; assert the
  top-ranked category is never returned at `length === 2`; culprit selection picks the
  lowest member; mover polarity across all-positive, all-negative, mixed, and tie.
- `cues.test.ts` — `cueFor` covers all 15 (category × band) pairs; assert each string
  is a single sentence, so the rewrite cannot silently regress.
- `test-report.test.tsx` — **the anti-duplication assertion**: render a fixture with a
  known weakest category and assert its name appears **at most twice**. This is the
  regression guard for Darren's core complaint and must count occurrences, not merely
  assert presence. Plus: the API explanation renders; "percentile" never renders
  (existing test, keep).
- **Print stylesheet assertion** — a config-level test that `globals.css` defines a
  dark-ink print rule for `.report-band-green`. Per the house lesson on CSP hosts
  being invisible to tests, a stylesheet-level guarantee needs an explicit assertion
  or nothing catches its removal.
- E2E print snapshot is **not** added — the existing suite has no print-rendering
  harness, and building one is disproportionate to this change.

## KNOWN ISSUE, NOT FIXED — dark theme + "Background graphics" OFF prints an invisible page

**Severity: high. Pre-existing, deliberately not fixed in this branch, and it must not
be archived as a footnote.**

`app/globals.css` (the `.athlete-arena.print-document` rule, introduced well before
this work in `3cbcbe3b`) deliberately keeps the dark presentation in the PDF, so the
dark page ground is painted rather than flipped to white. When Chrome's **Background
graphics** setting is off — which is its **default** — that ground is not painted, and
near-white body text lands on white paper at roughly **1.09:1**. The whole body of the
report is invisible.

Reachability: the viewer must deliberately toggle to dark before printing. The default
light path is unaffected and verified legible with backgrounds both on and off.

It was left alone because fixing it correctly means choosing between three real
options, each with blast radius on the admin Arena card, which shares the scope and is
separately shared as a PDF:

1. **Force the light scope in print regardless of the toggle.** Simplest and safest for
   this document — it is print-first and light is already the print default — but it
   silently overrides a deliberate earlier decision to ship dark PDFs.
2. **Flip only the token values under `@media print` in the dark scope**, keeping the
   dark look on screen. Preserves both intents; more CSS to maintain.
3. **Leave it and document it in the UI** — e.g. the Save-PDF control warns when the
   dark theme is active.

This is the same failure class as the masthead bug this branch fixed (near-invisible
ink), at a larger blast radius. Whoever picks it up should treat it as its own small
spec, not a patch.

## Before this is shown to Darren

- Render from a **real client's tests**, not the fabricated sample in the draft. His
  first instinct will be to check whether the figures are plausible for a real athlete.
- Migration `00200_client_report_photo.sql` is **still not applied to prod**. Until it
  is, the coach photo upload silently no-ops and the masthead falls back to the
  monogram. Apply it or the portrait decision cannot be evaluated.
- The 2026-08-06 report is committed on `main` but **not pushed**. This work lands on
  top of unpushed commits.

## Reference

- Draft: `https://claude.ai/code/artifact/59425ac4-9560-4399-81a4-83ee374d7777`
- Structure options explored: `.superpowers/brainstorm/31273-1786106712/content/structure.html`
