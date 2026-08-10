# Test Report — metric-visual refinement (zoned track + mover circle)

**Date:** 2026-08-10
**Status:** Approved (user "lgtm" on the two-question design: banded track + mover-only circle)
**Route:** `/athlete/<token>` — public two-page test report
**Prior spec:** `2026-08-07-test-report-restructure-design.md` (the ScoreTrack consolidation this refines)

## 1. Why — Darren's 2026-08-10 recorded feedback

Darren likes the restructured report ("pretty close", "sharp, concise") — structure, API,
biggest mover, focal points, PRs, notes all stay. His one issue is the metric
visualization:

- *"If I'm to go down here and I see these lines, lines, lines… doesn't give much of a
  reference."* — Page 2 stacks 13–17 identical unlabeled 8px tracks. `ScoreTrack`
  renders **no text at all**; Trained/Elite exist only in band-intro copy, and the norm
  is never shown in the test's real units.
- *"I don't think they should visually show anything, especially if there's not much of
  a change… what kind of time period this would be over."* — Sparklines render for any
  ≥2-point series with no time anchor; deltas are undated.
- He remembers liking *"the red and the green"* and *"the circle with the performance,
  last performance, professional and comparison"* — and can't find them.

**Identification (from git archaeology):** the circle is `MetricCompare`
(`git show 10aea387:components/public/report/panels/MetricCompare.tsx`) — big filled
"Now" circle with "Prev" inside, two outlined Elite/Trained standard circles, red/green
delta. It was live for exactly one day (added `af3e2326` 2026-08-06, deleted `fd116a8b`
2026-08-07). The red/green is `RangeBar` (same tree): red zone 0–40, green zone 65–100,
marker dot. Both were deleted in response to Darren's *previous* feedback ("be
consistent with some of the visuals") when seven score idioms collapsed into one.

**Synthesis:** he wants the consistency AND the reference-richness. So: evolve the one
idiom to carry the reference (zones, labels, units), and reinstate the comparison circle
in exactly one place — the page-1 hero — where "comparison" is genuinely a different
kind of information than "position on a scale".

## 2. Decisions

| # | Decision |
|---|----------|
| 1 | `ScoreTrack` gains band **zones** (red 0–40, neutral 40–65, green 65–100) and loses its fill bar; tick + dot stay. One idiom everywhere it already renders. |
| 2 | Page-2 `TestRow` gains a **real-unit norm caption** ("Trained 45 cm · Elite 65 cm"), a **`BandPill`**, and a **dated delta** ("↑ 4% / since 12 May"). |
| 3 | Page-1 biggest mover replaces its track + "prev → now" line with a **border-drawn comparison circle** (`MoverCompare`): Now circle with Prev inside, Trained/Elite satellite circles in real units. |
| 4 | `ScoredTest` gains `previousDate` and `targets` (re-added; `referenceTargets()` already exists). Presentation-only — no migration, no new queries. |
| 5 | ~~Sparkline renders only for ≥3 points with real movement~~ **AMENDED 2026-08-10 (user follow-up: "there is still lines"): the sparkline is removed from test rows entirely** — at row scale a 3-point series draws as one bare diagonal slash and the 96px SVG overflowed its column. History = the dated delta. Zero-delta text becomes "steady". |
| 6 | All new color derives from existing tokens (`--error`/`--success` tints); zones/pill/circle are **border-drawn in print**. |

## 3. Component design

### 3.1 ScoreTrack v2 (`components/public/report/panels/ScoreTrack.tsx`)

