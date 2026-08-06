# Athlete Test Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the public `/athlete/<token>` Arena card with a DJP-branded, testing-focused, three-page athlete test report modelled on `Test Report Example.pdf`, and move the Arena card behind admin login.

**Architecture:** Two pure modules (`scoring`, `cues`) wrap the existing `normalize()` reference ranges and produce every number and every word of judgment on the page. One server data layer assembles and scrubs. Three page components render a paged document that prints 1:1. The route, its HMAC token, and its verification are untouched — only the rendered component changes, so links already shared upgrade silently.

**Tech Stack:** Next.js 16 App Router (RSC), React 19, TypeScript strict, Tailwind v4 (`@theme inline`, no config file), Vitest + Testing Library.

## Global Constraints

- **Zero migrations, zero feature flags, zero new env vars.** Everything derives from existing tables.
- **No new dependencies.** Charts are hand-rolled SVG (see the existing `Sparkline`).
- Path alias `@/*` maps to the project root. There is no `src/` directory.
- Colors: semantic Tailwind classes only (`text-primary`, `bg-accent`, `text-muted-foreground`, `border-border`). **Never a hex value, never an inline `fontFamily`.** Fonts come from `font-heading` / `font-body` / `font-mono`.
- Supabase clients: drop the `Database` generic, cast in the data layer.
- The public payload must never contain `notes`, `video_url`, `created_by`, `client_user_id`, `admin_notes`, `youtube_url`, `video_path`, email, or date of birth.
- Tests live in `__tests__/`, mirroring source paths. Run targeted: `npx vitest run <path>`. **Do not run the full suite** — nothing here is cross-cutting.
- Every test gets a mutation probe: break the implementation, confirm the test fails, restore. A test that passes against a broken implementation is the repo's dominant defect class.
- Commit after each task. Work directly on `main`. **Do not push.**

---

### Task 1: Scoring module

**Files:**
- Create: `lib/test-report/scoring.ts`
- Test: `__tests__/lib/test-report/scoring.test.ts`

**Interfaces:**
- Consumes: `normalize`, `testDirection`, `RADAR_CATEGORIES`, `RadarCategory` from `@/lib/coach-intel/test-normalization`; `TEST_TYPE_LABELS` from `@/lib/validators/performance-test`; `TestType` from `@/types/database`.
- Produces: `ReportTestPoint`, `Band`, `BAND_STRENGTH_MIN`, `BAND_DEVELOPING_MIN`, `bandFor`, `ScoredTest`, `CategoryScore`, `ReportScores`, `buildReportScores`, `CATEGORY_ORDER`.

**Why this module owns the delta rather than reading `performance_tests.pct_change_from_prev`:** the stored column is raw-signed (a faster sprint stores a *negative* value), and it is maintained by a write-time recompute. Deriving it from the series here keeps the number self-consistent with the sparkline directly above it and makes the direction rule testable without a database.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/test-report/scoring.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  bandFor,
  buildReportScores,
  BAND_STRENGTH_MIN,
  BAND_DEVELOPING_MIN,
  type ReportTestPoint,
} from "@/lib/test-report/scoring"

function pt(over: Partial<ReportTestPoint> & Pick<ReportTestPoint, "testType" | "resultValue" | "testDate">): ReportTestPoint {
  return {
    resultUnit: "cm",
    customName: null,
    bodyWeightKg: null,
    isPr: false,
    ...over,
  } as ReportTestPoint
}

describe("bandFor", () => {
  it("places scores in the right band at every boundary", () => {
    expect(bandFor(BAND_STRENGTH_MIN)).toBe("strength")
    expect(bandFor(BAND_STRENGTH_MIN - 1)).toBe("developing")
    expect(bandFor(BAND_DEVELOPING_MIN)).toBe("developing")
    expect(bandFor(BAND_DEVELOPING_MIN - 1)).toBe("priority")
    expect(bandFor(0)).toBe("priority")
    expect(bandFor(100)).toBe("strength")
  })
})

