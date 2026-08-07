# Test Report Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public `/athlete/<token>` test report as two banded pages following Darren's spine — biggest mover, focal points, full verdict — with one score idiom replacing seven.

**Architecture:** Presentation-only. `getTestReportData()` and the DB layer are untouched. `lib/test-report/scoring.ts` gains `focalPoints` and a polarity-aware `biggestMover`; `cues.ts` keeps its 5×3 matrix with all 15 strings rewritten to one sentence. Every score renders through one new `ScoreTrack` component whose scale (range floor → Trained at 50 → Elite at 100) *is* the explanation of how the score is computed. Section banding uses existing design tokens only, so it works in both theme scopes with no per-scope declarations.

**Tech Stack:** Next.js 16 App Router (RSC), React 19, TypeScript strict, Tailwind CSS v4 (`@theme inline` in `app/globals.css`, no config file), Vitest + Testing Library.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-07-test-report-restructure-design.md`. Read it before Task 1.
- **No migration, no new DB columns, no new queries.** If a task seems to need one, stop and flag it.
- **Out of scope:** coach commentary (Spec B), limb-vs-limb (Spec C), editable reference ranges (Spec D). Reserve the coach-note slot; do not build the field.
- **Colors:** semantic tokens only (`var(--primary)`, `text-muted-foreground`, `bg-surface`). Never a hex literal. Never a new color.
- **Fonts:** `font-heading` / `font-body` / `font-mono` classes only. Never an inline `fontFamily`.
- **The word "percentile" must never render.** No population data exists behind any number.
- **Elite / Trained** are the only two standard labels. Never "professional average", never a percentile.
- **Audience is the athlete.** No coach-diagnostic content. Do not touch `components/admin/arena/**`.
- **Two `SectionHeading.tsx` files exist.** Delete `components/public/report/panels/SectionHeading.tsx`. **Never** touch `components/admin/arena/SectionHeading.tsx`.
- **Commits:** stage explicit paths. **Never `git add -A`** — this working tree permanently contains untracked bank CSVs.
- **Tests:** `npx vitest run <path>` for targeted runs. Do not run the full suite.
- Work directly on `main`. No branches.

## One deliberate deviation from the spec

The spec's component table lists `ReportMasthead`, `IndexBlock`, `MoverBlock`,
`CoachNoteSlot` and `AssessmentBatteries` as separate files. This plan **inlines them**
into `ReportPageOne` / `ReportPageTwo` and extracts only `FocalPointCard`, `TestRow`
and `ScoreTrack`.

Reason: the inlined blocks each have exactly one caller, take no props beyond what the
page already holds, and have no independent test. Splitting them would add five files
of indirection to make two ~150-line page components into two ~40-line ones plus five
stubs. `FocalPointCard`, `TestRow` and `ScoreTrack` are extracted because they are
genuinely repeated — twice, N times, and everywhere respectively.

Flagging it because it contradicts a written spec: if a reviewer disagrees, splitting
them afterwards is mechanical.

---

### Task 1: `focalPoints` replaces `focus` in scoring

**Files:**
- Modify: `lib/test-report/scoring.ts`
- Test: `__tests__/lib/test-report/scoring.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `FocalPoint` interface; `ReportScores.focalPoints: FocalPoint[]`; `ReportScores.focus` is **removed**. `ReportScores.strongest` and all other fields keep their current shape.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/lib/test-report/scoring.test.ts` inside the existing `describe("buildReportScores", …)`:

```ts
  it("names no focal point when only one category is scorable", () => {
    // One category means there is nothing to focus RELATIVE to — and the single
    // category is also the strongest, which must never be a focal point.
    const s = buildReportScores([pt({ testType: "cmj", resultValue: 45, testDate: "2026-06-01" })])
    expect(s.categories).toHaveLength(1)
    expect(s.focalPoints).toEqual([])
  })

  it("names one focal point when two categories are scorable, never the stronger", () => {
    const s = buildReportScores([
      // Power: cmj 65 = top of the 25-65 range = 100.
      pt({ testType: "cmj", resultValue: 65, testDate: "2026-06-01" }),
      // Mobility: sit_reach 10 of 0-40 = 25.
      pt({ testType: "sit_reach", resultValue: 10, testDate: "2026-06-01" }),
    ])
    expect(s.focalPoints).toHaveLength(1)
    expect(s.focalPoints[0].category).toBe("Mobility")
  })

  it("names the two lowest categories, lowest first, when three or more are scorable", () => {
    const s = buildReportScores([
      pt({ testType: "cmj", resultValue: 65, testDate: "2026-06-01" }), // Power 100
      pt({ testType: "beep_test", resultValue: 11, testDate: "2026-06-01" }), // Endurance 67
      pt({ testType: "sit_reach", resultValue: 10, testDate: "2026-06-01" }), // Mobility 25
      pt({ testType: "sprint_10m", resultValue: 2.0, resultUnit: "s", testDate: "2026-06-01" }), // Speed 50
    ])
    expect(s.focalPoints.map((f) => f.category)).toEqual(["Mobility", "Speed"])
    expect(s.focalPoints[0].score).toBeLessThan(s.focalPoints[1].score)
  })

  it("blames the lowest-scoring test in the category, not just any member", () => {
    const s = buildReportScores([
      pt({ testType: "cmj", resultValue: 65, testDate: "2026-06-01" }), // Power 100
      // Strength: pull_up_max 20 of 0-25 = 80; push_up_max 15 of 10-80 = 7.
      pt({ testType: "pull_up_max", resultValue: 20, resultUnit: "reps", testDate: "2026-06-01" }),
      pt({ testType: "push_up_max", resultValue: 15, resultUnit: "reps", testDate: "2026-06-01" }),
    ])
    const strength = s.focalPoints.find((f) => f.category === "Strength")
    expect(strength).toBeDefined()
    expect(strength!.culprit.label).toBe("Push-up Max")
    expect(strength!.culprit.score).toBe(7)
  })

  it("returns no focal points for no tests", () => {
    expect(buildReportScores([]).focalPoints).toEqual([])
  })
```

Then update the existing `"returns empty scores for no tests"` test: replace the line
`expect(s.focus).toBeNull()` with `expect(s.focalPoints).toEqual([])`.

The labels used above are verbatim from `TEST_TYPE_LABELS` in
`lib/validators/performance-test.ts`: `cmj` → `"Countermovement Jump"`,
`sprint_10m` → `"10m Sprint"`, `push_up_max` → `"Push-up Max"`,
`sit_reach` → `"Sit & Reach"`. Do not change any label.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/lib/test-report/scoring.test.ts`
Expected: FAIL — `focalPoints` does not exist on `ReportScores` (TS error) and the assertions error.

- [ ] **Step 3: Implement**

In `lib/test-report/scoring.ts`, add the interface after `CategoryScore`:

```ts
/**
 * A category worth training, plus the specific test dragging its average down.
 *
 * The abstract number ("Speed 54") is not actionable on its own — `culprit` is
 * what turns it into something the athlete can go and do.
 */
