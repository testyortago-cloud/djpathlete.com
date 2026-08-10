# Report Metric-Visual Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every score visual in the public test report a legible reference (band zones, real-unit norms, dated deltas) and reinstate the comparison circle for page 1's biggest mover.

**Architecture:** Presentation-only. Two additive fields on `ScoredTest` (`previousDate`, `targets`), a zoned `ScoreTrack` (fill removed), an upgraded `TestRow`, one new `MoverCompare` panel used once in `ReportPageOne`, and matching screen+print CSS in `app/globals.css`. No data-layer, route, or migration changes.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 tokens in `app/globals.css`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-10-report-metric-visual-refinement-design.md`

## Global Constraints

- Tokens only, never hex; new colors only as `color-mix(in oklab, var(--error|--success) N%, transparent)`. Every `var()` token must be DECLARED in both `.report-light` and `.athlete-arena` scopes (the styles test enforces this automatically).
- Print survives Background-graphics-OFF: anything meaningful must be drawn with borders in `@media print`. Screen zone tint is 22%; print border mix is 45% (alpha washes out on paper).
- Band thresholds are IMPORTED from `lib/test-report/scoring.ts` (`BAND_DEVELOPING_MIN` = 40, `BAND_STRENGTH_MIN` = 65) — never restate the numbers in components or CSS.
- The word "percentile" must never render. Standard labels are exactly "Trained" and "Elite".
- `components/admin/arena/**` untouched. No changes to `lib/profile-share/*` or any DAL file.
- The tree is permanently dirty — `git add` EXPLICIT paths only, never `-A`.
- The screen-mode `.score-track*` CSS rules must all sit between `.test-report .score-track` and the first `.test-report .report-band` rule in `app/globals.css` — the styles test slices that range.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Scoring additions — `previousDate` + `targets`

**Files:**
- Modify: `lib/test-report/scoring.ts` (interface ~line 45-62, builder ~line 169-186)
- Test: `__tests__/lib/test-report/scoring.test.ts`
- Modify (fixture compile-fix only): `__tests__/components/report/report-page-two.test.tsx` (the four `ScoredTest` literals at lines 23-99)

**Interfaces:**
- Consumes: `referenceTargets(testType, bodyWeightKg)` and `type ReferenceTargets` from `@/lib/coach-intel/test-normalization` (already exists — `{ elite: number; trained: number; relativeToBodyWeight: boolean; direction: "higher" | "lower" }`).
- Produces: `ScoredTest.previousDate: string | null` and `ScoredTest.targets: ReferenceTargets | null` — Tasks 3 and 4 render these.

- [ ] **Step 1: Write the failing tests** — append inside `describe("buildReportScores")` in `__tests__/lib/test-report/scoring.test.ts`:

```ts
  it("carries the previous result's DATE so the delta can be time-anchored", () => {
    const s = buildReportScores([
      pt({ testType: "cmj", resultValue: 40, testDate: "2026-01-01" }),
      pt({ testType: "cmj", resultValue: 48, testDate: "2026-06-01" }),
    ])
    expect(s.tests[0].previousDate).toBe("2026-01-01")
    const first = buildReportScores([pt({ testType: "cmj", resultValue: 40, testDate: "2026-01-01" })])
    expect(first.tests[0].previousDate).toBeNull()
  })

  it("exposes Elite/Trained targets in the test's own units", () => {
    // cmj range 25-65, higher-is-better: trained = midpoint 45, elite = 65.
    const s = buildReportScores([pt({ testType: "cmj", resultValue: 45, testDate: "2026-06-01" })])
    expect(s.tests[0].targets).toEqual({ elite: 65, trained: 45, relativeToBodyWeight: false, direction: "higher" })
  })

  it("converts body-weight-relative targets to absolute units, and refuses without body weight", () => {
    // back_squat_1rm range 0.5-2.5 x BW: at 100kg, trained 1.5x = 150, elite 2.5x = 250.
    const withBw = buildReportScores([
      pt({ testType: "back_squat_1rm", resultValue: 150, resultUnit: "kg", bodyWeightKg: 100, testDate: "2026-06-01" }),
    ])
    expect(withBw.tests[0].targets).toMatchObject({ elite: 250, trained: 150, relativeToBodyWeight: true })
    const withoutBw = buildReportScores([
      pt({ testType: "back_squat_1rm", resultValue: 150, resultUnit: "kg", testDate: "2026-06-01" }),
    ])
    expect(withoutBw.tests[0].targets).toBeNull()
  })

  it("never gives a custom test targets", () => {
    const s = buildReportScores([
      pt({ testType: "custom", customName: "Sled Push", resultValue: 6, resultUnit: "s", testDate: "2026-06-01" }),
    ])
    expect(s.tests[0].targets).toBeNull()
    expect(s.tests[0].previousDate).toBeNull()
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run __tests__/lib/test-report/scoring.test.ts`
Expected: the four new tests FAIL (`previousDate`/`targets` are `undefined`); all existing tests PASS.

- [ ] **Step 3: Implement.** In `lib/test-report/scoring.ts`:

Line 1 import — add `referenceTargets` and the type:

```ts
import {
  normalize,
  referenceTargets,
  testDirection,
  RADAR_CATEGORIES,
  type RadarCategory,
  type ReferenceTargets,
} from "@/lib/coach-intel/test-normalization"
```

In `interface ScoredTest`, after `previous` (line ~59):

```ts
  /** Date of the result behind `previous`. null on a first test. */
  previousDate: string | null
  /** Elite/Trained standards in the test's own units — the same ranges that drive
      `score`, so the two cannot disagree. null = custom, a type with no reference
      range, or a body-weight-relative test with no body weight. */
  targets: ReferenceTargets | null