describe("buildReportScores", () => {
  it("returns empty scores for no tests", () => {
    const s = buildReportScores([])
    expect(s.athleteScore).toBeNull()
    expect(s.categories).toEqual([])
    expect(s.tests).toEqual([])
    expect(s.strongest).toBeNull()
    expect(s.focus).toBeNull()
    expect(s.biggestMover).toBeNull()
  })

  it("scores a jump against its reference range", () => {
    // cmj range is 25-65 cm, higher is better. 45 sits exactly halfway → 50.
    const s = buildReportScores([pt({ testType: "cmj", resultValue: 45, testDate: "2026-06-01" })])
    expect(s.tests[0].score).toBe(50)
    expect(s.categories).toHaveLength(1)
    expect(s.categories[0].category).toBe("Power")
    expect(s.categories[0].score).toBe(50)
    expect(s.athleteScore).toBe(50)
  })

  it("treats a FASTER sprint as an improvement even though the number went down", () => {
    const s = buildReportScores([
      pt({ testType: "sprint_10m", resultValue: 2.0, resultUnit: "s", testDate: "2026-01-01" }),
      pt({ testType: "sprint_10m", resultValue: 1.8, resultUnit: "s", testDate: "2026-03-01" }),
    ])
    expect(s.tests[0].deltaPct).toBe(10)
    expect(s.biggestMover).toEqual({ label: "10m Sprint", deltaPct: 10 })
  })

  it("treats a SLOWER sprint as a decline", () => {
    const s = buildReportScores([
      pt({ testType: "sprint_10m", resultValue: 1.8, resultUnit: "s", testDate: "2026-01-01" }),
      pt({ testType: "sprint_10m", resultValue: 2.0, resultUnit: "s", testDate: "2026-03-01" }),
    ])
    expect(s.tests[0].deltaPct).toBeLessThan(0)
  })

  it("scores a 1RM relative to body weight, and excludes it when body weight is missing", () => {
    const withBw = buildReportScores([
      pt({ testType: "back_squat_1rm", resultValue: 150, resultUnit: "kg", bodyWeightKg: 100, testDate: "2026-06-01" }),
    ])
    // back_squat_1rm range is 0.5-2.5 x bodyweight. 1.5x sits halfway → 50.
    expect(withBw.tests[0].score).toBe(50)

    const withoutBw = buildReportScores([
      pt({ testType: "back_squat_1rm", resultValue: 150, resultUnit: "kg", testDate: "2026-06-01" }),
    ])
    expect(withoutBw.tests[0].score).toBeNull()
    expect(withoutBw.categories).toEqual([])
    expect(withoutBw.athleteScore).toBeNull()
    // Still listed — an unscorable test must not vanish from the report.
    expect(withoutBw.tests).toHaveLength(1)
  })

  it("lists a custom test but never scores or judges it", () => {
    const s = buildReportScores([
      pt({ testType: "custom", customName: "Sled Push 20m", resultValue: 6.2, resultUnit: "s", testDate: "2026-06-01" }),
      pt({ testType: "custom", customName: "Sled Push 20m", resultValue: 5.9, resultUnit: "s", testDate: "2026-07-01" }),
    ])
    expect(s.tests).toHaveLength(1)
    expect(s.tests[0].label).toBe("Sled Push 20m")
    expect(s.tests[0].score).toBeNull()
    expect(s.tests[0].deltaPct).toBeNull()
    expect(s.categories).toEqual([])
    expect(s.biggestMover).toBeNull()
  })

  it("averages CATEGORIES not tests, so a lopsided history cannot skew the headline", () => {
    // Six sprints at the bottom of the range (score 0) + one jump at the top (100).
    // Averaging tests would give ~14. Averaging categories gives 50.
    const sprints: ReportTestPoint[] = ["2026-01-01", "2026-01-02", "2026-01-03"].flatMap((d) => [
      pt({ testType: "sprint_10m", resultValue: 2.5, resultUnit: "s", testDate: d }),
      pt({ testType: "sprint_20m", resultValue: 4.2, resultUnit: "s", testDate: d }),
    ])
    const s = buildReportScores([...sprints, pt({ testType: "cmj", resultValue: 65, testDate: "2026-01-01" })])
    expect(s.categories.map((c) => c.category).sort()).toEqual(["Power", "Speed"])
    expect(s.athleteScore).toBe(50)
    expect(s.strongest?.category).toBe("Power")
    expect(s.focus?.category).toBe("Speed")
  })

  it("keeps only the latest result per test type and exposes the full series for the sparkline", () => {
    const s = buildReportScores([
      pt({ testType: "cmj", resultValue: 40, testDate: "2026-01-01" }),
      pt({ testType: "cmj", resultValue: 45, testDate: "2026-03-01" }),
      pt({ testType: "cmj", resultValue: 50, testDate: "2026-05-01", isPr: true }),
    ])
    expect(s.tests).toHaveLength(1)
    expect(s.tests[0].latest).toBe(50)
    expect(s.tests[0].latestDate).toBe("2026-05-01")
    expect(s.tests[0].isPr).toBe(true)
    expect(s.tests[0].points).toEqual([40, 45, 50])
  })

  it("sorts tests most-recently-tested first and categories strongest first", () => {
    const s = buildReportScores([
      pt({ testType: "cmj", resultValue: 30, testDate: "2026-01-01" }),
      pt({ testType: "sprint_10m", resultValue: 1.6, resultUnit: "s", testDate: "2026-08-01" }),
    ])
    expect(s.tests.map((t) => t.testType)).toEqual(["sprint_10m", "cmj"])
    expect(s.categories[0].category).toBe("Speed")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/test-report/scoring.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/test-report/scoring"`.

- [ ] **Step 3: Write the implementation**

Create `lib/test-report/scoring.ts`:

```ts
import { normalize, testDirection, RADAR_CATEGORIES, type RadarCategory } from "@/lib/coach-intel/test-normalization"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import type { TestType } from "@/types/database"

/**
 * A single logged test, scrubbed for the public report. Structurally a superset
 * of `RadarTestPoint` in lib/profile-share, so it can be handed straight to
 * `buildProgressions` without a second projection.
 */
export interface ReportTestPoint {
  testType: TestType
  resultValue: number
  resultUnit: string
  customName: string | null
  bodyWeightKg: number | null
  testDate: string
  isPr: boolean
}

export type Band = "strength" | "developing" | "priority"

/**
 * Band cut-points. The reference report publishes the labels but not the
 * thresholds, so these are DJP's own and deliberately easy to retune — they are
 * the only place a judgment of "good" is encoded.
 */
export const BAND_STRENGTH_MIN = 65
export const BAND_DEVELOPING_MIN = 40

export const BAND_LABELS: Record<Band, string> = {
  strength: "Strength",
  developing: "Developing",
  priority: "Priority",
}

export function bandFor(score: number): Band {
  if (score >= BAND_STRENGTH_MIN) return "strength"
  if (score >= BAND_DEVELOPING_MIN) return "developing"
  return "priority"
}

/** Fixed order so ties never reorder between renders. */
export const CATEGORY_ORDER: RadarCategory[] = ["Speed", "Power", "Strength", "Endurance", "Mobility"]

export interface ScoredTest {
  /** Test type, or `custom:<name>` — custom tests are grouped by their name. */
  key: string
  testType: TestType
  label: string
  latest: number
  unit: string
  latestDate: string
  isPr: boolean
  /** 0-100 against the reference range. null = unscorable (custom, or a 1RM with no body weight). */
  score: number | null
  /** Direction-aware % change vs the previous result. Positive always means better. */
  deltaPct: number | null
  /** Chronological values, oldest first. */
  points: number[]
}

export interface CategoryScore {
  category: RadarCategory
  score: number
  band: Band
  testLabels: string[]
}

export interface ReportScores {
  athleteScore: number | null
  /** Strongest first. Categories with no scorable test are absent entirely. */
  categories: CategoryScore[]
  strongest: CategoryScore | null
  focus: CategoryScore | null
  /** Latest result per test type, most recently tested first. */
  tests: ScoredTest[]
  biggestMover: { label: string; deltaPct: number } | null
}

function groupKey(t: ReportTestPoint): string {
  return t.testType === "custom" ? `custom:${t.customName ?? "Custom"}` : t.testType
}

function labelFor(t: ReportTestPoint): string {
  if (t.testType === "custom") return t.customName ?? "Custom Test"
  return TEST_TYPE_LABELS[t.testType] ?? t.testType
}

/**
 * Direction-aware change between the two most recent results. A sprint that got
 * faster returns a POSITIVE number: on this page, positive always means better.
 */
function deltaFor(sorted: ReportTestPoint[]): number | null {
  if (sorted.length < 2) return null
  const latest = sorted[sorted.length - 1]
  const prev = sorted[sorted.length - 2]
  if (latest.testType === "custom") return null
  const direction = testDirection(latest.testType)
  if (direction === null || prev.resultValue === 0) return null
  const raw = ((latest.resultValue - prev.resultValue) / Math.abs(prev.resultValue)) * 100
  return Math.round(direction === "higher" ? raw : -raw)
}

/**
 * Everything the report judges, derived from the athlete's own logged tests.
 * Pure: no I/O, no clock. Unscorable tests stay in `tests` (a test the athlete
 * did must appear) but are excluded from every score.
 */
export function buildReportScores(points: ReportTestPoint[]): ReportScores {
  const byKey = new Map<string, ReportTestPoint[]>()
  for (const p of points) {
    const k = groupKey(p)
    const list = byKey.get(k)
    if (list) list.push(p)
    else byKey.set(k, [p])
  }

  const tests: ScoredTest[] = []
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => a.testDate.localeCompare(b.testDate))
    const latest = sorted[sorted.length - 1]
    tests.push({
      key,
      testType: latest.testType,
      label: labelFor(latest),
      latest: latest.resultValue,
      unit: latest.resultUnit,
      latestDate: latest.testDate,
      isPr: latest.isPr,
      score: latest.testType === "custom" ? null : normalize(latest.testType, latest.resultValue, latest.bodyWeightKg),
      deltaPct: deltaFor(sorted),
      points: sorted.map((t) => t.resultValue),
    })
  }
  tests.sort((a, b) => b.latestDate.localeCompare(a.latestDate))

  const categories: CategoryScore[] = []
  for (const category of CATEGORY_ORDER) {
    const members = tests.filter((t) => t.score !== null && RADAR_CATEGORIES[category].includes(t.testType))
    if (members.length === 0) continue
    const score = Math.round(members.reduce((sum, t) => sum + (t.score as number), 0) / members.length)
    categories.push({ category, score, band: bandFor(score), testLabels: members.map((t) => t.label) })
  }
  // Strongest first; CATEGORY_ORDER breaks ties because sort is stable.
  categories.sort((a, b) => b.score - a.score)

  const athleteScore =
    categories.length > 0
      ? Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length)
      : null

  const movers = tests.filter((t): t is ScoredTest & { deltaPct: number } => t.deltaPct !== null)
  const biggest = movers.reduce<(ScoredTest & { deltaPct: number }) | null>(
    (best, t) => (best === null || Math.abs(t.deltaPct) > Math.abs(best.deltaPct) ? t : best),
    null,
  )

  return {
    athleteScore,
    categories,
    strongest: categories[0] ?? null,
    focus: categories.length > 0 ? categories[categories.length - 1] : null,
    tests,
    biggestMover: biggest ? { label: biggest.label, deltaPct: biggest.deltaPct } : null,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/test-report/scoring.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Mutation-probe the direction rule**

Temporarily change `deltaFor`'s last line to `return Math.round(raw)` (drop the direction flip). Re-run. The "FASTER sprint" and "SLOWER sprint" tests **must** fail. Restore the line and confirm green again. Then temporarily change `athleteScore` to average `tests` instead of `categories`; the lopsided-history test **must** fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add lib/test-report/scoring.ts __tests__/lib/test-report/scoring.test.ts
git commit -m "feat(report): scoring module for the athlete test report"
```

---

### Task 2: Coaching cue library

**Files:**
- Create: `lib/test-report/cues.ts`
- Test: `__tests__/lib/test-report/cues.test.ts`

**Interfaces:**
- Consumes: `Band`, `CategoryScore` from `@/lib/test-report/scoring`; `RadarCategory` from `@/lib/coach-intel/test-normalization`.
- Produces: `CUES`, `selectCue(focus: CategoryScore | null): string | null`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/test-report/cues.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { CUES, selectCue } from "@/lib/test-report/cues"
import { CATEGORY_ORDER, type Band, type CategoryScore } from "@/lib/test-report/scoring"

const BANDS: Band[] = ["strength", "developing", "priority"]

describe("CUES", () => {
  it("covers every category and band with non-empty coaching copy", () => {
    for (const category of CATEGORY_ORDER) {
      for (const band of BANDS) {
        const cue = CUES[category]?.[band]
        expect(cue, `${category}/${band}`).toBeTruthy()
        expect(cue.length, `${category}/${band}`).toBeGreaterThan(20)
      }
    }
  })
})

describe("selectCue", () => {
  it("returns the cue for the focus category and band", () => {
    const focus: CategoryScore = { category: "Speed", score: 32, band: "priority", testLabels: ["10m Sprint"] }
    expect(selectCue(focus)).toBe(CUES.Speed.priority)
  })

  it("returns null when there is no scorable category", () => {
    expect(selectCue(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/test-report/cues.test.ts`
Expected: FAIL — cannot resolve `@/lib/test-report/cues`.

- [ ] **Step 3: Write the implementation**

Create `lib/test-report/cues.ts`:

```ts
import type { RadarCategory } from "@/lib/coach-intel/test-normalization"
import type { Band, CategoryScore } from "./scoring"

/**
 * Coaching cues, one per (category x band). Selected from the athlete's WEAKEST
 * scorable category, so the report always closes on the thing that moves the
 * needle most. Deterministic on purpose: the same numbers produce the same
 * sentence on every render, and the copy is reviewable in one place rather than
 * generated per view.
 *
 * Tone rule (owner decision): candid but constructive, athlete/parent-facing.
 * Name the gap, then give the instruction. No clinical language, no diagnosis.
 */
export const CUES: Record<RadarCategory, Record<Band, string>> = {
  Speed: {
    strength:
      "Speed is your weapon — protect it. Keep sprint work early in the session when you're fresh, and treat full-recovery rest between reps as part of the training, not a break from it.",
    developing:
      "Your top-end is coming along. The next gain is in the first three steps: push the ground back hard behind you rather than reaching forward, and hold a strong forward lean out of the start.",
    priority:
      "Speed is your biggest opportunity right now. Cut the volume and raise the intensity — short, maximal efforts with long rest beat long tired ones. Quality reps only; stop the set the moment your times start dropping off.",
  },
  Power: {
    strength:
      "Your power output is a real strength. Keep it sharp with low-volume, high-intent jumps before your main lifts, and don't let heavy strength work crowd it out of the week.",
    developing:
      "You're producing decent force — now produce it faster. Focus on minimising ground contact time: think of the floor as hot, and aim to leave it the instant you touch it.",
    priority:
      "Power is where the gap is. Prioritise intent over load — every jump and throw done at maximum effort, fully rested, with far fewer reps than feels natural. Speed of movement is the whole point.",
  },
  Strength: {
    strength:
      "Your strength base is well built. Keep it topped up with heavy, low-rep work and spend the freed-up energy converting that strength into speed and power on the field.",
    developing:
      "Your base is solid but there's room above it. Add load progressively on the main lifts and hold technique constant — small, consistent jumps beat big inconsistent ones.",
    priority:
      "Strength is your limiting factor, and it's the most reliable thing to fix. Get consistent on the main compound lifts, add a little weight each week, and give this block the time it needs before chasing anything flashier.",
  },
  Endurance: {
    strength:
      "Your engine holds up well. Maintain it with a steady weekly dose rather than occasional big efforts, so it never becomes the thing that limits your late-game quality.",
    developing:
      "Your conditioning is respectable but fades under repeat efforts. Build the repeatability: intervals at a pace you can hold across every rep, not one you can only hit on the first.",
    priority:
      "Conditioning is holding back everything else you do — technique and power both fall away once you're tired. Build the aerobic base first with consistent, moderate work before adding harder intervals on top.",
  },
  Mobility: {
    strength:
      "Your range of motion is a genuine asset — it's what lets you get into strong positions safely. Keep the routine that got you here; it takes far less to maintain than to rebuild.",
    developing:
      "You've got workable range but it runs out at end positions. Add loaded stretching through the full range rather than passive holds, so the new range comes with control.",
    priority:
      "Restricted range is limiting the positions you can train in, which caps everything else. A short daily routine beats a long weekly one — consistency is what changes tissue.",
  },
}

/**
 * The athlete's cue: the weakest scorable category decides. Returns null when no
 * category is scorable, in which case the quote block is omitted rather than
 * rendered empty.
 */
export function selectCue(focus: CategoryScore | null): string | null {
  if (!focus) return null
  return CUES[focus.category]?.[focus.band] ?? null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/test-report/cues.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Mutation-probe the coverage test**

Temporarily delete the `Mobility.priority` entry. Re-run — the coverage test **must** fail naming `Mobility/priority`. Restore.

- [ ] **Step 6: Commit**

```bash
git add lib/test-report/cues.ts __tests__/lib/test-report/cues.test.ts
git commit -m "feat(report): deterministic coaching cue library"
```

---

### Task 3: Data layer

**Files:**
- Create: `lib/test-report/data.ts`
- Modify: `lib/profile-share/data.ts` — add `export` to `loadPublicAssessments` and to the `MAX_ASSESSMENTS` / `MAX_ASSESSMENT_ITEMS` constants it uses (they stay in place; only the keyword changes)
- Test: `__tests__/lib/test-report/data.test.ts`

**Interfaces:**
- Consumes: `getUserById` from `@/lib/db/users`; `getProfileByUserId` from `@/lib/db/client-profiles`; `listByUser` from `@/lib/db/performance-tests`; `loadPublicAssessments`, `computeAge`, `PublicAssessment` from `@/lib/profile-share/data`; `ReportTestPoint` from `@/lib/test-report/scoring`.
- Produces: `TestReportData`, `getTestReportData(clientUserId: string): Promise<TestReportData | null>`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/test-report/data.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn() }))
vi.mock("@/lib/db/client-profiles", () => ({ getProfileByUserId: vi.fn() }))
vi.mock("@/lib/db/performance-tests", () => ({ listByUser: vi.fn() }))
vi.mock("@/lib/profile-share/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profile-share/data")>()
  return { ...actual, loadPublicAssessments: vi.fn() }
})

import { getTestReportData } from "@/lib/test-report/data"
import { getUserById } from "@/lib/db/users"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { listByUser } from "@/lib/db/performance-tests"
import { loadPublicAssessments } from "@/lib/profile-share/data"

const activeClient = {
  id: "u1",
  first_name: "Marcus",
  last_name: "Johnson",
  email: "marcus@example.com",
  avatar_url: null,
  role: "client",
  status: "active",
  created_at: "2024-03-10T00:00:00Z",
}

const rawTest = {
  id: "t1",
  client_user_id: "u1",
  created_by: "admin1",
  test_type: "cmj",
  custom_name: null,
  result_value: 45,
  result_unit: "cm",
  trial_values: [44, 45],
  best_method: "highest",
  test_date: "2026-06-01",
  body_weight_kg: 84,
  notes: "INTERNAL: knee felt tight, watch this",
  video_url: "https://storage.example.com/private-form-check.mp4",
  is_pr: true,
  pct_change_from_prev: 4.6,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
}

beforeEach(() => {
  vi.mocked(getUserById).mockResolvedValue(activeClient as never)
  vi.mocked(getProfileByUserId).mockResolvedValue({
    sport: "Basketball",
    position: "Point Guard",
    date_of_birth: "2002-01-15",
  } as never)
  vi.mocked(listByUser).mockResolvedValue([rawTest] as never)
  vi.mocked(loadPublicAssessments).mockResolvedValue([])
})

describe("getTestReportData", () => {
  it("assembles identity, tests and derived counts", async () => {
    const d = await getTestReportData("u1")
    expect(d).not.toBeNull()
    expect(d!.name).toEqual({ first: "Marcus", last: "Johnson" })
    expect(d!.sport).toBe("Basketball")
    expect(d!.age).toBeGreaterThan(20)
    expect(d!.tests).toHaveLength(1)
    expect(d!.tests[0]).toMatchObject({ testType: "cmj", resultValue: 45, isPr: true })
    expect(d!.testCount).toBe(1)
    expect(d!.prCount).toBe(1)
    expect(d!.asOf).toBe("2026-06-01")
  })

  it("NEVER leaks coach-private fields into the public payload", async () => {
    const d = await getTestReportData("u1")
    const serialized = JSON.stringify(d)
    expect(serialized).not.toContain("INTERNAL")
    expect(serialized).not.toContain("private-form-check")
    expect(serialized).not.toContain("marcus@example.com")
    expect(serialized).not.toContain("2002-01-15") // DOB — age only
    expect(serialized).not.toContain("admin1")
    for (const key of ["notes", "video_url", "created_by", "client_user_id"]) {
      expect(serialized).not.toContain(`"${key}"`)
    }
  })

  it("returns null for a non-client, an inactive client, or a missing user", async () => {
    vi.mocked(getUserById).mockResolvedValue({ ...activeClient, role: "admin" } as never)
    expect(await getTestReportData("u1")).toBeNull()

    vi.mocked(getUserById).mockResolvedValue({ ...activeClient, status: "inactive" } as never)
    expect(await getTestReportData("u1")).toBeNull()

    vi.mocked(getUserById).mockResolvedValue(null as never)
    expect(await getTestReportData("u1")).toBeNull()

    vi.mocked(getUserById).mockRejectedValue(new Error("db down"))
    expect(await getTestReportData("u1")).toBeNull()
  })

  it("degrades to empty sections when a data source throws", async () => {
    vi.mocked(listByUser).mockRejectedValue(new Error("timeout"))
    vi.mocked(loadPublicAssessments).mockRejectedValue(new Error("timeout"))
    const d = await getTestReportData("u1")
    expect(d).not.toBeNull()
    expect(d!.tests).toEqual([])
    expect(d!.assessments).toEqual([])
    expect(d!.asOf).toBeNull()
  })

  it("renders without a client_profiles row", async () => {
    vi.mocked(getProfileByUserId).mockResolvedValue(null as never)
    const d = await getTestReportData("u1")
    expect(d!.sport).toBeNull()
    expect(d!.age).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/test-report/data.test.ts`
Expected: FAIL — cannot resolve `@/lib/test-report/data`.

- [ ] **Step 3: Export the assessment loader from the Arena data layer**

In `lib/profile-share/data.ts`, change the declaration on line 119 from
`async function loadPublicAssessments(` to `export async function loadPublicAssessments(`.
Nothing else in that file changes.

- [ ] **Step 4: Write the implementation**

Create `lib/test-report/data.ts`:

```ts
import { getUserById } from "@/lib/db/users"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { listByUser } from "@/lib/db/performance-tests"
import { loadPublicAssessments, computeAge, type PublicAssessment } from "@/lib/profile-share/data"
import type { ReportTestPoint } from "./scoring"
import type { PerformanceTest } from "@/types/database"

export interface TestReportData {
  name: { first: string; last: string }
  avatarUrl: string | null
  sport: string | null
  position: string | null
  age: number | null
  /** Date of the most recent logged test — the report's "as of". null = no tests. */
  asOf: string | null
  testCount: number
  prCount: number
  /** Whole months between the first and last logged test. */
  monthsTracked: number
  tests: ReportTestPoint[]
  assessments: PublicAssessment[]
}

function settle<T>(r: PromiseSettledResult<T>, fallback: T): T {
  return r.status === "fulfilled" ? r.value : fallback
}

function monthsBetween(firstIso: string, lastIso: string): number {
  const a = new Date(`${firstIso}T00:00:00Z`)
  const b = new Date(`${lastIso}T00:00:00Z`)
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  return Math.max(0, months)
}

/**
 * Assembles the public test report. Returns null when the user must not have a
 * report at all (missing, not a client, or deactivated) — deactivating a client
 * is how a share link gets revoked.
 *
 * Every field here is a deliberate PROJECTION. Raw `performance_tests` rows carry
 * `notes` (internal coach notes) and `video_url` (form-check footage); RSC
 * serialization would embed both in the public HTML payload, so they are never
 * copied across. Same rule as lib/profile-share/data.ts.
 */
export async function getTestReportData(clientUserId: string): Promise<TestReportData | null> {
  let user
  try {
    user = await getUserById(clientUserId)
  } catch {
    return null
  }
  if (!user || user.role !== "client" || user.status !== "active") return null

  const profile = await getProfileByUserId(clientUserId).catch(() => null)

  const [testsR, assessmentsR] = await Promise.allSettled([
    listByUser(clientUserId),
    loadPublicAssessments(clientUserId),
  ])

  const raw = settle(testsR, [] as PerformanceTest[])
  const tests: ReportTestPoint[] = raw.map((t) => ({
    testType: t.test_type,
    resultValue: t.result_value,
    resultUnit: t.result_unit,
    customName: t.custom_name ?? null,
    bodyWeightKg: t.body_weight_kg ?? null,
    testDate: t.test_date,
    isPr: t.is_pr,
  }))

  const dates = tests.map((t) => t.testDate).sort()
  const asOf = dates.length > 0 ? dates[dates.length - 1] : null

  return {
    name: { first: user.first_name, last: user.last_name },
    avatarUrl: user.avatar_url,
    sport: profile?.sport ?? null,
    position: profile?.position ?? null,
    age: computeAge(profile?.date_of_birth ?? null),
    asOf,
    testCount: tests.length,
    prCount: tests.filter((t) => t.isPr).length,
    monthsTracked: dates.length > 1 ? monthsBetween(dates[0], dates[dates.length - 1]) : 0,
    tests,
    assessments: settle(assessmentsR, [] as PublicAssessment[]),
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/test-report/data.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Mutation-probe the scrubbing test**

Temporarily add `notes: t.notes` to the `tests` projection. Re-run — the leak test **must** fail on both the `"notes"` key assertion and the `INTERNAL` substring. Restore.

- [ ] **Step 7: Commit**

```bash
git add lib/test-report/data.ts lib/profile-share/data.ts __tests__/lib/test-report/data.test.ts
git commit -m "feat(report): scrubbed data layer for the athlete test report"
```

---

### Task 4: Report panel primitives

**Files:**
- Create: `components/public/report/panels/ReportPage.tsx`
- Create: `components/public/report/panels/KpiTile.tsx`
- Create: `components/public/report/panels/BandPill.tsx`
- Create: `components/public/report/panels/ScoreBar.tsx`
- Create: `components/public/report/panels/RangeBar.tsx`
- Create: `components/public/report/panels/CueBlock.tsx`
- Create: `components/public/report/panels/CategoryChips.tsx`
- Modify: `app/globals.css` — add the `.test-report` page/print rules
- Test: `__tests__/components/report/panels.test.tsx`

**Interfaces:**
- Consumes: `Band`, `BAND_LABELS`, `BAND_DEVELOPING_MIN`, `BAND_STRENGTH_MIN`, `CategoryScore` from `@/lib/test-report/scoring`.
- Produces: `ReportPage`, `KpiTile`, `BandPill`, `ScoreBar`, `RangeBar`, `CueBlock`, `CategoryChips` — all server components, no `"use client"`.

**Design note on `RangeBar`:** the reference plots percentiles against population norms. DJP has no population data, so the bar's axis is the 0–100 reference-range score with band zones marked at 40 and 65. It is labelled "reference range", never "percentile" — claiming a percentile we cannot compute would be inventing a statistic. `left`/`right` are accepted from day one so phase 2's bilateral data needs no rewrite.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/report/panels.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { KpiTile } from "@/components/public/report/panels/KpiTile"
import { BandPill } from "@/components/public/report/panels/BandPill"
import { ScoreBar } from "@/components/public/report/panels/ScoreBar"
import { RangeBar } from "@/components/public/report/panels/RangeBar"
import { CueBlock } from "@/components/public/report/panels/CueBlock"
import { CategoryChips } from "@/components/public/report/panels/CategoryChips"

describe("KpiTile", () => {
  it("renders value, unit and label", () => {
    render(<KpiTile value="45.7" unit="cm" label="CMJ Height" />)
    expect(screen.getByText("45.7")).toBeInTheDocument()
    expect(screen.getByText("cm")).toBeInTheDocument()
    expect(screen.getByText(/CMJ Height/i)).toBeInTheDocument()
  })

  it("renders the PR badge only when flagged", () => {
    const { rerender } = render(<KpiTile value="45.7" unit="cm" label="CMJ" isPr />)
    expect(screen.getByText("PR")).toBeInTheDocument()
    rerender(<KpiTile value="45.7" unit="cm" label="CMJ" />)
    expect(screen.queryByText("PR")).not.toBeInTheDocument()
  })
})

describe("BandPill", () => {
  it("labels each band", () => {
    const { rerender } = render(<BandPill band="strength" />)
    expect(screen.getByText(/Strength/i)).toBeInTheDocument()
    rerender(<BandPill band="priority" />)
    expect(screen.getByText(/Priority/i)).toBeInTheDocument()
  })
})

describe("ScoreBar", () => {
  it("renders the score and sizes the fill to it", () => {
    const { container } = render(<ScoreBar label="Speed" score={48} />)
    expect(screen.getByText("Speed")).toBeInTheDocument()
    expect(screen.getByText("48")).toBeInTheDocument()
    const fill = container.querySelector("[data-testid='score-fill']") as HTMLElement
    expect(fill.style.width).toBe("48%")
  })
})

describe("RangeBar", () => {
  it("plots a single marker at the score", () => {
    const { container } = render(<RangeBar score={70} />)
    const markers = container.querySelectorAll("[data-testid='range-marker']")
    expect(markers).toHaveLength(1)
    expect((markers[0] as HTMLElement).style.left).toBe("70%")
  })

  it("plots TWO markers and an asymmetry pill when bilateral values are supplied", () => {
    render(<RangeBar score={70} left={80} right={60} />)
    const markers = screen.getAllByTestId("range-marker")
    expect(markers).toHaveLength(2)
    expect(markers[0].style.left).toBe("80%")
    expect(markers[1].style.left).toBe("60%")
    expect(screen.getByText(/25% \(left\)/i)).toBeInTheDocument()
  })

  it("never calls itself a percentile", () => {
    const { container } = render(<RangeBar score={70} />)
    expect(container.textContent?.toLowerCase()).not.toContain("percentile")
  })
})

describe("CueBlock", () => {
  it("renders the cue text", () => {
    render(<CueBlock cue="Cut the volume and raise the intensity." />)
    expect(screen.getByText(/Cut the volume/)).toBeInTheDocument()
  })
})

describe("CategoryChips", () => {
  it("marks scorable categories active and the rest inactive", () => {
    render(<CategoryChips active={["Speed", "Power"]} />)
    expect(screen.getByText("Speed")).toHaveAttribute("data-active", "true")
    expect(screen.getByText("Mobility")).toHaveAttribute("data-active", "false")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/components/report/panels.test.tsx`
Expected: FAIL — none of the panel modules resolve.

- [ ] **Step 3: Write the panels**

`components/public/report/panels/ReportPage.tsx`:

```tsx
/**
 * One page of the report. `break-after: page` is what makes Save-PDF produce the
 * same three pages the browser shows — the whole point of the paged treatment.
 */
export function ReportPage({
  eyebrow,
  title,
  pageNumber,
  footer,
  children,
}: {
  eyebrow: string
  title?: string
  pageNumber?: string
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="report-page relative flex min-h-screen flex-col gap-6 px-6 py-10 md:px-12 md:py-14">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="djp-eyebrow text-primary">{eyebrow}</p>
          {title && <h2 className="mt-2 font-heading text-3xl font-bold md:text-4xl">{title}</h2>}
        </div>
        {pageNumber && <span className="font-mono text-xs text-muted-foreground">{pageNumber}</span>}
      </header>
      <div className="flex-1">{children}</div>
      {footer && <footer className="border-t border-border pt-4 text-xs text-muted-foreground">{footer}</footer>}
    </section>
  )
}
```

`components/public/report/panels/KpiTile.tsx`:

```tsx
/** Headline number tile — the reference's "49/100 SPEED SCORE" block. */
export function KpiTile({
  value,
  unit,
  label,
  caption,
  isPr = false,
}: {
  value: string
  unit?: string
  label: string
  caption?: string
  isPr?: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline gap-1">
        <span className="font-heading text-3xl font-bold text-primary">{value}</span>
        {unit && <span className="font-mono text-xs text-muted-foreground">{unit}</span>}
        {isPr && (
          <span className="ml-auto rounded-full bg-accent/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent">
            PR
          </span>
        )}
      </div>
      <p className="djp-eyebrow mt-2 text-muted-foreground">{label}</p>
      {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
    </div>
  )
}
```

`components/public/report/panels/BandPill.tsx`:

```tsx
import { BAND_LABELS, type Band } from "@/lib/test-report/scoring"

const TONE: Record<Band, string> = {
  strength: "bg-[var(--success)]/15 text-[var(--success)]",
  developing: "bg-primary/15 text-primary",
  priority: "bg-[var(--error)]/15 text-[var(--error)]",
}

/** STRENGTH / DEVELOPING / PRIORITY status pill from the reference report. */
export function BandPill({ band }: { band: Band }) {
  return (
    <span className={`inline-flex rounded px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${TONE[band]}`}>
      {BAND_LABELS[band]}
    </span>
  )
}
```

`components/public/report/panels/ScoreBar.tsx`:

```tsx
/** Horizontal category bar — the reference's "where time is won or lost" row. */
export function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 font-mono text-xs uppercase text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
        <div
          data-testid="score-fill"
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right font-heading text-sm font-bold">{score}</span>
    </div>
  )
}
```

`components/public/report/panels/RangeBar.tsx`:

```tsx
import { BAND_DEVELOPING_MIN, BAND_STRENGTH_MIN } from "@/lib/test-report/scoring"

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n))
}

/**
 * Where a result sits inside its reference range, 0-100, with the band zones
 * marked. Deliberately NOT called a percentile: the app has no population data,
 * and borrowing the reference report's percentile language would be presenting
 * an invented statistic as a measurement.
 *
 * `left`/`right` are the phase-2 bilateral path — supplying them plots two
 * markers and an asymmetry pill instead of one marker.
 */
export function RangeBar({ score, left, right }: { score: number; left?: number; right?: number }) {
  const bilateral = typeof left === "number" && typeof right === "number"
  const markers = bilateral ? [clamp(left), clamp(right)] : [clamp(score)]
  const asymmetryPct = bilateral ? Math.round((Math.abs(left - right) / Math.max(left, right)) * 100) : null
  const heavierSide = bilateral ? (left >= right ? "left" : "right") : null

  return (
    <div className="mt-2">
      <div className="relative h-1.5 rounded-full bg-surface">
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-[var(--error)]/25" style={{ width: `${BAND_DEVELOPING_MIN}%` }} />
        <div
          className="absolute inset-y-0 rounded-r-full bg-[var(--success)]/25"
          style={{ left: `${BAND_STRENGTH_MIN}%`, right: 0 }}
        />
        {markers.map((m, i) => (
          <span
            key={i}
            data-testid="range-marker"
            className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
              bilateral && i === 1 ? "bg-accent" : "bg-primary"
            }`}
            style={{ left: `${m}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between font-mono text-[10px] uppercase text-muted-foreground">
        <span>Reference range</span>
        {asymmetryPct !== null && <span>{`Asymmetry: ${asymmetryPct}% (${heavierSide})`}</span>}
      </div>
    </div>
  )
}
```

`components/public/report/panels/CueBlock.tsx`:

```tsx
/** The reference's pull-quote coaching cue, with its provenance caption. */
export function CueBlock({ cue }: { cue: string }) {
  return (
    <blockquote className="rounded-xl border-l-2 border-primary bg-card p-5">
      <p className="font-body text-base italic leading-relaxed">{cue}</p>
      <p className="djp-eyebrow mt-3 text-muted-foreground">
        Generated from this athlete&apos;s own test scores — every score drives a specific instruction.
      </p>
    </blockquote>
  )
}
```

`components/public/report/panels/CategoryChips.tsx`:

```tsx
import { CATEGORY_ORDER } from "@/lib/test-report/scoring"
import type { RadarCategory } from "@/lib/coach-intel/test-normalization"

/** The reference's "seven angles" strip — DJP's five testing categories. */
export function CategoryChips({ active }: { active: RadarCategory[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {CATEGORY_ORDER.map((c) => {
        const isActive = active.includes(c)
        return (
          <span
            key={c}
            data-active={isActive ? "true" : "false"}
            className={`rounded-lg border px-3 py-2 text-center font-mono text-xs uppercase ${
              isActive ? "border-primary bg-card text-foreground" : "border-border text-muted-foreground"
            }`}
          >
            {c}
          </span>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Add the paged-print rules**

Append to `app/globals.css`, immediately after the existing `.athlete-arena` print block (before the generic `.print-document` print block):

```css
/* ──────────────────────────────────────────────────────────────────────
   Test report — a paged document. Each `.report-page` is one printed page,
   so Save-PDF produces exactly the three pages the browser shows.
   ────────────────────────────────────────────────────────────────────── */
@page report {
  margin: 0;
}

.test-report .report-page {
  break-after: page;
  page: report;
}

.test-report .report-page:last-child {
  break-after: auto;
}

@media print {
  .test-report .report-page {
    min-height: auto;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run __tests__/components/report/panels.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 6: Mutation-probe the bilateral path**

Temporarily make `RangeBar` ignore `left`/`right` (always `const bilateral = false`). Re-run — the two-marker test **must** fail. Restore.

- [ ] **Step 7: Commit**

```bash
git add components/public/report/panels app/globals.css __tests__/components/report/panels.test.tsx
git commit -m "feat(report): paged report primitives and print rules"
```

---

### Task 5: The three pages and the report composition

**Files:**
- Create: `components/public/report/ReportCover.tsx`
- Create: `components/public/report/ReportHeadline.tsx`
- Create: `components/public/report/ReportVerdict.tsx`
- Create: `components/public/report/TestReport.tsx`
- Test: `__tests__/components/report/test-report.test.tsx`

**Interfaces:**
- Consumes: `TestReportData` from `@/lib/test-report/data`; `buildReportScores`, `ReportScores` from `@/lib/test-report/scoring`; `selectCue` from `@/lib/test-report/cues`; `buildProgressions` from `@/lib/profile-share/progression`; `Sparkline` from `@/components/admin/arena/Sparkline` (moved in Task 6 — until then import from `@/components/public/athlete/Sparkline` and update the import in Task 6); all Task-4 panels.
- Produces: `TestReport({ data }: { data: TestReportData })` — the single component the route renders.

**Ordering note:** implement this task against the current `components/public/athlete/Sparkline` path. Task 6 moves the file and updates this one import. Doing it the other way round leaves the tree broken between commits.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/report/test-report.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { TestReport } from "@/components/public/report/TestReport"
import type { TestReportData } from "@/lib/test-report/data"

const base: TestReportData = {
  name: { first: "Marcus", last: "Johnson" },
  avatarUrl: null,
  sport: "Basketball",
  position: "Point Guard",
  age: 24,
  asOf: "2026-07-01",
  testCount: 4,
  prCount: 2,
  monthsTracked: 6,
  tests: [
    { testType: "cmj", resultValue: 40, resultUnit: "cm", customName: null, bodyWeightKg: 84, testDate: "2026-01-01", isPr: false },
    { testType: "cmj", resultValue: 50, resultUnit: "cm", customName: null, bodyWeightKg: 84, testDate: "2026-07-01", isPr: true },
    { testType: "sprint_10m", resultValue: 2.3, resultUnit: "s", customName: null, bodyWeightKg: null, testDate: "2026-01-01", isPr: false },
    { testType: "sprint_10m", resultValue: 2.2, resultUnit: "s", customName: null, bodyWeightKg: null, testDate: "2026-06-01", isPr: true },
  ],
  assessments: [
    { title: "Mid-Season Testing", date: "2026-07-10T00:00:00Z", items: [{ name: "Back Squat", value: 140, unit: "kg" }] },
  ],
}

describe("TestReport", () => {
  it("renders three pages with the athlete identity and headline scores", () => {
    const { container } = render(<TestReport data={base} />)
    expect(container.querySelectorAll(".report-page")).toHaveLength(3)
    expect(screen.getByText(/Marcus Johnson/)).toBeInTheDocument()
    expect(screen.getByText(/Basketball/)).toBeInTheDocument()
    expect(screen.getByText("The Headline Numbers")).toBeInTheDocument()
    expect(screen.getByText("The Full Verdict")).toBeInTheDocument()
    expect(screen.getByText(/Darren Paul/)).toBeInTheDocument()
  })

  it("shows testing content and NONE of the program/exercise content", () => {
    render(<TestReport data={base} />)
    expect(screen.getAllByText(/Countermovement Jump/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Mid-Season Testing/)).toBeInTheDocument()
    // The whole point of this report: no program, no badges, no volume, no streak.
    expect(screen.queryByText(/Current Program/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Training Load/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/streak/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Achievements/i)).not.toBeInTheDocument()
  })

  it("renders a coaching cue drawn from the weakest category", () => {
    render(<TestReport data={base} />)
    expect(screen.getByText(/Generated from this athlete/i)).toBeInTheDocument()
  })

  it("renders the no-tests state instead of three empty pages", () => {
    const { container } = render(
      <TestReport data={{ ...base, tests: [], assessments: [], testCount: 0, prCount: 0, monthsTracked: 0, asOf: null }} />,
    )
    expect(screen.getByText(/Marcus Johnson/)).toBeInTheDocument()
    expect(screen.getByText(/No tests logged yet/i)).toBeInTheDocument()
    expect(container.querySelectorAll(".report-page")).toHaveLength(1)
    expect(screen.queryByText("The Headline Numbers")).not.toBeInTheDocument()
  })

  it("drops the category comparison when only one category is scorable", () => {
    render(
      <TestReport
        data={{
          ...base,
          tests: [
            { testType: "cmj", resultValue: 50, resultUnit: "cm", customName: null, bodyWeightKg: 84, testDate: "2026-07-01", isPr: true },
          ],
        }}
      />,
    )
    expect(screen.queryByText(/Where you're strong/i)).not.toBeInTheDocument()
    expect(screen.getByText("The Headline Numbers")).toBeInTheDocument()
  })

  it("lists an unscorable custom test without inventing a score for it", () => {
    render(
      <TestReport
        data={{
          ...base,
          tests: [
            { testType: "custom", resultValue: 6.1, resultUnit: "s", customName: "Sled Push 20m", bodyWeightKg: null, testDate: "2026-07-01", isPr: false },
          ],
        }}
      />,
    )
    expect(screen.getByText(/Sled Push 20m/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/components/report/test-report.test.tsx`
Expected: FAIL — cannot resolve `@/components/public/report/TestReport`.

- [ ] **Step 3: Write `ReportCover.tsx`**

```tsx
import Image from "next/image"
import type { TestReportData } from "@/lib/test-report/data"
import { ReportPage } from "./panels/ReportPage"

function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Page 1 — identity, premise, and the three headline counts. */
export function ReportCover({ data, categoryCount }: { data: TestReportData; categoryCount: number }) {
  const fullName = `${data.name.first} ${data.name.last}`.trim()
  const subtitle = [data.sport, data.position, data.age ? `Age ${data.age}` : null].filter(Boolean).join(" · ")

  const lines: { n: number; text: string }[] = [
    { n: data.testCount, text: `tests logged across ${categoryCount} testing ${categoryCount === 1 ? "category" : "categories"}` },
    { n: data.prCount, text: "personal bests on record" },
    { n: data.monthsTracked, text: "months of tracked testing history" },
  ].filter((l) => l.n > 0)

  return (
    <ReportPage
      eyebrow="DJP Athlete · Performance Testing Report"
      footer={
        <div className="flex flex-wrap items-end justify-between gap-2">
          <span>
            Report for: <strong className="text-foreground">{fullName}</strong>
            {data.sport ? `, ${data.sport}` : ""} · {formatDate(data.asOf)}
          </span>
          <span>
            Prepared by <strong className="text-foreground">Darren Paul</strong>, Performance Coach
          </span>
        </div>
      }
    >
      <div className="grid gap-8 md:grid-cols-2 md:items-center">
        <div>
          <h1 className="font-heading text-5xl font-bold leading-tight md:text-6xl">{fullName}</h1>
          {subtitle && <p className="mt-3 font-mono text-xs uppercase tracking-wide text-primary">{subtitle}</p>}
          <p className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground">
            Every number in this report comes from a logged, dated test — measured the same way each time and
            tracked over the whole training block. No estimates, no self-reported figures.
          </p>
          <div className="mt-8 space-y-4">
            {lines.map((l) => (
              <div key={l.text} className="flex gap-4 border-l-2 border-primary pl-4">
                <span className="font-heading text-2xl font-bold">{l.n}</span>
                <span className="max-w-[16rem] self-center text-xs leading-snug text-muted-foreground">{l.text}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-border bg-surface">
          {data.avatarUrl ? (
            <Image src={data.avatarUrl} alt={fullName} fill sizes="(min-width: 768px) 40vw, 90vw" className="object-cover" />
          ) : (
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse 70% 50% at 70% 10%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 60%), radial-gradient(ellipse 60% 50% at 10% 90%, color-mix(in oklab, var(--primary) 30%, transparent), transparent 65%)",
              }}
            />
          )}
        </div>
      </div>
    </ReportPage>
  )
}
```

- [ ] **Step 4: Write `ReportHeadline.tsx`**

```tsx
import type { ReportScores } from "@/lib/test-report/scoring"
import { selectCue } from "@/lib/test-report/cues"
import { ReportPage } from "./panels/ReportPage"
import { KpiTile } from "./panels/KpiTile"
import { BandPill } from "./panels/BandPill"
import { ScoreBar } from "./panels/ScoreBar"
import { CueBlock } from "./panels/CueBlock"
import { CategoryChips } from "./panels/CategoryChips"
import { SectionHeading } from "./panels/SectionHeading"

/** Page 2 — the athlete's scores, where the gap is, and what to do about it. */
export function ReportHeadline({ scores, firstName }: { scores: ReportScores; firstName: string }) {
  const { athleteScore, categories, strongest, focus, biggestMover } = scores
  const cue = selectCue(focus)
  // With one category there is nothing to compare, and strongest === focus.
  const showComparison = categories.length > 1
  // Strongest, weakest, next-weakest — de-duplicated, so 2 categories give 2 cards.
  const breakdown = [...new Set([strongest, focus, categories[categories.length - 2] ?? null].filter(Boolean))].slice(0, 3)

  return (
    <ReportPage
      eyebrow={`${firstName} · Testing Snapshot`}
      title="The Headline Numbers"
      pageNumber="02"
      footer="DJP Athlete · Performance Testing Report · 02"
    >
      <div className="space-y-8">
        <div className="grid gap-3 sm:grid-cols-3">
          {athleteScore !== null && <KpiTile value={String(athleteScore)} unit="/100" label="Athlete Score" />}
          {strongest && (
            <KpiTile value={String(strongest.score)} unit="/100" label={`Strongest — ${strongest.category}`} />
          )}
          {showComparison && focus && (
            <KpiTile value={String(focus.score)} unit="/100" label={`Focus — ${focus.category}`} />
          )}
        </div>

        {showComparison && (
          <section className="space-y-3">
            <SectionHeading>Where you&apos;re strong and where you&apos;re not</SectionHeading>
            <div className="space-y-2 rounded-xl border border-border bg-card p-4">
              {categories.map((c) => (
                <ScoreBar key={c.category} label={c.category} score={c.score} />
              ))}
              {strongest && focus && (
                <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
                  {strongest.category} leads at {strongest.score}/100 while {focus.category} sits at {focus.score}/100
                  {" — a "}
                  {strongest.score - focus.score}-point spread. The lower of the two is where training time buys the
                  most.
                </p>
              )}
            </div>
          </section>
        )}

        {breakdown.length > 0 && (
          <section className="space-y-3">
            <SectionHeading>Category breakdown</SectionHeading>
            <div className="grid gap-3 sm:grid-cols-3">
              {breakdown.map((c) => (
                <div key={c!.category} className="rounded-xl border border-border border-t-2 border-t-primary bg-card p-4">
                  <p className="djp-eyebrow text-muted-foreground">{c!.category}</p>
                  <p className="mt-1 font-heading text-3xl font-bold">{c!.score}</p>
                  <div className="mt-2">
                    <BandPill band={c!.band} />
                  </div>
                  <p className="mt-2 text-xs leading-snug text-muted-foreground">
                    From {c!.testLabels.join(", ")}.
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {biggestMover && (
          <section className="space-y-3">
            <SectionHeading>Movement since last test</SectionHeading>
            <div
              className={`flex items-center gap-5 rounded-xl border p-5 ${
                biggestMover.deltaPct >= 0 ? "border-accent/40 bg-accent/5" : "border-[var(--error)]/40 bg-[var(--error)]/5"
              }`}
            >
              <span className="font-heading text-4xl font-bold">
                {biggestMover.deltaPct >= 0 ? "+" : ""}
                {biggestMover.deltaPct}%
              </span>
              <div>
                <p className="font-mono text-xs uppercase tracking-wide">{biggestMover.label}</p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  {biggestMover.deltaPct >= 0
                    ? "Biggest improvement between your last two tests of the same type."
                    : "Biggest drop between your last two tests of the same type — worth a look at recovery and testing conditions before reading too much into it."}
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="space-y-3">
          <SectionHeading>Testing categories covered</SectionHeading>
          <CategoryChips active={categories.map((c) => c.category)} />
        </section>

        {cue && <CueBlock cue={cue} />}
      </div>
    </ReportPage>
  )
}
```

- [ ] **Step 5: Add `SectionHeading` to the report panels**

Create `components/public/report/panels/SectionHeading.tsx` — the report needs its own copy so it does not import from the admin-only Arena tree:

```tsx
/** Mono eyebrow with a hairline out to the right edge. A real h3 so heading
 *  navigation reaches every section (the page title is the h2). */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <h3 className="djp-eyebrow shrink-0">{children}</h3>
      <div aria-hidden className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
    </div>
  )
}
```

- [ ] **Step 6: Write `ReportVerdict.tsx`**

```tsx
import type { ReportScores } from "@/lib/test-report/scoring"
import type { PublicAssessment } from "@/lib/profile-share/data"
import { ReportPage } from "./panels/ReportPage"
import { KpiTile } from "./panels/KpiTile"
import { RangeBar } from "./panels/RangeBar"
import { SectionHeading } from "./panels/SectionHeading"
import { Sparkline } from "@/components/public/athlete/Sparkline"

function formatDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Page 3 — every test, its trend, and the closing read. */
export function ReportVerdict({ scores, assessments }: { scores: ReportScores; assessments: PublicAssessment[] }) {
  const { tests, focus } = scores
  const headline = tests.slice(0, 4)

  return (
    <ReportPage
      eyebrow={`Performance Tests · ${tests.length} measured`}
      title="The Full Verdict"
      pageNumber="03"
      footer={
        <div className="flex flex-wrap items-end justify-between gap-2">
          <span>Every number here is a logged test — objective, individual, and repeatable.</span>
          <span>
            <strong className="text-foreground">Darren Paul</strong> — Performance Coach · darren@darrenjpaul.com
          </span>
        </div>
      }
    >
      <div className="space-y-8">
        {headline.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {headline.map((t) => (
              <KpiTile
                key={t.key}
                value={String(t.latest)}
                unit={t.unit}
                label={t.label}
                caption={t.score !== null ? `${t.score}/100 · ${formatDate(t.latestDate)}` : formatDate(t.latestDate)}
                isPr={t.isPr}
              />
            ))}
          </div>
        )}

        <section className="space-y-3">
          <SectionHeading>Test by test</SectionHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            {tests.map((t) => (
              <div key={t.key} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{t.label}</p>
                    <p className="mt-1 font-heading text-2xl font-bold">
                      {t.latest}
                      <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{t.unit}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    {t.deltaPct !== null && (
                      <p className={`font-mono text-xs ${t.deltaPct >= 0 ? "text-[var(--success)]" : "text-[var(--error)]"}`}>
                        {t.deltaPct >= 0 ? "↑" : "↓"} {Math.abs(t.deltaPct)}%
                      </p>
                    )}
                    <div className="mt-1 text-primary">
                      <Sparkline points={t.points} />
                    </div>
                  </div>
                </div>
                {t.score !== null && <RangeBar score={t.score} />}
                <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
                  Last tested {formatDate(t.latestDate)}
                  {t.isPr ? " · Personal best" : ""}
                </p>
              </div>
            ))}
          </div>
        </section>

        {assessments.length > 0 && (
          <section className="space-y-3">
            <SectionHeading>Assessment batteries</SectionHeading>
            <div className="space-y-3">
              {assessments.map((a) => (
                <div key={`${a.title}-${a.date}`} className="rounded-xl border border-border bg-card p-4">
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
              ))}
            </div>
          </section>
        )}

        {focus && (
          <div className="rounded-xl border border-primary/40 bg-card p-5">
            <p className="font-heading text-sm font-bold">
              One signal across your testing — <span className="text-primary">{focus.category.toLowerCase()}</span>
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {focus.category} scores {focus.score}/100 across {focus.testLabels.join(", ")}, the lowest of the
              categories tested. That is the area where the next block of training will show up fastest in these
              numbers — everything else is already carrying its weight.
            </p>
          </div>
        )}
      </div>
    </ReportPage>
  )
}
```

- [ ] **Step 7: Write `TestReport.tsx`**

```tsx
import type { TestReportData } from "@/lib/test-report/data"
import { buildReportScores } from "@/lib/test-report/scoring"
import { ReportCover } from "./ReportCover"
import { ReportHeadline } from "./ReportHeadline"
import { ReportVerdict } from "./ReportVerdict"
import { ReportPage } from "./panels/ReportPage"
import { ProfilePrintButton } from "@/components/public/athlete/ProfilePrintButton"

/**
 * The public athlete test report. `.athlete-arena` supplies the DJP dark
 * document palette (defined once in globals.css and shared with the admin Arena
 * card); `.test-report` adds the paged-print rules; `.print-document` strips app
 * chrome from the printed output.
 *
 * With no logged tests the report renders ONE honest page rather than three
 * skeletal ones — an empty premium document reads as broken, not premium.
 */
export function TestReport({ data }: { data: TestReportData }) {
  const scores = buildReportScores(data.tests)
  const fullName = `${data.name.first} ${data.name.last}`.trim()
  const hasTests = data.tests.length > 0

  return (
    <main className="athlete-arena test-report print-document min-h-screen bg-background font-body text-foreground">
      <ProfilePrintButton />
      <ReportCover data={data} categoryCount={scores.categories.length} />
      {hasTests ? (
        <>
          <ReportHeadline scores={scores} firstName={data.name.first} />
          <ReportVerdict scores={scores} assessments={data.assessments} />
        </>
      ) : (
        <div className="mx-auto max-w-2xl px-6 pb-16 text-center">
          <p className="font-heading text-lg font-bold">No tests logged yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {fullName}&apos;s testing report fills in as results are recorded. Check back after the next testing
            session.
          </p>
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run __tests__/components/report/test-report.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 9: Mutation-probe the exclusion test**

Temporarily render the string `Current Program` inside `ReportVerdict`. Re-run — the "NONE of the program/exercise content" test **must** fail. Restore.

- [ ] **Step 10: Commit**

```bash
git add components/public/report __tests__/components/report/test-report.test.tsx
git commit -m "feat(report): cover, headline numbers and full verdict pages"
```

---

### Task 6: Swap the public route, move the Arena card to admin, repoint every call-site

**Files:**
- Modify: `app/athlete/[token]/page.tsx` — render `TestReport` off `getTestReportData`
- Modify: `app/athlete/[token]/opengraph-image.tsx` — read from the new data layer
- Create: `app/(admin)/admin/clients/[id]/arena/page.tsx`
- Move: `components/public/athlete/**` → `components/admin/arena/**` (16 files)
- Modify: `components/public/report/ReportVerdict.tsx` + `TestReport.tsx` — update the two imports that pointed at the old path
- Modify: `components/admin/profile-share/AthleteProfileLinkDialog.tsx` — copy + thin-report warning
- Modify: `app/(admin)/admin/clients/[id]/page.tsx` — pass `testCount`, add an "Arena card" link
- Modify: `app/(client)/client/performance/page.tsx` — button copy
- Modify: `__tests__/components/athlete/athlete-profile-card.test.tsx` — import path
- Modify: `__tests__/components/athlete/athlete-profile-link-dialog.test.tsx` — new copy + warning assertion
- Test: `__tests__/app/athlete-report-route.test.ts`

**Interfaces:**
- Consumes: `getTestReportData` from `@/lib/test-report/data`; `TestReport` from `@/components/public/report/TestReport`; `getAthleteProfileData` from `@/lib/profile-share/data`; `AthleteProfileCard` from `@/components/admin/arena/AthleteProfileCard`.
- Produces: nothing new — this task rewires existing surfaces.

- [ ] **Step 1: Write the failing route test**

Create `__tests__/app/athlete-report-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/test-report/data", () => ({ getTestReportData: vi.fn() }))
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND") }) }))

import { getTestReportData } from "@/lib/test-report/data"
import { signAthleteProfileToken } from "@/lib/profile-share/token"
import AthleteProfilePage, { generateMetadata } from "@/app/athlete/[token]/page"

const data = {
  name: { first: "Marcus", last: "Johnson" },
  avatarUrl: null,
  sport: "Basketball",
  position: "Point Guard",
  age: 24,
  asOf: "2026-07-01",
  testCount: 2,
  prCount: 1,
  monthsTracked: 6,
  tests: [],
  assessments: [],
}

beforeEach(() => {
  vi.mocked(getTestReportData).mockResolvedValue(data as never)
})

describe("/athlete/[token]", () => {
  it("renders the test report for a valid token", async () => {
    const token = signAthleteProfileToken("u1")
    const el = await AthleteProfilePage({ params: Promise.resolve({ token }) })
    expect(el).toBeTruthy()
    expect(getTestReportData).toHaveBeenCalledWith("u1")
  })

  it("404s on a tampered token without ever hitting the database", async () => {
    const token = `${signAthleteProfileToken("u1")}tampered`
    await expect(AthleteProfilePage({ params: Promise.resolve({ token }) })).rejects.toThrow("NEXT_NOT_FOUND")
    expect(getTestReportData).not.toHaveBeenCalled()
  })

  it("titles the page as a test report and keeps it out of search engines", async () => {
    const token = signAthleteProfileToken("u1")
    const meta = await generateMetadata({ params: Promise.resolve({ token }) })
    expect(meta.title).toMatch(/Test Report/i)
    expect(meta.robots).toEqual({ index: false, follow: false })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/app/athlete-report-route.test.ts`
Expected: FAIL — the page still calls `getAthleteProfileData`, so the `getTestReportData` assertion fails and the title assertion fails.

- [ ] **Step 3: Move the Arena components**

```bash
git mv components/public/athlete components/admin/arena
```

Then update every import of `@/components/public/athlete/` to `@/components/admin/arena/`:

```bash
grep -rl "components/public/athlete" --include=*.tsx --include=*.ts . --exclude-dir=node_modules
```

Expected hits: the moved files' own sibling imports (relative, so unaffected), `__tests__/components/athlete/athlete-profile-card.test.tsx`, and the two report files created in Task 5. Fix each to `@/components/admin/arena/...`.

- [ ] **Step 4: Rewrite the public route**

Replace `app/athlete/[token]/page.tsx` with:

```tsx
import { cache } from "react"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { verifyAthleteProfileToken } from "@/lib/profile-share/token"
import { getTestReportData, type TestReportData } from "@/lib/test-report/data"
import { TestReport } from "@/components/public/report/TestReport"

export const dynamic = "force-dynamic"

// cache() dedupes the assembly between generateMetadata and the page render.
const resolveData = cache(async (token: string): Promise<TestReportData | null> => {
  const v = verifyAthleteProfileToken(token)
  if (!v.valid) return null
  return getTestReportData(v.clientUserId)
})

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const data = await resolveData(token)
  const robots = { index: false, follow: false }
  if (!data) return { title: "Test Report", robots }
  const name = `${data.name.first} ${data.name.last}`.trim()
  const description = [data.sport, data.position].filter(Boolean).join(" · ") || "Performance testing with DJP Athlete"
  return {
    title: `${name} — Test Report`,
    description,
    robots,
    openGraph: { title: `${name} — DJP Athlete Test Report`, description, type: "profile" },
    twitter: { card: "summary_large_image", title: `${name} — DJP Athlete Test Report`, description },
  }
}

export default async function AthleteProfilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const data = await resolveData(token)
  if (!data) notFound()
  return <TestReport data={data} />
}
```

- [ ] **Step 5: Point the OG image at the new data layer**

Open `app/athlete/[token]/opengraph-image.tsx`. Replace its `getAthleteProfileData` import and call with `getTestReportData` from `@/lib/test-report/data`, and replace any field it reads that no longer exists (`stats`, `badges`, `program`) with fields that do: `testCount`, `prCount`, `sport`, `position`. Keep the layout; only the data bindings change.

- [ ] **Step 6: Create the admin Arena page**

Create `app/(admin)/admin/clients/[id]/arena/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { auth } from "@/lib/auth"
import { getAthleteProfileData } from "@/lib/profile-share/data"
import { AthleteProfileCard } from "@/components/admin/arena/AthleteProfileCard"

export const dynamic = "force-dynamic"

/**
 * The Arena card, admin-only. It used to be the public share page; the public
 * link now serves the test report, and this stays as the coach's own full view
 * (training volume, streaks, badges, program) which is deliberately NOT in the
 * client-facing report.
 *
 * Middleware already gates /admin/*; the role check here is defence in depth so
 * the page cannot be reached if the matcher ever changes.
 */
export default async function AdminClientArenaPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/admin/clients")
  if (session.user.role !== "admin") notFound()

  const { id } = await params
  const data = await getAthleteProfileData(id)
  if (!data) notFound()

  return (
    <>
      <div className="px-4 pt-4 print:hidden">
        <Link
          href={`/admin/clients/${id}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to client
        </Link>
      </div>
      <AthleteProfileCard data={data} />
    </>
  )
}
```

- [ ] **Step 7: Update the share dialog**

In `components/admin/profile-share/AthleteProfileLinkDialog.tsx`: add a `testCount: number` prop, change the trigger label to `Share test report`, the title to `` `${first}'s test report` ``, and the description to explain it shows testing results. Add, directly above the QR image:

```tsx
{testCount < 3 && (
  <p className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-xs text-foreground">
    {first} has {testCount === 0 ? "no logged tests" : `only ${testCount} logged ${testCount === 1 ? "test" : "tests"}`}
    . The report will look thin — log more tests before sharing this.
  </p>
)}
```

- [ ] **Step 8: Wire the dialog prop and add the Arena link**

In `app/(admin)/admin/clients/[id]/page.tsx`:
- import `listByUser as listPerformanceTests` from `@/lib/db/performance-tests`, resolve `const perfTests = await listPerformanceTests(id).catch(() => [])` alongside the existing data fetches
- pass `testCount={perfTests.length}` to `<AthleteProfileLinkDialog />`
- immediately after that dialog in the Quick Actions row, add:

```tsx
<Link
  href={`/admin/clients/${id}/arena`}
  className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface/50 transition-colors"
>
  <LayoutDashboard className="size-4 text-primary" strokeWidth={1.5} />
  Arena card
</Link>
```

Add `LayoutDashboard` to the existing `lucide-react` import.

- [ ] **Step 9: Update the client-facing button**

In `app/(client)/client/performance/page.tsx`, change the button text from `My athlete card` to `My test report` and the `aria`/link label accordingly. The `cardUrl` line is unchanged — same token, same route.

- [ ] **Step 10: Update the two affected existing tests**

- `__tests__/components/athlete/athlete-profile-card.test.tsx`: change the import to `@/components/admin/arena/AthleteProfileCard`. No assertions change.
- `__tests__/components/athlete/athlete-profile-link-dialog.test.tsx`: add the required `testCount` prop to every render, update copy assertions to "test report", and add a case asserting the thin-report warning shows at `testCount={1}` and is absent at `testCount={5}`.

- [ ] **Step 11: Run the affected suites**

```bash
npx vitest run __tests__/app/athlete-report-route.test.ts __tests__/components/report __tests__/components/athlete __tests__/lib/test-report __tests__/lib/profile-share-token.test.ts
```

Expected: all PASS.

- [ ] **Step 12: Build**

Run: `npm run build`
Expected: exit 0. Confirm `/athlete/[token]` and `/admin/clients/[id]/arena` both appear in the route manifest printed by the build.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(report): serve the test report publicly, move the Arena card into admin"
```

---

## Self-Review

**Spec coverage.** §4.1 routing → Task 6. §4.2 modules → Tasks 1–5. §4.3 relocation → Task 6 step 3. §5 scoring incl. all three exclusion rules → Task 1. §6 three pages → Task 5. §7 cues → Task 2. §8 scrubbing → Task 3 (leak test). §9 degradation: zero-tests → Task 5 test 4; panels omitted → Tasks 4–5; one-category collapse → Task 5 test 5; dialog warning → Task 6 step 7; `allSettled` → Task 3. §10 phase-2 shaping → `RangeBar` `left`/`right`, tested in Task 4. §11 testing → each task's probe step.

**Deviation from the spec, recorded deliberately:** §5 said the delta "uses the stored `pct_change_from_prev` where present". Task 1 derives it from the series instead — the stored column is raw-signed and would need the direction flip applied anyway, and deriving keeps the number consistent with the sparkline beside it. `pctChangeFromPrev` is therefore absent from `ReportTestPoint`.

**Type consistency.** `ReportTestPoint` is defined once in `scoring.ts` and imported by `data.ts` — pure module owns the type so tests never pull Supabase. It is a structural superset of `RadarTestPoint`. `Band`, `CategoryScore`, `CATEGORY_ORDER` are defined in `scoring.ts` and consumed by `cues.ts` and the panels. `PublicAssessment` is imported from `lib/profile-share/data` in both `data.ts` and `ReportVerdict.tsx`. `SectionHeading` is duplicated into the report tree on purpose so the public report never imports from the admin tree.

**Known cosmetic risk to confirm in the browser:** the named `@page report { margin: 0 }` rule gives the report edge-to-edge printed pages. If a browser ignores named pages it falls back to the global `@page { margin: 1.5cm }` and the dark pages print inset in white — still legible, just not full-bleed.