export interface FocalPoint {
  category: RadarCategory
  score: number
  band: Band
  culprit: ScoredTest
}
```

In `ReportScores`, delete `focus: CategoryScore | null` and add:

```ts
  /**
   * The categories to train next, lowest first. NEVER includes the top-ranked
   * category — labelling an athlete's best quality a "focal point" is wrong, and
   * it is exactly what a naive "take the last two" produces when there are only
   * two categories. Empty when fewer than two categories are scorable.
   */
  focalPoints: FocalPoint[]
```

Add this helper above `buildReportScores`:

```ts
/**
 * The weakest member of a category. Ties resolve to the most recently tested,
 * because `tests` is already sorted by date descending and `reduce` keeps the
 * incumbent on a tie — so the result is deterministic between renders.
 */
function lowestScoring(members: ScoredTest[]): ScoredTest {
  return members.reduce((low, t) => ((t.score as number) < (low.score as number) ? t : low))
}
```

Inside `buildReportScores`, the category loop must retain each category's members.
Replace the existing loop with:

```ts
  const categories: CategoryScore[] = []
  const membersByCategory = new Map<RadarCategory, ScoredTest[]>()
  for (const category of CATEGORY_ORDER) {
    const members = tests.filter((t) => t.score !== null && RADAR_CATEGORIES[category].includes(t.testType))
    if (members.length === 0) continue
    membersByCategory.set(category, members)
    const score = Math.round(members.reduce((sum, t) => sum + (t.score as number), 0) / members.length)
    categories.push({ category, score, band: bandFor(score), testLabels: members.map((t) => t.label) })
  }
  // Strongest first; CATEGORY_ORDER breaks ties because Array#sort is stable.
  categories.sort((a, b) => b.score - a.score)
```

Then, after the sort, add:

```ts
  // max(0, …) is load-bearing: `categories.length - 1` is -1 on an empty list, and
  // a negative count would make the slice below take from the wrong end.
  const focalCount = Math.max(0, Math.min(2, categories.length - 1))
  const focalPoints: FocalPoint[] = categories
    .slice(categories.length - focalCount)
    .reverse()
    .map((c) => ({
      category: c.category,
      score: c.score,
      band: c.band,
      culprit: lowestScoring(membersByCategory.get(c.category) as ScoredTest[]),
    }))
```

In the returned object, replace `focus: categories.length > 0 ? categories[categories.length - 1] : null,` with `focalPoints,`.

`slice(len - 0)` returns `[]` when `focalCount` is 0, so the empty case needs no branch.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/test-report/scoring.test.ts`
Expected: PASS. Other files still reference `focus` and will fail to compile — that is expected and is fixed in Tasks 3 and 7.

- [ ] **Step 5: Commit**

```bash
git add lib/test-report/scoring.ts __tests__/lib/test-report/scoring.test.ts
git commit -m "feat(test-report): focal points name the category AND the test dragging it"
```

---

### Task 2: `biggestMover` prefers improvement

**Files:**
- Modify: `lib/test-report/scoring.ts`
- Test: `__tests__/lib/test-report/scoring.test.ts`

**Interfaces:**
- Consumes: `ScoredTest` from Task 1's file (unchanged shape).
- Produces: `BiggestMover` interface; `ReportScores.biggestMover: BiggestMover | null`. The old shape `{ label, deltaPct }` is **replaced** — consumers now read `mover.test.label`, `mover.test.deltaPct`, `mover.test.previous`, `mover.test.latest`, `mover.test.unit`, and `mover.direction: "improved" | "flat" | "declined"`.

**`direction` is three-state on purpose.** A boolean cannot carry three outcomes: when
every test's change rounds to zero the mover is neither an improvement nor a decline,
and a page keying off `isDecline` would print "Biggest improvement" above "0%".

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/lib/test-report/scoring.test.ts`:

```ts
  it("picks the biggest IMPROVEMENT even when a decline is larger in magnitude", () => {
    const s = buildReportScores([
      // Mobility collapses 20 -> 10 = -50%.
      pt({ testType: "sit_reach", resultValue: 20, testDate: "2026-01-01" }),
      pt({ testType: "sit_reach", resultValue: 10, testDate: "2026-06-01" }),
      // Power improves 40 -> 48 = +20%.
      pt({ testType: "cmj", resultValue: 40, testDate: "2026-01-01" }),
      pt({ testType: "cmj", resultValue: 48, testDate: "2026-06-01" }),
    ])
    expect(s.biggestMover).not.toBeNull()
    expect(s.biggestMover!.test.label).toBe("Countermovement Jump")
    expect(s.biggestMover!.test.deltaPct).toBe(20)
    expect(s.biggestMover!.isDecline).toBe(false)
  })

  it("falls back to the largest decline when NOTHING improved, and says so", () => {
    const s = buildReportScores([
      pt({ testType: "sit_reach", resultValue: 20, testDate: "2026-01-01" }),
      pt({ testType: "sit_reach", resultValue: 18, testDate: "2026-06-01" }), // -10%
      pt({ testType: "cmj", resultValue: 50, testDate: "2026-01-01" }),
      pt({ testType: "cmj", resultValue: 40, testDate: "2026-06-01" }), // -20%
    ])
    expect(s.biggestMover!.test.label).toBe("Countermovement Jump")
    expect(s.biggestMover!.test.deltaPct).toBe(-20)
    expect(s.biggestMover!.isDecline).toBe(true)
  })

  it("carries the previous value so the report can print 'was -> now'", () => {
    const s = buildReportScores([
      pt({ testType: "cmj", resultValue: 40, testDate: "2026-01-01" }),
      pt({ testType: "cmj", resultValue: 48, testDate: "2026-06-01" }),
    ])
    expect(s.biggestMover!.test.previous).toBe(40)
    expect(s.biggestMover!.test.latest).toBe(48)
  })
```

Update the existing sprint test — replace
`expect(s.biggestMover).toEqual({ label: "10m Sprint", deltaPct: 10 })` with:

```ts
    expect(s.biggestMover!.test.label).toBe("10m Sprint")
    expect(s.biggestMover!.test.deltaPct).toBe(10)
    expect(s.biggestMover!.isDecline).toBe(false)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/lib/test-report/scoring.test.ts`
Expected: FAIL — `s.biggestMover.test` is undefined.

- [ ] **Step 3: Implement**

Add the interface after `FocalPoint` in `lib/test-report/scoring.ts`:

```ts
/**
 * The hero of page 1.
 *
 * Prefers the biggest IMPROVEMENT, so the page normally opens on something the
 * athlete did well. Falls back to the largest decline only when nothing improved
 * — a report that can only ever show good news is not worth trusting, and every
 * decline stays visible in the page-2 rows regardless.
 */