```

In `buildReportScores`, inside `tests.push({ … })` after `previous:` (line ~183):

```ts
      previousDate: sorted.length > 1 ? sorted[sorted.length - 2].testDate : null,
      targets: latest.testType === "custom" ? null : referenceTargets(latest.testType, latest.bodyWeightKg),
```

- [ ] **Step 4: Fix the now-incomplete `ScoredTest` fixtures** in `__tests__/components/report/report-page-two.test.tsx` (they are typed literals — `tsc` fails without this; runtime vitest does not typecheck, so the suite alone won't catch it):
  - `cmj` (line ~23): add `previousDate: "2026-03-01",` and `targets: { elite: 65, trained: 45, relativeToBodyWeight: false, direction: "higher" },`
  - `sledPush` (~37): add `previousDate: null,` and `targets: null,`
  - `sprint` (~51, sprint_40m range 4.5-7.0 lower-is-better): add `previousDate: "2026-04-01",` and `targets: { elite: 4.5, trained: 5.75, relativeToBodyWeight: false, direction: "lower" },`
  - `flat` (~87, beep_test range 5-14): add `previousDate: "2026-05-01",` and `targets: { elite: 14, trained: 9.5, relativeToBodyWeight: false, direction: "higher" },` and change `points: [11, 11]` → `points: [11, 11, 11]` (three flat points — Task 3's sparkline-suppression test needs a ≥3-point flat series).

- [ ] **Step 5: Sweep for other `ScoredTest`/`ReportScores` literal constructors**

Run: `npx vitest related` is not configured — instead grep: `rg -l "ScoredTest" __tests__ components lib app`
Expected consumers that BUILD literals: only `report-page-two.test.tsx` (fixed in Step 4). `__tests__/components/report/report-preview.test.tsx` and `test-report.test.tsx` — open each hit and add the two fields to any object literal typed as `ScoredTest`. Files that only READ the type need nothing.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run __tests__/lib/test-report/scoring.test.ts __tests__/components/report/report-page-two.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit 2>&1 | grep -E "test-report|components/report|components/public" || echo CLEAN`
Expected: `CLEAN` (pre-existing unrelated errors elsewhere are out of scope).

- [ ] **Step 7: Commit**