- **Zones.** Two absolutely-positioned children inside `.score-track` (the neutral
  middle is the existing `--border` rail showing through):
  - `.score-track-zone-low` — `left: 0; width: {BAND_DEVELOPING_MIN}%`, red tint.
  - `.score-track-zone-high` — `left: {BAND_STRENGTH_MIN}%; right: 0`, green tint.
  - Widths come **inline from the imported constants** in `lib/test-report/scoring.ts`
    (`BAND_DEVELOPING_MIN = 40`, `BAND_STRENGTH_MIN = 65`) — never restated in CSS, so
    the picture and `bandFor()` cannot disagree (the old `RangeBar` did exactly this).
  - Tints in `globals.css`: `color-mix(in oklab, var(--error) 22%, transparent)` /
    `color-mix(in oklab, var(--success) 22%, transparent)`. Tokens-only rule holds
    (same precedent as `BandPill`'s `bg-[var(--success)]/15`). End radii match the rail.
- **Fill removed.** Zones + fill is mud; the dot alone carries the score. The
  `.score-track-fill` element and its screen + print CSS are deleted, not orphaned.
- **Tick (Trained, 50%) and dot unchanged.** `data-tone="accent"` now colors only the
  dot border (the fill it used to color is gone) — the page-2 mover row stays findable.
- **Accessibility.** `aria-label` becomes
  `Scores {pct} out of 100 — {BAND_LABELS[bandFor(pct)]}. Trained is 50, Elite is 100.`
  with `bandFor`/`BAND_LABELS` imported, not restated.
- **Print** (in the existing `@media print` block): each zone collapses the same way
  the rail does today — `height: 0; border-bottom: 8px solid <color-mix>` with
  `top: 0; bottom: auto`. Border colors survive backgrounds-off, but alpha washes out
  on paper — the print rules use a **stronger mix (~45%)** than the screen's 22%. The
  `.score-track-fill` print rules (including the accent fill override) are deleted.

### 3.2 TestRow v2 (`components/public/report/panels/TestRow.tsx`)

Grid stays `md:grid-cols-[13rem_7rem_1fr_5rem_4rem]`. Changes per column:

- **Col 3 (track):** below the track, when `test.targets` is non-null, one caption line
  `flex justify-between` in mono 10px muted:
  left `Trained {num(targets.trained)} {unit} · Elite {num(targets.elite)} {unit}`,
  right `<BandPill band={bandFor(test.score)} />` (only when `score !== null`).
  Custom/unscorable rows keep "No standard for this test" — no caption, no pill.
  (`score === null ⇔ targets === null`: both derive from the same range + body-weight
  inputs, so the pair can't disagree.)
- **Col 4 (delta):** line 1 unchanged coloring; zero-delta text changes `= 0%` → `steady`
  (muted). Line 2, 9px mono muted: `since {formatDate(test.previousDate)}` whenever
  `previousDate` is non-null. First-test rows keep `—` with no date line.
- **Col 5 (sparkline):** render only when `points.length >= 3` **and**
  `min(points) !== max(points)`. Otherwise render nothing — a flat or two-point series
  is exactly the "line that visually shows something when there's not much of a change"
  Darren objected to. The delta column already carries "steady"/the dated change.

Row-height budget: the caption adds ~14px/row. Verify the reference athlete's 13-row
page 2 still prints on one sheet; if it overflows, tighten row `py-3` → `py-2` before
shrinking type.

### 3.3 MoverCompare (`components/public/report/panels/MoverCompare.tsx`, new)

Used **once**, in `ReportPageOne`'s mover panel. The panel keeps its eyebrow, the big
accent Δ% headline (still the page's single accent moment — the circle lives inside
it), the test label, and the caveat copy. The `prev → now` mono line and the accent
`ScoreTrack` are **replaced** by the circle group:

- **Now circle:** ~104px, `border-[3px]` accent border, `bg-card`, foreground ink
  (the old version was `bg-primary` fill with `--primary-foreground` text — invisible
  in backgrounds-off print; border-drawn fixes that). Inside, stacked: tiny mono muted
  `PREV {num(previous)}` (previous is always non-null on a mover), then
  `{num(latest)}{unit}` in heading type, then tiny mono muted `NOW`.
- **PR badge:** if `isPr`, absolute top-right pill — `border border-accent text-accent`
  (outline, not `bg-accent` fill, for the same print reason).
- **Satellites:** when `test.targets` is non-null, two ~52px circles,
  `border border-border`, transparent bg: value + unit inside, mono caption below —
  `TRAINED` then `ELITE`. Real units; for sprints the Elite figure is the *lower* one,
  which is correct and needs no special casing. When `targets` is null (a 1RM with no
  body weight), the Now circle renders alone.
- **No second delta line** — the panel headline already is the delta; the old
  component's delta row is not carried over.
- **Naming rule:** labels are exactly "Trained"/"Elite". Never "professional average",
  never "percentile" (guarded by existing test).

### 3.4 Scoring additions (`lib/test-report/scoring.ts`)

```ts
interface ScoredTest {
  // …existing…
  /** Date of the result behind `previous`. null on a first test. */
  previousDate: string | null
  /** Elite/Trained standards in the test's own units. null = custom, or relative-to-BW with no body weight. */
  targets: ReferenceTargets | null
}
```

- `previousDate: sorted.length > 1 ? sorted[sorted.length - 2].testDate : null`
- `targets: latest.testType === "custom" ? null : referenceTargets(latest.testType, latest.bodyWeightKg)`
- Additive only; every existing field and derivation untouched.

### 3.5 Copy

- Page-2 band intro sentence becomes: *"{n} tests, each measured the same way every
  time. Every bar is one scale — the tick is Trained, the right edge is Elite; the red
  zone is a priority, the green zone is a strength."*
- Page-2 footnote and page-1 API explainer are unchanged.

## 4. Theme + print constraints (inherited, all still binding)

1. Tokens only, no hex, no new colors — every color a `var()` or a `color-mix()` of one.
   All tokens used (`--error`, `--success`, `--card`, `--border`, `--accent`) are defined
   in both `.report-light` and `.athlete-arena` scopes.
2. Print rebuild from borders: zones (border-bottom), pill (add `border` so the tinted
   bg can vanish harmlessly — ink is already `--success`/`--error`/primary text),
   circles (already borders). Verify in a real browser: light + dark × backgrounds
   on/off. The pre-existing dark+backgrounds-off page-invisibility issue stays out of
   scope.
3. "Percentile" never renders; Elite/Trained naming only.
4. Accent = one moment per page (page 1: the mover panel incl. circle; page 2: the
   mover row's dot).
5. Empty states omit rather than pad.

## 5. Tests

- `__tests__/components/report/score-track.test.tsx` — fill gone; zones render with
  widths driven by the imported constants (assert `40%`/`65%` via the constants, not
  literals); aria-label carries the band word.
- `__tests__/app/score-track-styles.test.ts` — updated block inventory (zone classes
  screen + print, no `.score-track-fill` anywhere); tokens-only assertion holds for the
  `color-mix()` forms.
- `__tests__/app/report-print-styles.test.ts` — zone print rules exist (border-bottom
  rebuild), fill print rules gone.
- `__tests__/components/report/report-page-two.test.tsx` — a scorable row shows the
  real-unit caption, its pill matches `bandFor(score)`, dated delta renders, zero delta
  reads "steady"; a custom row shows none of those; sparkline absent for flat and
  2-point series, present for a moving ≥3-point series.
- `__tests__/components/report/report-page-one.test.tsx` — mover panel: Now/Prev values
  and Trained/Elite satellites render with real units; no `prev → now` mono line; no
  track in the mover panel; "percentile" guard and single-accent-moment guard still pass.
- Scoring unit tests — `previousDate` and `targets` populated/null in the right cases
  (first test, custom, relative-to-BW with and without body weight).

Every changed assertion must be able to fail: assert on rendered text/attributes, not
on component existence.

## 6. Out of scope

Coach commentary (Spec B), L/R asymmetry (Spec C), editable reference ranges (Spec D),
the Arena card (`components/admin/arena/**` untouched), the dark+backgrounds-off print
issue, any data-layer change.