export interface BiggestMover {
  test: ScoredTest & { deltaPct: number; previous: number }
  /** True only when NO test improved and this is the worst of the declines. */
  isDecline: boolean
}
```

In `ReportScores`, change `biggestMover: { label: string; deltaPct: number } | null` to
`biggestMover: BiggestMover | null`.

Replace the existing `movers` / `biggest` block with:

```ts
  // deltaPct and previous are both non-null exactly when a test has >= 2 results,
  // so this predicate narrows both at once rather than asserting one from the other.
  const movers = tests.filter(
    (t): t is ScoredTest & { deltaPct: number; previous: number } => t.deltaPct !== null && t.previous !== null,
  )
  const improved = movers.filter((t) => t.deltaPct > 0)
  const pool = improved.length > 0 ? improved : movers
  const best = pool.reduce<(ScoredTest & { deltaPct: number; previous: number }) | null>(
    (b, t) => (b === null || Math.abs(t.deltaPct) > Math.abs(b.deltaPct) ? t : b),
    null,
  )
```

And in the return object: `biggestMover: best ? { test: best, isDecline: best.deltaPct < 0 } : null,`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/test-report/scoring.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add lib/test-report/scoring.ts __tests__/lib/test-report/scoring.test.ts
git commit -m "feat(test-report): the hero mover is the biggest improvement, declines only as fallback"
```

---

### Task 3: One-sentence cues keyed by focal point

**Files:**
- Modify: `lib/test-report/cues.ts`
- Test: `__tests__/lib/test-report/cues.test.ts`

**Interfaces:**
- Consumes: `FocalPoint`, `Band` from `lib/test-report/scoring.ts` (Task 1).
- Produces: `cueFor(fp: FocalPoint): string`. `selectCue` is **removed**. `CUES` keeps its `Record<RadarCategory, Record<Band, string>>` shape.

- [ ] **Step 1: Write the failing tests**

Replace the body of `__tests__/lib/test-report/cues.test.ts` with:

```ts
import { describe, it, expect } from "vitest"
import { CUES, cueFor } from "@/lib/test-report/cues"
import { CATEGORY_ORDER, type Band, type FocalPoint } from "@/lib/test-report/scoring"

const BANDS: Band[] = ["strength", "developing", "priority"]

function fp(over: Partial<FocalPoint> = {}): FocalPoint {
  return {
    category: "Speed",
    score: 30,
    band: "priority",
    culprit: {
      key: "sprint_10m",
      testType: "sprint_10m",
      label: "10m Sprint",
      latest: 2.1,
      unit: "s",
      latestDate: "2026-06-01",
      isPr: false,
      score: 30,
      deltaPct: null,
      previous: null,
      targets: null,
      points: [2.1],
    },
    ...over,
  }
}

describe("CUES", () => {
  it("covers every category and band", () => {
    for (const c of CATEGORY_ORDER) {
      for (const b of BANDS) {
        expect(CUES[c][b], `${c}/${b}`).toBeTruthy()
      }
    }
  })

  it("is one sentence per cue — the report has two focal points and no room for paragraphs", () => {
    for (const c of CATEGORY_ORDER) {
      for (const b of BANDS) {
        const cue = CUES[c][b].trim()
        // Counting terminators beats looking for ". Capital": a second sentence
        // starting with a digit, a lowercase word, or a quote mark is still a
        // second sentence, and a `[.!?]\s+[A-Z]` pattern lets all three through.
        const terminators = cue.match(/[.!?]/g) ?? []
        expect(terminators.length, `${c}/${b} has ${terminators.length} sentence terminators: ${cue}`).toBe(1)
        expect(/[.!?]$/.test(cue), `${c}/${b} does not end on its terminator: ${cue}`).toBe(true)
        expect(cue.length, `${c}/${b} is ${cue.length} chars`).toBeLessThanOrEqual(150)
      }
    }
  })

  it("never uses percentile language", () => {
    for (const c of CATEGORY_ORDER) {
      for (const b of BANDS) {
        expect(CUES[c][b].toLowerCase()).not.toContain("percentile")
      }
    }
  })
})

describe("cueFor", () => {
  it("selects on the focal point's category and band", () => {
    expect(cueFor(fp({ category: "Mobility", band: "priority" }))).toBe(CUES.Mobility.priority)
    expect(cueFor(fp({ category: "Strength", band: "developing" }))).toBe(CUES.Strength.developing)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/lib/test-report/cues.test.ts`
Expected: FAIL — `cueFor` is not exported, and the sentence-count assertion fails on the current 2–3 sentence strings.

- [ ] **Step 3: Implement**

In `lib/test-report/cues.ts`, rewrite all 15 strings to one sentence each, ≤150 chars.
Keep the tone rule in the file's doc comment ("candid but constructive… name the gap,
then give the instruction"). The culprit test is named in the line above the cue in the
UI, so the cue no longer has to establish context. Use exactly these:

```ts
export const CUES: Record<RadarCategory, Record<Band, string>> = {
  Speed: {
    strength: "Keep sprint work early in the session while you're fresh, and treat full recovery between reps as part of the training.",
    developing: "The next gain is in your first three steps — push the ground back behind you rather than reaching forward.",
    priority: "Cut the volume and raise the intensity: short maximal efforts with long rest, and end the set the moment your times drop off.",
  },
  Power: {
    strength: "Keep it sharp with low-volume, high-intent jumps before your main lifts, and don't let heavy work crowd them out.",
    developing: "You're producing decent force — now produce it faster by treating the floor as hot and leaving it the instant you touch it.",
    priority: "Every jump at maximum effort, fully rested, with far fewer reps than feels natural — speed of movement is the whole point.",
  },
  Strength: {
    strength: "Top it up with heavy, low-rep work and spend the freed-up energy converting that strength into speed on the field.",
    developing: "Add load progressively on the main lifts and hold technique constant — small consistent jumps beat big inconsistent ones.",
    priority: "Get consistent on the main compound lifts and add a little weight each week; this is the most reliable thing on the page to fix.",
  },
  Endurance: {
    strength: "Maintain it with a steady weekly dose rather than occasional big efforts, so it never limits your late-game quality.",
    developing: "Build repeatability with intervals at a pace you can hold across every rep, not one you can only hit on the first.",
    priority: "Build the aerobic base first with consistent moderate work before adding harder intervals on top of it.",
  },
  Mobility: {
    strength: "Keep the routine that got you here — range takes far less work to maintain than it does to rebuild.",
    developing: "Add loaded stretching through the full range rather than passive holds, so the new range comes with control.",
    priority: "A short daily routine beats a long weekly one, because consistency is what actually changes tissue.",
  },
}
```

Replace `selectCue` with:

```ts
/** The instruction for a focal point. Pure matrix lookup, same input same output. */
export function cueFor(fp: FocalPoint): string {
  return CUES[fp.category][fp.band]
}
```