```bash
git add lib/test-report/scoring.ts __tests__/lib/test-report/scoring.test.ts __tests__/components/report/report-page-two.test.tsx
# plus any fixture files updated in Step 5, explicitly
git commit -m "feat(report): ScoredTest carries previousDate + Elite/Trained targets

Additive scoring fields for the metric-visual refinement: dated deltas and
real-unit norms both read straight off the same ranges that make the score.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: ScoreTrack v2 — zones in, fill out (component + CSS, screen + print)

**Files:**
- Modify: `components/public/report/panels/ScoreTrack.tsx` (whole file, 27 lines)
- Modify: `app/globals.css` — screen rules ~lines 637-680, print rules ~lines 724-774
- Test: `__tests__/components/report/score-track.test.tsx`, `__tests__/app/score-track-styles.test.ts`

**Interfaces:**
- Consumes: `BAND_DEVELOPING_MIN`, `BAND_STRENGTH_MIN`, `BAND_LABELS`, `bandFor` from `@/lib/test-report/scoring`.
- Produces: same component signature `ScoreTrack({ score, tone? })` — callers unchanged. DOM contract: `.score-track` contains `.score-track-zone-low`, `.score-track-zone-high`, `.score-track-tick`, `.score-track-dot`; NO `.score-track-fill` anywhere (Tasks 3-4 tests and the styles test rely on this).

- [ ] **Step 1: Write the failing component tests** — in `__tests__/components/report/score-track.test.tsx`, add `import { BAND_DEVELOPING_MIN, BAND_STRENGTH_MIN } from "@/lib/test-report/scoring"` and append:

```tsx
  it("paints the priority and strength zones from the band constants, not restated numbers", () => {
    const { container } = render(<ScoreTrack score={58} />)
    const low = container.querySelector(".score-track-zone-low") as HTMLElement
    const high = container.querySelector(".score-track-zone-high") as HTMLElement
    expect(low.style.width).toBe(`${BAND_DEVELOPING_MIN}%`)
    expect(high.style.left).toBe(`${BAND_STRENGTH_MIN}%`)
  })

  it("tells screen readers which band the score lands in", () => {
    render(<ScoreTrack score={72} />)
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/72 out of 100 — Strength/)
  })

  it("no longer renders a fill bar — zones and the dot carry the score", () => {
    const { container } = render(<ScoreTrack score={58} />)
    expect(container.querySelector(".score-track-fill")).toBeNull()
  })