Update the imports at the top of the file: replace `import type { Band, CategoryScore } from "./scoring"`
with `import type { Band, FocalPoint } from "./scoring"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/test-report/cues.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/test-report/cues.ts __tests__/lib/test-report/cues.test.ts
git commit -m "feat(test-report): cues cut to one sentence, keyed by focal point"
```

---

### Task 4: Shared formatters + `ScoreTrack` — the one score idiom

**Files:**
- Create: `lib/test-report/format.ts`
- Create: `components/public/report/panels/ScoreTrack.tsx`
- Create: `__tests__/components/report/score-track.test.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: nothing.
- Produces: `num(n: number): string` and `formatDate(iso: string | null): string` from `lib/test-report/format.ts`; `<ScoreTrack score={number} tone?: "primary" | "accent" />` rendering a `div.score-track` with `role="img"` and an aria-label naming the score and both standards.

- [ ] **Step 0: Extract the two formatters both pages need**

Four components in Tasks 6 and 7 need identical `num()` and `formatDate()` helpers.
Create `lib/test-report/format.ts` once rather than copying them:

```ts
/** Trims trailing zeros so 45.70 reads 45.7 and 140.00 reads 140. */
export function num(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/**
 * A test date, the way the report prints it: 4 Aug 2026.
 *
 * Forced to UTC. Test dates are calendar dates with no time component, so letting
 * the viewer's timezone apply would shift a date across midnight and print the day
 * before for anyone west of UTC.
 */
export function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}
```

Every component in Tasks 6 and 7 imports from here. **Do not redefine either helper
in a component file.**

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/report/score-track.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { ScoreTrack } from "@/components/public/report/panels/ScoreTrack"

describe("ScoreTrack", () => {
  it("positions the marker at the score and explains the scale to screen readers", () => {
    const { container } = render(<ScoreTrack score={58} />)
    const dot = container.querySelector(".score-track-dot") as HTMLElement
    expect(dot.style.left).toBe("58%")
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/58.*Trained is 50.*Elite is 100/)
  })

  it("clamps out-of-range scores instead of overflowing the track", () => {
    const { container: over } = render(<ScoreTrack score={140} />)
    expect((over.querySelector(".score-track-dot") as HTMLElement).style.left).toBe("100%")
    const { container: under } = render(<ScoreTrack score={-20} />)
    expect((under.querySelector(".score-track-dot") as HTMLElement).style.left).toBe("0%")
  })

  it("carries the accent tone as a data attribute, not a hardcoded colour", () => {
    const { container } = render(<ScoreTrack score={50} tone="accent" />)
    expect(container.querySelector(".score-track")?.getAttribute("data-tone")).toBe("accent")
    // A hex literal here would break the design system rule in CLAUDE.md.
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/components/report/score-track.test.tsx`
Expected: FAIL — cannot resolve `@/components/public/report/panels/ScoreTrack`.

- [ ] **Step 3: Implement**

Create `components/public/report/panels/ScoreTrack.tsx`:

```tsx
/**
 * The ONLY way a score is drawn in this report.
 *
 * The scale is not decoration — it is the definition. `normalize()` maps a result
 * linearly from the bottom of its reference range to the top, so the left edge is
 * the range floor, the midpoint tick is Trained, and the right edge is Elite.
 * Drawing that scale is how the report answers "where do these numbers come from"
 * without a paragraph of explanation.
 *
 * Replaces KpiTile, ScoreBar, RangeBar, MetricCompare and CategoryChips, which
 * between them drew the same quantity five different ways.
 */
export function ScoreTrack({ score, tone = "primary" }: { score: number; tone?: "primary" | "accent" }) {
  const pct = Math.max(0, Math.min(100, Math.round(score)))
  return (
    <div
      className="score-track"
      data-tone={tone}
      role="img"
      aria-label={`Scores ${pct} out of 100. Trained is 50, Elite is 100.`}
    >
      <div className="score-track-fill" style={{ width: `${pct}%` }} />
      <span className="score-track-tick" aria-hidden />
      <span className="score-track-dot" style={{ left: `${pct}%` }} />
    </div>
  )
}
```

Append to `app/globals.css`, after the existing `.test-report .report-page` rules:

```css
/* The one score idiom. Built only from tokens that BOTH .report-light and
   .athlete-arena define, which is why it needs no per-scope declarations. */
.test-report .score-track {
  position: relative;
  height: 8px;
  border-radius: 999px;
  background: var(--border);
}

.test-report .score-track-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 999px;
  background: var(--primary);
}

.test-report .score-track-tick {
  position: absolute;
  top: -3px;
  bottom: -3px;
  left: 50%;
  width: 1px;
  background: var(--muted-foreground);
  opacity: 0.55;
}

.test-report .score-track-dot {
  position: absolute;
  top: 50%;
  width: 11px;
  height: 11px;
  border-radius: 999px;
  background: var(--card);
  border: 2.5px solid var(--primary);
  transform: translate(-50%, -50%);
}

.test-report .score-track[data-tone="accent"] .score-track-fill {
  background: var(--accent);
}

.test-report .score-track[data-tone="accent"] .score-track-dot {
  border-color: var(--accent);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/components/report/score-track.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/test-report/format.ts components/public/report/panels/ScoreTrack.tsx __tests__/components/report/score-track.test.tsx app/globals.css
git commit -m "feat(test-report): one ScoreTrack idiom whose scale explains the score"
```

---

### Task 5: Section banding with a print fallback

**Files:**
- Modify: `app/globals.css`
- Create: `__tests__/app/report-print-styles.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS classes `report-band`, `report-band-green`, `report-band-alt`, usable inside any `.test-report` subtree.

**Why this task exists separately:** Chrome's Save-as-PDF ships with **Background graphics
off**, so `print-color-adjust: exact` is only a request. White text on a green band that
does not print is *invisible text* — a total, silent failure on a document whose entire
purpose is being printed. The print fallback is the deliverable here, not an afterthought.

- [ ] **Step 1: Write the failing test**

Create `__tests__/app/report-print-styles.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// A stylesheet guarantee has no runtime surface a component test can reach, so it
// needs an explicit assertion or nothing catches its removal.
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8")

function block(selector: string): string {
  const i = css.indexOf(selector)
  expect(i, `${selector} is not in globals.css`).toBeGreaterThan(-1)
  return css.slice(i, css.indexOf("}", i))
}