```

- [ ] **Step 2: Update the styles test** — in `__tests__/app/score-track-styles.test.ts` replace the body of `it("rebuilds the bar from BORDERS for print, …")` with:

```ts
    const print = printBlockContaining(".score-track")
    expect(print).toMatch(/\.score-track\s*{[^}]*border-bottom:\s*8px solid var\(--border\)/)
    expect(print).toMatch(/\.score-track-zone-low\s*{[^}]*border-bottom:\s*8px solid color-mix\(in oklab, var\(--error\)/)
    expect(print).toMatch(/\.score-track-zone-high\s*{[^}]*border-bottom:\s*8px solid color-mix\(in oklab, var\(--success\)/)
    expect(print).toMatch(/\.score-track-tick\s*{[^}]*border-left:\s*1px solid/)
    expect(print).toMatch(/\[data-tone="accent"\]\s+\.score-track-dot\s*{[^}]*border-color:\s*var\(--accent\)/)
```

and add one new test to the same describe:

```ts
  it("has fully removed the fill bar — a stale rule would repaint it in one medium only", () => {
    expect(css).not.toMatch(/score-track-fill/)
  })
```

Note: `allScoreTrackBlocks()` matches any selector containing `score-track`, so the zone blocks are automatically swept into the existing no-hex and both-scopes-token tests — `color-mix(in oklab, var(--error) …)` contains `var(--error)`, and both `--error` and `--success` are already declared in both scopes (report-print-styles.test.ts lines 116-136 prove it). No change needed to those two tests.

- [ ] **Step 3: Run to verify failures**

Run: `npx vitest run __tests__/components/report/score-track.test.tsx __tests__/app/score-track-styles.test.ts`
Expected: the three new component tests FAIL (no zone elements), the rewritten print test FAILS (no zone print rules), the no-fill test FAILS (fill rules exist). Existing aria/clamp/tone tests PASS.

- [ ] **Step 4: Rewrite `components/public/report/panels/ScoreTrack.tsx`:**

```tsx
import { BAND_DEVELOPING_MIN, BAND_LABELS, BAND_STRENGTH_MIN, bandFor } from "@/lib/test-report/scoring"

/**
 * The ONLY way a score is drawn in this report.
 *
 * The scale is not decoration — it is the definition. `normalize()` maps a result
 * linearly from the bottom of its reference range to the top, so the left edge is
 * the range floor, the midpoint tick is Trained, and the right edge is Elite.
 * The zones are the band cut-points made visible — red below the developing
 * threshold, green from the strength threshold up — imported from the same
 * constants `bandFor()` judges with, so the picture and the pill cannot disagree.
 *
 * Replaces KpiTile, ScoreBar, RangeBar, MetricCompare and CategoryChips, which
 * between them drew the same quantity five different ways.
 */
export function ScoreTrack({ score, tone = "primary" }: { score: number; tone?: "primary" | "accent" }) {
  const pct = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0
  return (
    <div
      className="score-track"
      data-tone={tone}
      role="img"
      aria-label={`Scores ${pct} out of 100 — ${BAND_LABELS[bandFor(pct)]}. Trained is 50, Elite is 100.`}
    >
      <span className="score-track-zone-low" style={{ width: `${BAND_DEVELOPING_MIN}%` }} aria-hidden />
      <span className="score-track-zone-high" style={{ left: `${BAND_STRENGTH_MIN}%` }} aria-hidden />
      <span className="score-track-tick" aria-hidden />
      <span className="score-track-dot" style={{ left: `${pct}%` }} />
    </div>
  )
}
```

- [ ] **Step 5: CSS — screen.** In `app/globals.css`, DELETE the `.test-report .score-track-fill` block (lines ~646-651) and the `.test-report .score-track[data-tone="accent"] .score-track-fill` block (~674-676), and insert in the fill block's place (still inside the `.score-track` → `.report-band` slice):

```css
/* Band zones — the cut-points from lib/test-report/scoring made visible. Widths
   arrive inline from the SAME constants bandFor() uses; the neutral middle is
   the rail showing through. 22% tint: judgment, quietly. */
.test-report .score-track-zone-low {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  border-radius: 999px 0 0 999px;
  background: color-mix(in oklab, var(--error) 22%, transparent);
}

.test-report .score-track-zone-high {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  border-radius: 0 999px 999px 0;
  background: color-mix(in oklab, var(--success) 22%, transparent);
}
```

- [ ] **Step 6: CSS — print.** In the `@media print` block (~724-774): DELETE the `.test-report .score-track-fill` rule and the `[data-tone="accent"] .score-track-fill` rule; keep the `.score-track` rail, tick and dot rules exactly as they are; add after the rail rule:

```css
  /* Zones collapse the same way the rail does: zero height, the color as an 8px
     bottom border. 45% mix, not the screen's 22% — alpha washes out on paper. */
  .test-report .score-track-zone-low,
  .test-report .score-track-zone-high {
    background: transparent !important;
    height: 0 !important;
    top: 0 !important;
    bottom: auto !important;
  }

  .test-report .score-track-zone-low {
    border-bottom: 8px solid color-mix(in oklab, var(--error) 45%, transparent) !important;
  }

  .test-report .score-track-zone-high {
    border-bottom: 8px solid color-mix(in oklab, var(--success) 45%, transparent) !important;
  }
```

- [ ] **Step 7: Run to verify green**

Run: `npx vitest run __tests__/components/report/score-track.test.tsx __tests__/app/score-track-styles.test.ts __tests__/app/report-print-styles.test.ts`
Expected: all PASS (report-print-styles included — it slices the same print block).

- [ ] **Step 8: Commit**

```bash
git add components/public/report/panels/ScoreTrack.tsx app/globals.css __tests__/components/report/score-track.test.tsx __tests__/app/score-track-styles.test.ts
git commit -m "feat(report): ScoreTrack draws the band zones and drops the fill

Red below Developing, green from Strength up, straight from the bandFor()
constants. Zones are border-drawn in print at a stronger mix. aria-label
now names the band.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: TestRow v2 — real-unit norms, band pill, dated delta, honest sparkline

**Files:**
- Modify: `components/public/report/panels/TestRow.tsx` (whole file, 62 lines)
- Modify: `components/public/report/panels/BandPill.tsx` (add a `band-pill` hook class)
- Modify: `components/public/report/ReportPageTwo.tsx` (intro copy, lines 59-62)
- Modify: `app/globals.css` (print rule for the pill, inside the big `@media print` block)
- Test: `__tests__/components/report/report-page-two.test.tsx`, `__tests__/app/report-print-styles.test.ts`

**Interfaces:**
- Consumes: `test.targets` / `test.previousDate` (Task 1), `bandFor` + `BAND_LABELS` via `BandPill`, `formatDate` from `@/lib/test-report/format`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Update the flat-delta test and add the new page-two tests.** In `__tests__/components/report/report-page-two.test.tsx`, REPLACE the `it("never calls a flat test an improvement, …")` body with:

```tsx
    // deltaPct === 0 used to render "= 0%"; the word is calmer and matches page 1's
    // "held steady". Still never an arrow, never success-green.
    const { container } = render(<ReportPageTwo scores={scores([flat])} assessments={[]} />)
    const delta = [...container.querySelectorAll("p")].find((p) => /steady/i.test(p.textContent ?? ""))
    expect(delta, "no steady cell rendered").toBeTruthy()
    expect(delta!.textContent).not.toContain("↑")
    expect(delta!.textContent).not.toContain("%")
    expect(delta!.className, "a flat test must not be coloured as a success").not.toContain("--success")
    expect(delta!.className).toContain("text-muted-foreground")
```

(rename it to `"renders a flat test as steady, never as an increase"`) and append:

```tsx
  it("prints the norm in the test's own units under the track", () => {
    render(<ReportPageTwo scores={scores([cmj])} assessments={[]} />)
    expect(screen.getByText(/Trained 45 cm · Elite 65 cm/)).toBeInTheDocument()
  })

  it("pills each scorable row with the band the score actually lands in", () => {
    // cmj fixture score is 72 — at/above BAND_STRENGTH_MIN, so the pill must say Strength.
    render(<ReportPageTwo scores={scores([cmj])} assessments={[]} />)
    expect(screen.getByText("Strength")).toBeInTheDocument()
  })

  it("dates the delta so the change has a time period", () => {
    render(<ReportPageTwo scores={scores([cmj])} assessments={[]} />)
    expect(screen.getByText(/since 1 Mar 2026/)).toBeInTheDocument()
  })

  it("gives an unscorable custom test no norm caption and no pill", () => {
    const { container } = render(<ReportPageTwo scores={scores([sledPush])} assessments={[]} />)
    // The band intro copy legitimately says "Trained"; a NUMERIC target line is
    // what must not render for a test with no standard.
    expect(container.textContent ?? "").not.toMatch(/Trained \d/)
    expect(container.textContent ?? "").not.toMatch(/Strength|Developing|Priority/)
    expect(screen.getByText("No standard for this test")).toBeInTheDocument()
  })

  it("suppresses the sparkline for flat and two-point series, keeps it for a moving one", () => {
    // flat: three identical points — a line, but not a trend. sledPush: two points.
    const { container: flatC } = render(<ReportPageTwo scores={scores([flat])} assessments={[]} />)
    expect(flatC.querySelector("svg"), "a flat series must not draw a trend line").toBeNull()
    const { container: shortC } = render(<ReportPageTwo scores={scores([sledPush])} assessments={[]} />)
    expect(shortC.querySelector("svg"), "two points are not a trend").toBeNull()
    const { container: moving } = render(<ReportPageTwo scores={scores([cmj])} assessments={[]} />)
    expect(moving.querySelector("svg"), "a real trend must still draw").toBeTruthy()
  })
```

- [ ] **Step 2: Add the pill print-rule assertion** to `__tests__/app/report-print-styles.test.ts` (new test in the `report banding` describe):

```ts
  it("gives the band pill a border in print, because its tinted background vanishes", () => {
    const print = printBlockContaining(".band-pill")
    expect(print).toMatch(/\.band-pill\s*{[^}]*border:\s*1px solid currentColor/)
  })
```

- [ ] **Step 3: Run to verify failures**

Run: `npx vitest run __tests__/components/report/report-page-two.test.tsx __tests__/app/report-print-styles.test.ts`
Expected: every test added/changed in Steps 1-2 FAILS; the rest PASS.

- [ ] **Step 4: Implement.**

`components/public/report/panels/BandPill.tsx` — add the hook class (first class in the string):

```tsx
    <span className={`band-pill inline-flex rounded px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${TONE[band]}`}>
```

`app/globals.css` — inside the big `@media print` block (after the score-track zone rules from Task 2):

```css
  /* The pill's 15% background tint is gone with backgrounds off; a hairline in
     its own ink keeps it reading as a pill rather than a floating word. */
  .test-report .band-pill {
    border: 1px solid currentColor;
  }
```

`components/public/report/ReportPageTwo.tsx` lines 59-62, replace the intro sentence:

```tsx
        <p className="report-band-quiet mt-2 max-w-[52ch] text-sm opacity-80">
          {tests.length} {tests.length === 1 ? "test" : "tests"}, each measured the same way every time. Every bar
          is one scale — the tick is Trained, the right edge is Elite; the red zone is a priority, the green zone
          a strength.
        </p>
```

`components/public/report/panels/TestRow.tsx` — full replacement:

```tsx
import type { ScoredTest } from "@/lib/test-report/scoring"
import { bandFor } from "@/lib/test-report/scoring"
import { num, formatDate } from "@/lib/test-report/format"
import { ScoreTrack } from "./ScoreTrack"
import { BandPill } from "./BandPill"
import { Sparkline } from "@/components/shared/Sparkline"

/**
 * One test, once. The old page rendered the top four as circles and then ALL of
 * them again as cards; this is the single row that replaced both.
 *
 * The sparkline is the one deliberate second idiom in the report: a trend encodes
 * history, which the score track cannot show. It only renders when there IS a
 * trend — three or more results that actually moved. A flat line dressed up as
 * signal is exactly what the coach asked to remove.
 */
export function TestRow({ test, highlight = false }: { test: ScoredTest; highlight?: boolean }) {
  // Three-way on the SIGN, not `>= 0`. A test that did not move is not an
  // improvement: `deltaPct === 0` was rendering "↑ 0%" in success green here while
  // page 1 correctly called the same number "held steady".
  const delta = test.deltaPct
  const deltaTone =
    delta === null || delta === 0
      ? "text-muted-foreground"
      : delta > 0
        ? "text-[var(--success)]"
        : "text-[var(--error)]"
  // Zero movement is a word, not an arrow — "steady" matches page 1's phrasing.
  const deltaText = delta === null ? "—" : delta === 0 ? "steady" : `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta)}%`
  const showSparkline = test.points.length >= 3 && Math.min(...test.points) !== Math.max(...test.points)

  return (
    <div className="grid grid-cols-2 items-center gap-x-4 gap-y-2 border-b border-border py-3 last:border-b-0 md:grid-cols-[13rem_7rem_1fr_5rem_4rem]">
      <div>
        <p className="font-heading text-sm font-bold">
          {test.label}
          {test.isPr && (
            <span className="ml-2 rounded-full border border-accent px-1.5 py-0.5 align-[0.15em] font-mono text-[9px] uppercase tracking-wider text-accent">
              PR
            </span>
          )}
        </p>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {formatDate(test.latestDate)}
        </p>
      </div>

      <p className="font-heading text-lg font-bold">
        {num(test.latest)}
        <span className="ml-1 text-xs font-normal text-muted-foreground">{test.unit}</span>
      </p>

      <div className="col-span-2 md:col-span-1">
        {test.score !== null ? (
          <>
            <ScoreTrack score={test.score} tone={highlight ? "accent" : "primary"} />
            {test.targets && (
              // NOT uppercase: "cm" and "kg" are units, and "CM" is a different claim.
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] tracking-wide text-muted-foreground">
                  Trained {num(test.targets.trained)} {test.unit} · Elite {num(test.targets.elite)} {test.unit}
                </p>
                <BandPill band={bandFor(test.score)} />
              </div>
            )}
          </>
        ) : (
          <p className="font-mono text-[10px] uppercase text-muted-foreground">No standard for this test</p>
        )}
      </div>

      <div className="text-right">
        <p className={`font-mono text-xs ${deltaTone}`}>{deltaText}</p>
        {delta !== null && test.previousDate && (
          <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">since {formatDate(test.previousDate)}</p>
        )}
      </div>

      <div className="justify-self-end text-primary">{showSparkline && <Sparkline points={test.points} />}</div>
    </div>
  )
}
```