describe("report banding", () => {
  it("defines the three bands from tokens, never a hex literal", () => {
    for (const sel of [".report-band-green", ".report-band-alt"]) {
      expect(block(sel)).not.toMatch(/#[0-9a-fA-F]{3,6}/)
    }
  })

  it("green bands do NOT rely on a printed background for legibility", () => {
    // Chrome's Save-as-PDF defaults to Background graphics OFF. If the green fill
    // is dropped, light-on-green text becomes white-on-white and vanishes.
    const printIdx = css.lastIndexOf("@media print")
    const printSection = css.slice(css.indexOf(".report-band-green", printIdx))
    expect(printSection).toContain("--foreground")
    expect(printSection).toMatch(/background:\s*transparent/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/app/report-print-styles.test.ts`
Expected: FAIL — `.report-band-green` is not in globals.css.

- [ ] **Step 3: Implement**

Append to `app/globals.css` after the ScoreTrack rules:

```css
/* Section banding. Darren asked for green/white alternation to break the page up.
   Tokens only, so both theme scopes get it for free. */
.test-report .report-band {
  padding: 1.6rem 1.5rem;
}

@media (min-width: 768px) {
  .test-report .report-band {
    padding: 1.75rem 3rem;
  }
}

.test-report .report-band + .report-band {
  border-top: 1px solid var(--border);
}

.test-report .report-band-green {
  background: var(--primary);
  color: var(--primary-foreground);
  border-top-color: transparent;
}

.test-report .report-band-alt {
  background: var(--surface);
}

@media print {
  /* Chrome's Save-as-PDF has Background graphics OFF by default, so the green fill
     is not guaranteed to render — and light text on a dropped fill is invisible.
     On paper the banding rhythm is carried by rules instead, which also saves ink
     on a document meant to be printed. */
  .test-report .report-band-green {
    background: transparent !important;
    color: var(--foreground) !important;
    border-top: 2px solid var(--primary) !important;
  }

  .test-report .report-band-green .djp-eyebrow,
  .test-report .report-band-green .report-band-quiet {
    color: var(--muted-foreground) !important;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/app/report-print-styles.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css __tests__/app/report-print-styles.test.ts
git commit -m "feat(test-report): section banding that survives Save-as-PDF with backgrounds off"
```

---

### Task 6: Page 1 — masthead, index, mover, focal points

**Files:**
- Create: `components/public/report/ReportPageOne.tsx`
- Create: `components/public/report/panels/FocalPointCard.tsx`
- Modify: `components/public/report/panels/ReportPage.tsx`
- Test: covered by Task 8's integration test (this task's own check is the build)

**Interfaces:**
- Consumes: `ScoreTrack` and `num` / `formatDate` from `lib/test-report/format` (Task 4), `report-band*` CSS (Task 5), `ReportScores.focalPoints` / `.biggestMover` / `.strongest` / `.athleteScore` (Tasks 1–2), `cueFor` (Task 3), `TestReportData` from `lib/test-report/data.ts`. **Never redefine `num` or `formatDate` locally.**
- Produces: `<ReportPageOne data={TestReportData} scores={ReportScores} />`, and `<FocalPointCard fp={FocalPoint} />`.

- [ ] **Step 1: Make `ReportPage` a banding container**

Replace the whole of `components/public/report/panels/ReportPage.tsx`:

```tsx
/**
 * One printed page. `break-after: page` (see `.test-report` in globals.css) is what
 * makes Save-PDF produce the pages the browser shows.
 *
 * The page no longer owns a header — bands do. A band carries its own eyebrow, which
 * is why `panels/SectionHeading` was deleted.
 */
export function ReportPage({ children }: { children: React.ReactNode }) {
  return <section className="report-page relative flex min-h-screen flex-col">{children}</section>
}

/** One banded section. `tone` picks the ground; padding and rules come from CSS. */
export function ReportBand({
  tone = "plain",
  className = "",
  children,
}: {
  tone?: "plain" | "green" | "alt"
  className?: string
  children: React.ReactNode
}) {
  const toneClass = tone === "green" ? "report-band-green" : tone === "alt" ? "report-band-alt" : ""
  return <div className={`report-band ${toneClass} ${className}`.trim()}>{children}</div>
}
```

- [ ] **Step 2: Write `FocalPointCard`**

Create `components/public/report/panels/FocalPointCard.tsx`:

```tsx
import type { FocalPoint } from "@/lib/test-report/scoring"
import { cueFor } from "@/lib/test-report/cues"
import { num } from "@/lib/test-report/format"
import { BandPill } from "./BandPill"
import { ScoreTrack } from "./ScoreTrack"

/**
 * A category worth training, and the single test dragging it down.
 *
 * Naming the culprit is the whole point: "Strength 61" is not something an athlete
 * can act on, but "your bench is behind your squat" is.
 */
export function FocalPointCard({ fp }: { fp: FocalPoint }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-heading text-sm font-bold uppercase tracking-wide">{fp.category}</p>
        <BandPill band={fp.band} />
      </div>
      <p className="font-heading text-2xl font-bold leading-none">
        {fp.score}
        <span className="ml-0.5 text-sm font-normal text-muted-foreground">/100</span>
      </p>
      <ScoreTrack score={fp.score} />
      <p className="text-sm text-muted-foreground">
        Dragged by{" "}
        <strong className="font-semibold text-foreground">
          {fp.culprit.label} — {num(fp.culprit.latest)} {fp.culprit.unit}
        </strong>
        , the lowest score in this category.
      </p>
      <p className="border-t border-border pt-3 text-sm leading-relaxed">
        <span className="djp-eyebrow mb-1 block text-muted-foreground">What moves it</span>
        {cueFor(fp)}
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Write `ReportPageOne`**

Create `components/public/report/ReportPageOne.tsx`:

```tsx
import Image from "next/image"
import type { TestReportData } from "@/lib/test-report/data"
import type { ReportScores } from "@/lib/test-report/scoring"
import { num, formatDate } from "@/lib/test-report/format"
import { ReportPage, ReportBand } from "./panels/ReportPage"
import { ScoreTrack } from "./panels/ScoreTrack"
import { FocalPointCard } from "./panels/FocalPointCard"

/**
 * Page 1 — who, how they're doing overall, what moved, and what to train next.
 *
 * The cover page this replaces gave a full sheet to a portrait and three counts.
 * The counts now sit on one line and the portrait is a thumbnail, which is what
 * "maybe we can make that much smaller" actually called for.
 */
export function ReportPageOne({ data, scores }: { data: TestReportData; scores: ReportScores }) {
  const fullName = `${data.name.first} ${data.name.last}`.trim()
  const initials =
    `${data.name.first.trim().charAt(0)}${data.name.last.trim().charAt(0)}`.toUpperCase() || "DJP"
  const subtitle = [data.sport, data.position, data.age ? `Age ${data.age}` : null].filter(Boolean).join(" · ")
  const history = [
    data.testCount > 0 ? `${data.testCount} tests` : null,
    data.monthsTracked > 0 ? `over ${data.monthsTracked} months` : null,
  ]
    .filter(Boolean)
    .join(" ")
  const { athleteScore, strongest, biggestMover, focalPoints } = scores

  return (
    <ReportPage>
      <ReportBand tone="green">
        <div className="flex items-center gap-6">
          <div className="min-w-0 flex-1">
            <p className="djp-eyebrow report-band-quiet opacity-80">DJP Athlete · Performance Testing Report</p>
            <h1 className="mt-2 font-heading text-4xl font-bold uppercase leading-none tracking-wide md:text-5xl">
              {fullName}
            </h1>
            <p className="report-band-quiet mt-3 text-sm opacity-80">
              {[subtitle, data.asOf ? `Tested ${formatDate(data.asOf)}` : null, history]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="relative hidden h-[108px] w-[84px] shrink-0 overflow-hidden rounded border border-white/20 bg-white/10 sm:block">
            {data.avatarUrl ? (
              <Image src={data.avatarUrl} alt={fullName} fill sizes="84px" className="object-cover" />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center font-heading text-2xl font-bold opacity-70">
                {initials}
              </span>
            )}
          </div>
        </div>
      </ReportBand>

      <ReportBand>
        <div className="grid gap-8 md:grid-cols-2 md:items-start">
          {athleteScore !== null && (
            <div>
              <div className="flex items-center gap-2">
                <span className="font-heading text-sm font-bold uppercase tracking-wide">
                  Athlete Performance Index
                </span>
                <span className="rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground">
                  API
                </span>
              </div>
              <p className="mt-2 font-heading text-6xl font-bold leading-none">
                {athleteScore}
                <span className="ml-1 text-xl font-normal text-muted-foreground">/100</span>
              </p>
              <div className="mt-4">
                <ScoreTrack score={athleteScore} />
              </div>
              <p className="mt-3 max-w-[32ch] text-sm text-muted-foreground">
                The average of your category scores. Every test is scored 0–100 against DJP&apos;s coaching
                standards — 50 is Trained, 100 is Elite.
              </p>
              {strongest && (
                <p className="mt-2 text-sm">
                  <span className="text-muted-foreground">Strongest:</span>{" "}
                  <strong className="font-semibold">
                    {strongest.category} {strongest.score}
                  </strong>
                </p>
              )}
            </div>
          )}

          {biggestMover && (
            <div className="border-l-2 border-accent pl-5">
              <p className="djp-eyebrow text-muted-foreground">
                {biggestMover.direction === "declined"
                  ? "Biggest change since last test"
                  : biggestMover.direction === "flat"
                    ? "Since last test"
                    : "Biggest improvement since last test"}
              </p>
              <p className="mt-2 font-heading text-5xl font-bold leading-none text-accent">
                {biggestMover.test.deltaPct > 0 ? "↑" : biggestMover.test.deltaPct < 0 ? "↓" : "="}{" "}
                {Math.abs(biggestMover.test.deltaPct)}%
              </p>
              <p className="mt-3 font-heading text-base font-bold">{biggestMover.test.label}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {num(biggestMover.test.previous)} → {num(biggestMover.test.latest)} {biggestMover.test.unit}
              </p>
              {biggestMover.test.score !== null && (
                <div className="mt-4">
                  <ScoreTrack score={biggestMover.test.score} tone="accent" />
                </div>
              )}
              <p className="mt-3 max-w-[34ch] text-sm text-muted-foreground">
                {biggestMover.direction === "declined"
                  ? "Nothing improved between your last two tests. Worth checking recovery and testing conditions before reading too much into it."
                  : biggestMover.direction === "flat"
                    ? "Every test held steady since your last round — no measurable change either way."
                    : "The largest move of any test on file."}
              </p>
            </div>
          )}
        </div>
      </ReportBand>

      {focalPoints.length > 0 && (
        <ReportBand tone="alt" className="flex-1">
          <p className="djp-eyebrow text-muted-foreground">Focal points — where the next block goes</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {focalPoints.map((fp) => (
              <FocalPointCard key={fp.category} fp={fp} />
            ))}
          </div>
        </ReportBand>
      )}

      {/* Spec B inserts the coach's-note band here. It is deliberately absent rather
          than empty: a band renders padding and a rule, so an "empty" one is visible
          dead space, not nothing. The focal-points band above carries flex-1. */}

      <ReportBand tone="green">
        <div className="flex flex-wrap items-end justify-between gap-2 text-xs">
          <span className="report-band-quiet opacity-80">
            {fullName}
            {data.sport ? `, ${data.sport}` : ""}
            {data.asOf ? ` · ${formatDate(data.asOf)}` : ""}
          </span>
          <span className="report-band-quiet opacity-80">
            Prepared by <strong className="font-semibold opacity-100">Darren Paul</strong>, Performance Coach
          </span>
        </div>
      </ReportBand>
    </ReportPage>
  )
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "report|test-report"`
Expected: errors ONLY from files not yet migrated (`TestReport.tsx`, `ReportHeadline.tsx`, `ReportVerdict.tsx`, `ReportCover.tsx`). No errors from `ReportPageOne.tsx`, `FocalPointCard.tsx`, or `ReportPage.tsx`.

- [ ] **Step 5: Commit**

```bash
git add components/public/report/ReportPageOne.tsx components/public/report/panels/FocalPointCard.tsx components/public/report/panels/ReportPage.tsx
git commit -m "feat(test-report): page 1 — masthead, API, hero mover, focal points"
```

---

### Task 7: Page 2 — test by test and assessments

**Files:**
- Create: `components/public/report/ReportPageTwo.tsx`
- Create: `components/public/report/panels/TestRow.tsx`

**Interfaces:**
- Consumes: `ScoreTrack` and `num` / `formatDate` from `lib/test-report/format` (Task 4), `ReportBand` (Task 6), `ScoredTest` (Task 1), `PublicAssessment` from `lib/profile-share/data`, `Sparkline` from `components/shared/Sparkline`. **Never redefine `num` or `formatDate` locally.**
- Produces: `<ReportPageTwo scores={ReportScores} assessments={PublicAssessment[]} />`, `<TestRow test={ScoredTest} highlight?: boolean />`.

- [ ] **Step 1: Write `TestRow`**

Create `components/public/report/panels/TestRow.tsx`:

```tsx
import type { ScoredTest } from "@/lib/test-report/scoring"
import { num, formatDate } from "@/lib/test-report/format"
import { ScoreTrack } from "./ScoreTrack"
import { Sparkline } from "@/components/shared/Sparkline"

/**
 * One test, once. The old page rendered the top four as circles and then ALL of
 * them again as cards; this is the single row that replaced both.
 *
 * The sparkline is the one deliberate second idiom in the report: a trend encodes
 * history, which the score track cannot show.
 */
export function TestRow({ test, highlight = false }: { test: ScoredTest; highlight?: boolean }) {
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
          <ScoreTrack score={test.score} tone={highlight ? "accent" : "primary"} />
        ) : (
          <p className="font-mono text-[10px] uppercase text-muted-foreground">No standard for this test</p>
        )}
      </div>

      <p
        className={`text-right font-mono text-xs ${
          test.deltaPct === null
            ? "text-muted-foreground"
            : test.deltaPct >= 0
              ? "text-[var(--success)]"
              : "text-[var(--error)]"
        }`}
      >
        {test.deltaPct === null ? "—" : `${test.deltaPct >= 0 ? "↑" : "↓"} ${Math.abs(test.deltaPct)}%`}
      </p>

      <div className="justify-self-end text-primary">
        <Sparkline points={test.points} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write `ReportPageTwo`**

Create `components/public/report/ReportPageTwo.tsx`:

```tsx
import type { PublicAssessment } from "@/lib/profile-share/data"
import type { ReportScores } from "@/lib/test-report/scoring"
import { formatDate } from "@/lib/test-report/format"
import { ReportPage, ReportBand } from "./panels/ReportPage"
import { TestRow } from "./panels/TestRow"

function Battery({ a }: { a: PublicAssessment }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-heading text-sm font-bold">{a.title}</p>
        <p className="font-mono text-[10px] uppercase text-muted-foreground">{formatDate(a.date)}</p>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {a.items.map((i) => (
          <div key={i.name} className="flex items-baseline justify-between gap-2 border-b border-border pb-1">
            <dt className="text-xs text-muted-foreground">{i.name}</dt>
            <dd className="font-mono text-xs">
              {i.value}
              {i.unit ? ` ${i.unit}` : ""}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * Page 2 — every test once, on the same scale as page 1.
 *
 * Assessments: the most recent battery is open; older ones collapse behind a native
 * <details>, which is Darren's "maybe this is a drop-down" without any JS. Print CSS
 * forces it open so paper loses nothing.
 */
export function ReportPageTwo({
  scores,
  assessments,
}: {
  scores: ReportScores
  assessments: PublicAssessment[]
}) {
  const { tests, biggestMover } = scores
  const [latest, ...older] = assessments

  return (
    <ReportPage>
      <ReportBand tone="green">
        <p className="djp-eyebrow report-band-quiet opacity-80">The full verdict</p>
        <h2 className="mt-2 font-heading text-2xl font-bold uppercase tracking-wide">Test by test</h2>
        <p className="report-band-quiet mt-2 max-w-[52ch] text-sm opacity-80">
          {tests.length} {tests.length === 1 ? "test" : "tests"}, each measured the same way every time. The bar is
          the same scale as page 1 — the tick is Trained, the right edge is Elite.
        </p>
      </ReportBand>

      <ReportBand className="flex-1">
        <div className="flex flex-col">
          {tests.map((t) => (
            <TestRow key={t.key} test={t} highlight={biggestMover?.test.key === t.key} />
          ))}
        </div>
        <p className="mt-4 max-w-[68ch] text-xs text-muted-foreground">
          Elite and Trained are DJP coaching standards for each test — reference points to aim at, not measured
          averages of other athletes.
        </p>
      </ReportBand>

      {assessments.length > 0 && (
        <ReportBand tone="alt">
          <p className="djp-eyebrow text-muted-foreground">Assessment battery</p>
          <div className="mt-4 flex flex-col gap-3">
            <Battery a={latest} />
            {older.length > 0 && (
              <details className="report-earlier">
                <summary className="cursor-pointer font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  {older.length} earlier {older.length === 1 ? "assessment" : "assessments"}
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  {older.map((a) => (
                    <Battery key={`${a.title}-${a.date}`} a={a} />
                  ))}
                </div>
              </details>
            )}
          </div>
        </ReportBand>
      )}

      <ReportBand tone="green">
        <div className="flex flex-wrap items-end justify-between gap-2 text-xs">
          <span className="report-band-quiet opacity-80">
            Every number here is a logged test — objective, individual, repeatable.
          </span>
          <span className="report-band-quiet opacity-80">
            <strong className="font-semibold opacity-100">Darren Paul</strong> — darren@darrenjpaul.com
          </span>
        </div>
      </ReportBand>
    </ReportPage>
  )
}
```

- [ ] **Step 3: Force the disclosure open in print**

Append to `app/globals.css` inside the existing `@media print` block added in Task 5
(add these rules after the `.report-band-green` print rules):

```css
  /* A collapsed <details> would silently drop earlier assessments from the PDF. */
  .test-report .report-earlier > summary {
    display: none;
  }

  .test-report .report-earlier > div {
    display: flex !important;
  }
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "ReportPageTwo|TestRow"`
Expected: no output (no errors from the new files).

- [ ] **Step 5: Commit**

```bash
git add components/public/report/ReportPageTwo.tsx components/public/report/panels/TestRow.tsx app/globals.css
git commit -m "feat(test-report): page 2 — every test once, earlier assessments behind a disclosure"
```

---

### Task 8: Wire it up, delete the dead components, guard the duplication

**Files:**
- Modify: `components/public/report/TestReport.tsx`
- Delete: `components/public/report/ReportCover.tsx`, `ReportHeadline.tsx`, `ReportVerdict.tsx`, and `panels/{KpiTile,ScoreBar,RangeBar,MetricCompare,CategoryChips,CueBlock,SectionHeading}.tsx`
- Modify: `__tests__/components/report/test-report.test.tsx`
- Check: `__tests__/components/report/report-preview.test.tsx`, `__tests__/components/report/report-shell.test.tsx`

**Interfaces:**
- Consumes: `ReportPageOne` (Task 6), `ReportPageTwo` (Task 7), `buildReportScores` (Tasks 1–2).
- Produces: the final `<TestReport data theme />`, unchanged in signature so `app/athlete/[token]/page.tsx` needs no edit.

- [ ] **Step 1: Write the failing tests**

In `__tests__/components/report/test-report.test.tsx`, replace the first three tests with:

```tsx
  it("renders two pages with the athlete identity and the index", () => {
    const { container } = render(<TestReport data={base} />)
    expect(container.querySelectorAll(".report-page")).toHaveLength(2)
    expect(screen.getAllByText(/Marcus Johnson/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Basketball/).length).toBeGreaterThan(0)
    expect(screen.getByText("Athlete Performance Index")).toBeInTheDocument()
    expect(screen.getByText("Test by test")).toBeInTheDocument()
    expect(screen.getAllByText(/Darren Paul/).length).toBeGreaterThan(0)
  })

  it("explains how the index is built, because that was the first thing asked about it", () => {
    render(<TestReport data={base} />)
    expect(screen.getByText(/50 is Trained, 100 is Elite/)).toBeInTheDocument()
  })

  it("does NOT repeat the weakest category all over the report", () => {
    // The regression guard for the whole restructure. The old layout rendered the
    // weakest category SIX times; the budget is the focal-point card plus at most
    // one more mention.
    //
    // Counts literal occurrences in the rendered text rather than using
    // getAllByText, which also matches every ANCESTOR whose text contains the
    // string — that inflates the count unpredictably and would make this guard
    // meaningless. Counting is the whole point here: a presence assertion would
    // pass on the very layout this replaces.
    const { container } = render(<TestReport data={base} />)
    const occurrences = (needle: string) => (container.textContent ?? "").split(needle).length - 1

    const weakest = buildReportScores(base.tests).focalPoints[0]
    expect(weakest, "fixture must produce at least one focal point").toBeDefined()
    const n = occurrences(weakest.category)
    expect(n, `"${weakest.category}" rendered ${n} times`).toBeLessThanOrEqual(2)
  })

  it("shows each test once in the rows, and only the hero twice", () => {
    // The old page 3 drew the top four tests as circles and then ALL of them again
    // as cards. Now a non-hero test appears exactly once. The biggest mover appears
    // twice — once as the hero on page 1, once in its own row — and that is the
    // intended emphasis, not the duplication being fixed.
    const { container } = render(<TestReport data={base} />)
    const occurrences = (needle: string) => (container.textContent ?? "").split(needle).length - 1

    // cmj improves 40 -> 50 (+25%) vs sprint_10m 2.3 -> 2.2 (+4%), so the jump is the hero.
    expect(occurrences("Countermovement Jump")).toBe(2)
    expect(occurrences("10m Sprint")).toBe(1)
  })
```

Add to that file's imports:

```tsx
import { buildReportScores } from "@/lib/test-report/scoring"
```

Delete the test `"renders a coaching cue drawn from the weakest category"` — the
`CueBlock` provenance caption it asserted on no longer exists; the cue now renders
inside `FocalPointCard` and is covered by `cues.test.ts` plus the count assertion above.

Keep the `"shows testing content and NONE of the program/exercise content"` test and any
existing test asserting `"percentile"` never renders, unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/components/report/test-report.test.tsx`
Expected: FAIL — three `.report-page` elements found, not two; "Athlete Performance Index" absent.

- [ ] **Step 3: Rewrite `TestReport` and delete the dead files**

Replace the body of `components/public/report/TestReport.tsx`:

```tsx
import type { TestReportData } from "@/lib/test-report/data"
import { buildReportScores } from "@/lib/test-report/scoring"
import { ReportPageOne } from "./ReportPageOne"
import { ReportPageTwo } from "./ReportPageTwo"
import { ReportShell, type ReportTheme } from "./ReportShell"

export type { ReportTheme }

/**
 * The public athlete test report — two pages.
 *
 * LIGHT is the default because this is a print-first document: a full-bleed dark
 * page is heavy on ink and `print-color-adjust: exact` is only a request, which
 * "save ink" settings and many home printers ignore. Dark stays available as a
 * screen-only deck treatment, via `?theme=dark` or the in-page toggle.
 *
 * With no logged tests the report renders page 1 alone rather than an empty second
 * sheet — a blank page reads as broken, not premium.
 */
export function TestReport({ data, theme = "light" }: { data: TestReportData; theme?: ReportTheme }) {
  const scores = buildReportScores(data.tests)
  const hasTests = data.tests.length > 0

  return (
    <ReportShell initialTheme={theme}>
      <ReportPageOne data={data} scores={scores} />
      {hasTests && <ReportPageTwo scores={scores} assessments={data.assessments} />}
    </ReportShell>
  )
}
```

Then delete:

```bash
git rm components/public/report/ReportCover.tsx \
       components/public/report/ReportHeadline.tsx \
       components/public/report/ReportVerdict.tsx \
       components/public/report/panels/KpiTile.tsx \
       components/public/report/panels/ScoreBar.tsx \
       components/public/report/panels/RangeBar.tsx \
       components/public/report/panels/MetricCompare.tsx \
       components/public/report/panels/CategoryChips.tsx \
       components/public/report/panels/CueBlock.tsx \
       components/public/report/panels/SectionHeading.tsx
```

**Do not touch `components/admin/arena/SectionHeading.tsx`.** It is a different file with
the same name and the Arena view imports it.

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run __tests__/components/report/ __tests__/lib/test-report/ __tests__/app/report-print-styles.test.ts`
Expected: PASS. If `report-preview.test.tsx` fails on deleted panels, update its imports
and page-count expectation to 2 — do not re-add a deleted component.

Run: `npx tsc --noEmit`
Expected: clean, or errors only in files unrelated to the report. Any remaining reference
to `scores.focus`, `selectCue`, or a deleted panel is a miss — fix it.

Run: `npx vitest run __tests__/components/athlete/ __tests__/app/athlete-report-route.test.ts`
Expected: PASS — these cover the token route and the admin share dialog, which this change
must not have broken.

- [ ] **Step 5: Commit**

```bash
git add components/public/report/TestReport.tsx __tests__/components/report/
git commit -m "feat(test-report): two banded pages, seven score idioms down to one"
```

---

### Task 9: Verify the whole document renders

**Files:** none changed unless a defect is found.

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: succeeds. Grep the output for `report` — a stale `.next/cache/.tsbuildinfo` can
make `next build` report "Cannot find module" for a NEW file while `tsc --noEmit` is green.
If that happens, delete `.next/cache/.tsbuildinfo` and rebuild before investigating further.

- [ ] **Step 2: Look at it**

Run `npm run dev` and open a real client's report at `/athlete/<token>`. Confirm, in order:

1. Two pages, not three.
2. The masthead portrait is a thumbnail, not a half-page image.
3. Bands alternate green → white → surface → white.
4. The weakest category appears at most twice on page 1.
5. Every score bar is the same component at the same scale.
6. Accent orange appears exactly once per page (the mover).
7. `?theme=dark` still works and the bands invert correctly.

- [ ] **Step 3: Check the print path — the one that fails silently**

In Chrome, Ctrl+P with **Background graphics OFF** (the default).
Expected: two pages; green-band text is **dark and legible**, with a primary rule above it.
Any invisible text here means the Task 5 print fallback is not applying — check selector
specificity against `.report-light.print-document`.

Then Ctrl+P with **Background graphics ON**: bands render filled.

- [ ] **Step 4: Commit any fixes**

```bash
git add <only the files you actually changed>
git commit -m "fix(test-report): <what was wrong>"
```

---

## Done means

- `npx vitest run __tests__/components/report/ __tests__/lib/test-report/ __tests__/app/report-print-styles.test.ts` passes.
- `npm run build` succeeds.
- Both print paths (backgrounds on and off) produce two legible pages.
- No file references `scores.focus`, `selectCue`, or any deleted panel.
- `components/admin/arena/**` is untouched — `git diff --stat` must not list it.

## Deliberately not done here

- Coach commentary field (Spec B) — the slot is reserved and renders empty.
- Limb-vs-limb (Spec C) — needs a schema change.
- Editable reference ranges (Spec D) — still the constants in `test-normalization.ts`.
- Migration `00200_client_report_photo.sql` is still unapplied in prod, so the masthead
  portrait falls back to the monogram until someone applies it.