- [ ] **Step 5: Run to verify green**

Run: `npx vitest run __tests__/components/report/report-page-two.test.tsx __tests__/app/report-print-styles.test.ts __tests__/app/score-track-styles.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add components/public/report/panels/TestRow.tsx components/public/report/panels/BandPill.tsx components/public/report/ReportPageTwo.tsx app/globals.css __tests__/components/report/report-page-two.test.tsx __tests__/app/report-print-styles.test.ts
git commit -m "feat(report): test rows carry their reference — units, band pill, dated delta

Trained/Elite in the test's own units under every track, a band pill that
agrees with bandFor by construction, 'since <date>' on the delta, 'steady'
instead of '= 0%', and no sparkline unless three-plus results actually moved.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: MoverCompare — the circle returns, once

**Files:**
- Create: `components/public/report/panels/MoverCompare.tsx`
- Modify: `components/public/report/ReportPageOne.tsx` (mover panel, lines ~124-132; imports line 4-7)
- Test: `__tests__/components/report/report-page-one.test.tsx`

**Interfaces:**
- Consumes: `BiggestMover` from `@/lib/test-report/scoring` (whose `test` narrows `deltaPct`/`previous` to non-null), `test.targets` + `test.previousDate` (Task 1), `num`/`formatDate` from `@/lib/test-report/format`.
- Produces: `MoverCompare({ mover: BiggestMover })` — used only by `ReportPageOne`.

- [ ] **Step 1: Write the failing tests** — append to `__tests__/components/report/report-page-one.test.tsx`:

```tsx
  it("draws the mover as a Now-vs-standards circle group, not a bar", () => {
    const rich: TestReportData = {
      ...base,
      tests: [
        { testType: "cmj", resultValue: 40, resultUnit: "cm", customName: null, bodyWeightKg: 78, testDate: "2026-01-01", isPr: false },
        { testType: "cmj", resultValue: 48, resultUnit: "cm", customName: null, bodyWeightKg: 78, testDate: "2026-06-01", isPr: true },
        { testType: "sit_reach", resultValue: 12, resultUnit: "cm", customName: null, bodyWeightKg: null, testDate: "2026-06-01", isPr: false },
      ],
    }
    const scores = buildReportScores(rich.tests)
    expect(scores.biggestMover?.test.key, "fixture must make cmj the mover").toBe("cmj")

    const { container } = render(<ReportPageOne data={rich} scores={scores} />)
    // The circle: now, prev, and both standards in the test's own units.
    expect(screen.getByText("Now")).toBeInTheDocument()
    expect(screen.getByText(/Prev 40/)).toBeInTheDocument()
    expect(screen.getByText("Trained")).toBeInTheDocument()
    expect(screen.getByText("Elite")).toBeInTheDocument()
    expect(screen.getByText("45")).toBeInTheDocument() // cmj trained standard
    expect(screen.getByText("65")).toBeInTheDocument() // cmj elite standard
    // The time period, on the hero itself.
    expect(screen.getByText(/1 Jan 2026 → 1 Jun 2026/)).toBeInTheDocument()
    // The old raw-values line is gone (the circle carries both numbers now)…
    expect(screen.queryByText(/40 → 48/)).not.toBeInTheDocument()
    // …and no track in the mover panel: every remaining track is primary-toned.
    for (const t of container.querySelectorAll(".score-track")) {
      expect(t.getAttribute("data-tone")).not.toBe("accent")
    }
  })

  it("renders the mover circle without satellites when targets are unknowable", () => {
    // A 1RM with no body weight: delta exists (raw kg), targets do not.
    const noBw: TestReportData = {
      ...base,
      tests: [
        { testType: "back_squat_1rm", resultValue: 100, resultUnit: "kg", customName: null, bodyWeightKg: null, testDate: "2026-01-01", isPr: false },
        { testType: "back_squat_1rm", resultValue: 120, resultUnit: "kg", customName: null, bodyWeightKg: null, testDate: "2026-06-01", isPr: false },
      ],
    }
    const scores = buildReportScores(noBw.tests)
    expect(scores.biggestMover, "fixture must still produce a mover").not.toBeNull()
    expect(scores.biggestMover!.test.targets).toBeNull()

    render(<ReportPageOne data={noBw} scores={scores} />)
    expect(screen.getByText("Now")).toBeInTheDocument()
    expect(screen.queryByText("Trained")).not.toBeInTheDocument()
    expect(screen.queryByText("Elite")).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run __tests__/components/report/report-page-one.test.tsx`
Expected: both new tests FAIL (no "Now" text); all existing tests PASS.

- [ ] **Step 3: Create `components/public/report/panels/MoverCompare.tsx`:**

```tsx
import type { BiggestMover } from "@/lib/test-report/scoring"
import { num } from "@/lib/test-report/format"

/**
 * The comparison moment, used exactly once — page 1's biggest mover.
 *
 * "Where you are vs where you were vs the standards" is a different kind of
 * information than "position on a scale", so it earns a second idiom the way the
 * sparkline does. Everything is border-drawn: the original MetricCompare filled
 * the Now circle with bg-primary, which Chrome's backgrounds-off print erased
 * along with the value inside it.
 *
 * Labels are Trained/Elite, never "professional average", never a percentile —
 * DJP coaching reference points, not population data.
 */
export function MoverCompare({ mover }: { mover: BiggestMover }) {
  const { test } = mover
  return (
    <div className="flex items-center gap-5">
      <div className="relative flex size-[104px] shrink-0 flex-col items-center justify-center rounded-full border-[3px] border-accent bg-card">
        <span className="font-mono text-[9px] uppercase text-muted-foreground">Prev {num(test.previous)}</span>
        <span className="font-heading text-2xl font-bold leading-none">
          {num(test.latest)}
          <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">{test.unit}</span>
        </span>
        <span className="font-mono text-[9px] uppercase text-muted-foreground">Now</span>
        {test.isPr && (
          <span className="absolute -top-1 right-0 rounded-full border border-accent bg-card px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-accent">
            PR
          </span>
        )}
      </div>
      {test.targets && (
        <div className="flex gap-3">
          <Standard value={num(test.targets.trained)} unit={test.unit} caption="Trained" />
          <Standard value={num(test.targets.elite)} unit={test.unit} caption="Elite" />
        </div>
      )}
    </div>
  )
}

function Standard({ value, unit, caption }: { value: string; unit: string; caption: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex size-[56px] flex-col items-center justify-center rounded-full border border-border">
        <span className="font-heading text-sm font-bold leading-none">{value}</span>
        <span className="mt-0.5 font-mono text-[8px] text-muted-foreground">{unit}</span>
      </div>
      <span className="mt-1 font-mono text-[8px] uppercase tracking-wide text-muted-foreground">{caption}</span>
    </div>
  )
}
```

- [ ] **Step 4: Integrate in `ReportPageOne.tsx`.** Replace lines ~125-132 (the `previous → latest` mono `<p>` AND the `score !== null && <ScoreTrack tone="accent">` block) with:

```tsx
                {biggestMover.test.previousDate && (
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {formatDate(biggestMover.test.previousDate)} → {formatDate(biggestMover.test.latestDate)}
                  </p>
                )}
                <div className="mt-4">
                  <MoverCompare mover={biggestMover} />
                </div>
```

Imports: add `import { MoverCompare } from "./panels/MoverCompare"`; then check `num` — it was only used by the deleted line, so remove it from the `format` import if nothing else on the page uses it (`formatDate` stays).

- [ ] **Step 5: Run to verify green**

Run: `npx vitest run __tests__/components/report/report-page-one.test.tsx __tests__/components/report/test-report.test.tsx __tests__/components/report/report-preview.test.tsx`
Expected: all PASS (the two extra suites render the full report and must not be broken by the panel swap).

- [ ] **Step 6: Commit**

```bash
git add components/public/report/panels/MoverCompare.tsx components/public/report/ReportPageOne.tsx __tests__/components/report/report-page-one.test.tsx
git commit -m "feat(report): biggest mover renders as the comparison circle again

Now/Prev in one border-drawn accent circle, Trained/Elite satellites in the
test's own units, dated span on the hero. The one-day-lived MetricCompare
idea, rebuilt to survive backgrounds-off print.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Verification gate

**Files:** none new.

- [ ] **Step 1: Full targeted sweep**

Run: `npx vitest run __tests__/lib/test-report/ __tests__/components/report/ __tests__/app/score-track-styles.test.ts __tests__/app/report-print-styles.test.ts __tests__/app/athlete-report-route.test.ts`
Expected: PASS across the board.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "report|scoring|ScoreTrack|TestRow|MoverCompare|BandPill" || echo CLEAN`
Expected: `CLEAN`. (Repo has known unrelated noise; only our files gate.)

- [ ] **Step 3: Production build** (deploy gate — tsc green ≠ build green)

Run: `npm run build` and grep output for `report|scoring` errors.
Expected: build succeeds. If "Cannot find module" fires on the NEW MoverCompare file with a green tsc, delete stale `.tsbuildinfo` first (known trap).

- [ ] **Step 4: Browser print verification** (real Chromium via Playwright MCP against `npm run dev`)

Check, on a real client's report: light + dark, backgrounds ON and OFF (emulate `print` media and screenshot): zones visible in all four, pill legible, circle intact, dot centred, page 2 still paginates. The pre-existing dark+backgrounds-off whole-page issue is out of scope — verify only that the NEW elements degrade no worse than their surroundings.

---

## Self-review notes

- Spec §3.1-3.5 → Tasks 2, 3, 4, 1, 3 respectively; §5 test list is distributed into each task; §4 constraints are the Global Constraints block. No gaps found.
- Type check: `ScoredTest.previousDate`/`targets` (Task 1) are exactly what Tasks 3-4 read; `MoverCompare({ mover: BiggestMover })` matches the Task 4 call site; `BandPill({ band })` unchanged.
- The page-two fixture `flat.points` change ([11,11] → [11,11,11]) happens in Task 1 but is exercised in Task 3 — flagged in both tasks so neither implementer is surprised.
