# Visualization & Engagement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Same ralph-loop execution pattern as Sub-1 and Sub-2.

**Goal:** Layer visual polish + engagement on top of the Sub-1/2 data foundation — body-map injury picker, athlete radar, training-streak heatmap, goals tracker, computed badges.

**Architecture:** One new table (`athlete_goals`). All other features compute live from existing tables. Pure modules in `lib/coach-intel/` (test-normalization, streak, check-goals) and `lib/badges/` are exhaustively unit-tested. Body map is an inlined SVG component used in both interactive picker and read-only display modes.

**Tech Stack:** Same as Sub-1/2 — Next.js 16, TS strict, Supabase, NextAuth v5, Tailwind v4, shadcn/ui, Recharts, RHF + Zod, Vitest, Playwright.

**Source spec:** [docs/superpowers/specs/2026-05-14-visualization-engagement-design.md](../specs/2026-05-14-visualization-engagement-design.md)

## Conventions

All conventions from Sub-1 apply — see [2026-05-13-athlete-performance-core.md](./2026-05-13-athlete-performance-core.md). Migration number `00134` reserved (confirm at apply time — bump if taken).

---

## File Structure

### New files

```
supabase/migrations/
  00134_athlete_goals.sql

lib/coach-intel/
  test-normalization.ts
  streak.ts
  check-goals.ts

lib/db/
  athlete-goals.ts

lib/validators/
  athlete-goal.ts

lib/badges/
  types.ts
  iron-streak.ts
  pr-machine.ts
  recovery-pro.ts
  consistent.ts
  index.ts

app/api/athlete-goals/route.ts
app/api/athlete-goals/[id]/route.ts
app/api/clients/[id]/profile/summary/route.ts

app/(client)/client/profile/page.tsx
app/(client)/client/goals/page.tsx

components/shared/body-map/
  body-map-svg.tsx
  body-map-picker.tsx
  body-map-display.tsx

components/client/profile/
  athlete-radar-card.tsx
  training-streak-heatmap.tsx
  badge-shelf-card.tsx
  open-goals-card.tsx
  log-goal-form.tsx
  goals-list.tsx

__tests__/lib/coach-intel/
  test-normalization.test.ts
  streak.test.ts
  check-goals.test.ts
__tests__/lib/badges/
  iron-streak.test.ts
  pr-machine.test.ts
  recovery-pro.test.ts
  consistent.test.ts
__tests__/lib/db/
  athlete-goals.test.ts
__tests__/lib/validators/
  athlete-goal.test.ts
__tests__/e2e/
  visualization-engagement.spec.ts
```

### Modified files

- `types/database.ts` — append `AthleteGoal`, `GoalMetricKind`, `GoalDirection`, `GoalStatus`, `Badge`, `BadgeTier`
- `components/client/performance/report-injury-form.tsx` — replace body_region Select with `<BodyMapPicker>`
- `components/admin/performance/athlete-performance-hub.tsx` — add Profile tab, add `BodyMapDisplay` above InjuryTimelineList on Injuries tab
- `app/api/performance-tests/route.ts` — call `checkGoals` after insert
- `app/api/readiness/route.ts` — call `checkGoals` after insert
- `app/api/training-sessions/route.ts` — call `checkGoals` after insert

---

## Phase 1 — Migration + Goals Foundation

### Task 1.1: Migration `00134_athlete_goals.sql` + types

**Files:**
- Create: `supabase/migrations/00134_athlete_goals.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS athlete_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_kind TEXT NOT NULL CHECK (metric_kind IN ('test','readiness','weekly_load')),
  test_type TEXT,
  target_value NUMERIC(8,3) NOT NULL,
  target_unit TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('higher','lower')),
  start_value NUMERIC(8,3),
  deadline DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','achieved','missed','archived')),
  achieved_at DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT test_type_required_for_test_kind
    CHECK (metric_kind <> 'test' OR test_type IS NOT NULL),
  CONSTRAINT lower_direction_only_for_test
    CHECK (direction <> 'lower' OR metric_kind = 'test')
);

CREATE INDEX idx_athlete_goals_user ON athlete_goals(client_user_id);
CREATE INDEX idx_athlete_goals_user_status ON athlete_goals(client_user_id, status);

CREATE TRIGGER set_athlete_goals_updated_at
  BEFORE UPDATE ON athlete_goals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE athlete_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage athlete goals"
  ON athlete_goals FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Clients can view own goals"
  ON athlete_goals FOR SELECT TO authenticated
  USING (client_user_id = auth.uid());

CREATE POLICY "Clients can insert own goals"
  ON athlete_goals FOR INSERT TO authenticated
  WITH CHECK (client_user_id = auth.uid());

CREATE POLICY "Clients can update own goals"
  ON athlete_goals FOR UPDATE TO authenticated
  USING (client_user_id = auth.uid());
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `00134_athlete_goals`. If 00134 is already taken (parallel ads-agent ralph), bump to next free number and update the file name + this plan.

- [ ] **Step 3: Append types**

```typescript
// types/database.ts — append after RiskFlag types

export type GoalMetricKind = "test" | "readiness" | "weekly_load"
export type GoalDirection = "higher" | "lower"
export type GoalStatus = "active" | "achieved" | "missed" | "archived"

export interface AthleteGoal {
  id: string
  client_user_id: string
  metric_kind: GoalMetricKind
  test_type: string | null // TestType when metric_kind='test'
  target_value: number
  target_unit: string
  direction: GoalDirection
  start_value: number | null
  deadline: string | null
  status: GoalStatus
  achieved_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type BadgeTier = "bronze" | "silver" | "gold"

export interface Badge {
  id: string
  name: string
  description: string
  icon: string // lucide icon name
  tier: BadgeTier
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00134_athlete_goals.sql types/database.ts
git commit -m "feat(viz): athlete_goals table + types"
```

---

### Task 1.2: Goals validator + DAL

**Files:**
- Create: `lib/validators/athlete-goal.ts`
- Create: `lib/db/athlete-goals.ts`
- Test: `__tests__/lib/validators/athlete-goal.test.ts`
- Test: `__tests__/lib/db/athlete-goals.test.ts`

- [ ] **Step 1: Write the validator**

```typescript
// lib/validators/athlete-goal.ts
import { z } from "zod"
import { TEST_TYPES } from "./performance-test"

export const GOAL_METRIC_KINDS = ["test", "readiness", "weekly_load"] as const
export const GOAL_DIRECTIONS = ["higher", "lower"] as const
export const GOAL_STATUSES = ["active", "achieved", "missed", "archived"] as const

export const GOAL_METRIC_KIND_LABELS: Record<(typeof GOAL_METRIC_KINDS)[number], string> = {
  test: "Performance test",
  readiness: "Daily readiness score",
  weekly_load: "Weekly training load",
}

export const athleteGoalFormSchema = z
  .object({
    metric_kind: z.enum(GOAL_METRIC_KINDS),
    test_type: z.enum(TEST_TYPES).nullable(),
    target_value: z.number(),
    target_unit: z.string().min(1).max(20),
    direction: z.enum(GOAL_DIRECTIONS),
    start_value: z.number().nullable(),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    notes: z.string().max(1000).nullable(),
  })
  .refine((d) => !(d.metric_kind === "test" && !d.test_type), {
    message: "test_type required when metric_kind='test'",
    path: ["test_type"],
  })
  .refine((d) => !(d.direction === "lower" && d.metric_kind !== "test"), {
    message: "lower direction is only valid for test metric_kind",
    path: ["direction"],
  })

export type AthleteGoalFormData = z.infer<typeof athleteGoalFormSchema>
```

- [ ] **Step 2: Write validator tests**

```typescript
// __tests__/lib/validators/athlete-goal.test.ts
import { describe, it, expect } from "vitest"
import { athleteGoalFormSchema } from "@/lib/validators/athlete-goal"

const valid = {
  metric_kind: "test" as const,
  test_type: "drop_jump" as const,
  target_value: 40,
  target_unit: "cm",
  direction: "higher" as const,
  start_value: 35,
  deadline: "2026-08-01",
  notes: null,
}

describe("athleteGoalFormSchema", () => {
  it("accepts a valid test goal", () => {
    expect(athleteGoalFormSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects metric_kind='test' without test_type", () => {
    expect(
      athleteGoalFormSchema.safeParse({ ...valid, test_type: null }).success,
    ).toBe(false)
  })

  it("rejects direction='lower' for non-test metric", () => {
    expect(
      athleteGoalFormSchema.safeParse({
        ...valid,
        metric_kind: "readiness",
        test_type: null,
        direction: "lower",
      }).success,
    ).toBe(false)
  })

  it("accepts readiness goal with higher direction", () => {
    expect(
      athleteGoalFormSchema.safeParse({
        ...valid,
        metric_kind: "readiness",
        test_type: null,
        direction: "higher",
        target_unit: "score",
      }).success,
    ).toBe(true)
  })
})
```

- [ ] **Step 3: Write the DAL**

```typescript
// lib/db/athlete-goals.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { AthleteGoal, GoalStatus, GoalMetricKind } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listByUser(
  clientUserId: string,
  opts: { status?: GoalStatus; metricKind?: GoalMetricKind } = {},
) {
  const supabase = getClient()
  let q = supabase.from("athlete_goals").select("*").eq("client_user_id", clientUserId)
  if (opts.status) q = q.eq("status", opts.status)
  if (opts.metricKind) q = q.eq("metric_kind", opts.metricKind)
  const { data, error } = await q.order("created_at", { ascending: false })
  if (error) throw error
  return data as AthleteGoal[]
}

export async function getActive(clientUserId: string) {
  return listByUser(clientUserId, { status: "active" })
}

export async function getById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("athlete_goals")
    .select("*")
    .eq("id", id)
    .single()
  if (error) return null
  return data as AthleteGoal
}

export async function create(
  clientUserId: string,
  payload: Omit<AthleteGoal, "id" | "client_user_id" | "status" | "achieved_at" | "created_at" | "updated_at">,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("athlete_goals")
    .insert({ client_user_id: clientUserId, status: "active", achieved_at: null, ...payload })
    .select()
    .single()
  if (error) throw error
  return data as AthleteGoal
}

export async function update(
  id: string,
  patch: Partial<Omit<AthleteGoal, "id" | "client_user_id" | "created_at" | "updated_at">>,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("athlete_goals")
    .update(patch)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as AthleteGoal
}

export async function markAchieved(id: string, achievedAt: string) {
  return update(id, { status: "achieved", achieved_at: achievedAt })
}

export async function archive(id: string) {
  return update(id, { status: "archived" })
}
```

- [ ] **Step 4: Write DAL tests**

```typescript
// __tests__/lib/db/athlete-goals.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const supabaseMock = { from: vi.fn() }
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => supabaseMock }))

import { markAchieved } from "@/lib/db/athlete-goals"

beforeEach(() => vi.clearAllMocks())

describe("athlete-goals DAL", () => {
  it("markAchieved sets status='achieved' + achieved_at", async () => {
    const updateFn = vi.fn().mockReturnValue({
      eq: () => ({ select: () => ({ single: () => ({ data: { id: "g1" }, error: null }) }) }),
    })
    supabaseMock.from.mockReturnValue({ update: updateFn })
    await markAchieved("g1", "2026-05-14")
    expect(updateFn).toHaveBeenCalledWith({ status: "achieved", achieved_at: "2026-05-14" })
  })
})
```

- [ ] **Step 5: Run tests + commit**

Run: `npm run test:run -- __tests__/lib/validators/athlete-goal.test.ts __tests__/lib/db/athlete-goals.test.ts`
Expected: all pass (5 tests).

```bash
git add lib/validators/athlete-goal.ts lib/db/athlete-goals.ts __tests__/lib/validators/athlete-goal.test.ts __tests__/lib/db/athlete-goals.test.ts
git commit -m "feat(viz): athlete-goal validator + DAL"
```

---

## Phase 2 — Pure modules

### Task 2.1: `test-normalization.ts` + tests

**Files:**
- Create: `lib/coach-intel/test-normalization.ts`
- Test: `__tests__/lib/coach-intel/test-normalization.test.ts`

- [ ] **Step 1: Write the module**

```typescript
// lib/coach-intel/test-normalization.ts
import type { TestType } from "@/types/database"

interface Range {
  min: number
  max: number
  direction: "higher" | "lower"
  /** When true, normalize value/body_weight_kg before clamping */
  relativeToBodyWeight?: boolean
}

// Common-sense starting reference ranges. Tunable per file.
const REFERENCE_RANGES: Partial<Record<TestType, Range>> = {
  drop_jump: { min: 20, max: 60, direction: "higher" },
  cmj: { min: 25, max: 65, direction: "higher" },
  squat_jump: { min: 22, max: 55, direction: "higher" },
  broad_jump: { min: 180, max: 320, direction: "higher" },
  sprint_10m: { min: 1.5, max: 2.5, direction: "lower" },
  sprint_20m: { min: 2.5, max: 4.2, direction: "lower" },
  sprint_40m: { min: 4.5, max: 7.0, direction: "lower" },
  sprint_5_10_5: { min: 4.0, max: 6.5, direction: "lower" },
  t_test: { min: 9.0, max: 14.0, direction: "lower" },
  beep_test: { min: 5, max: 14, direction: "higher" },
  sit_reach: { min: 0, max: 40, direction: "higher" },
  bench_press_1rm: { min: 0.5, max: 2.0, direction: "higher", relativeToBodyWeight: true },
  back_squat_1rm: { min: 0.5, max: 2.5, direction: "higher", relativeToBodyWeight: true },
  deadlift_1rm: { min: 0.5, max: 3.0, direction: "higher", relativeToBodyWeight: true },
  pull_up_max: { min: 0, max: 25, direction: "higher" },
  push_up_max: { min: 10, max: 80, direction: "higher" },
  plank_hold: { min: 30, max: 240, direction: "higher" },
}

export type RadarCategory = "Speed" | "Power" | "Strength" | "Endurance" | "Mobility"

export const RADAR_CATEGORIES: Record<RadarCategory, TestType[]> = {
  Speed: ["sprint_10m", "sprint_20m", "sprint_40m", "sprint_5_10_5", "t_test"],
  Power: ["drop_jump", "cmj", "squat_jump", "broad_jump"],
  Strength: ["bench_press_1rm", "back_squat_1rm", "deadlift_1rm", "pull_up_max", "push_up_max"],
  Endurance: ["beep_test", "plank_hold"],
  Mobility: ["sit_reach"],
}

export function normalize(
  testType: TestType,
  value: number,
  bodyWeightKg?: number | null,
): number | null {
  const r = REFERENCE_RANGES[testType]
  if (!r) return null
  let v = value
  if (r.relativeToBodyWeight) {
    if (!bodyWeightKg || bodyWeightKg <= 0) return null
    v = value / bodyWeightKg
  }
  const clamped = Math.max(r.min, Math.min(r.max, v))
  const pct = (clamped - r.min) / (r.max - r.min)
  return Math.round((r.direction === "higher" ? pct : 1 - pct) * 100)
}
```

- [ ] **Step 2: Write tests**

```typescript
// __tests__/lib/coach-intel/test-normalization.test.ts
import { describe, it, expect } from "vitest"
import { normalize, RADAR_CATEGORIES } from "@/lib/coach-intel/test-normalization"

describe("normalize", () => {
  it("drop_jump 60cm = 100 (max of higher-is-better)", () => {
    expect(normalize("drop_jump", 60)).toBe(100)
  })
  it("drop_jump 20cm = 0 (min)", () => {
    expect(normalize("drop_jump", 20)).toBe(0)
  })
  it("sprint_10m 1.5s = 100 (min of lower-is-better)", () => {
    expect(normalize("sprint_10m", 1.5)).toBe(100)
  })
  it("sprint_10m 2.5s = 0 (max of lower-is-better)", () => {
    expect(normalize("sprint_10m", 2.5)).toBe(0)
  })
  it("clamps values outside the range", () => {
    expect(normalize("drop_jump", 100)).toBe(100)
    expect(normalize("drop_jump", 0)).toBe(0)
  })
  it("bench_press_1rm 80kg @ 80kg bw = 1.0x bw → mid-range", () => {
    const r = normalize("bench_press_1rm", 80, 80)
    expect(r).not.toBeNull()
    expect(r! >= 25 && r! <= 50).toBe(true)
  })
  it("returns null when relativeToBodyWeight test has no bodyweight", () => {
    expect(normalize("bench_press_1rm", 80)).toBeNull()
  })

  it("RADAR_CATEGORIES covers all 5 axes", () => {
    expect(Object.keys(RADAR_CATEGORIES)).toEqual([
      "Speed",
      "Power",
      "Strength",
      "Endurance",
      "Mobility",
    ])
  })
})
```

- [ ] **Step 3: Run + commit**

Run: `npm run test:run -- __tests__/lib/coach-intel/test-normalization.test.ts`
Expected: 8 passing tests.

```bash
git add lib/coach-intel/test-normalization.ts __tests__/lib/coach-intel/test-normalization.test.ts
git commit -m "feat(viz): test-normalization for radar (0-100 per test)"
```

---

### Task 2.2: `streak.ts` + tests

**Files:**
- Create: `lib/coach-intel/streak.ts`
- Test: `__tests__/lib/coach-intel/streak.test.ts`

- [ ] **Step 1: Write the module**

```typescript
// lib/coach-intel/streak.ts
import type { DailyLoad } from "./load"

export function currentStreak(daily: DailyLoad[], today: string): number {
  // Walk backwards from today; count consecutive days with load > 0
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date))
  const byDate = new Map(sorted.map((d) => [d.date, d.load]))
  let streak = 0
  const cursor = new Date(today + "T00:00:00Z")
  while (true) {
    const iso = cursor.toISOString().slice(0, 10)
    const load = byDate.get(iso) ?? 0
    if (load <= 0) break
    streak += 1
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return streak
}

export function longestStreak(daily: DailyLoad[]): number {
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date))
  let longest = 0
  let run = 0
  let prevDate: string | null = null
  for (const d of sorted) {
    const isConsecutive =
      prevDate !== null &&
      new Date(d.date + "T00:00:00Z").getTime() -
        new Date(prevDate + "T00:00:00Z").getTime() ===
        86_400_000
    if (d.load > 0) {
      run = isConsecutive ? run + 1 : 1
      longest = Math.max(longest, run)
    } else {
      run = 0
    }
    prevDate = d.date
  }
  return longest
}
```

- [ ] **Step 2: Write tests**

```typescript
// __tests__/lib/coach-intel/streak.test.ts
import { describe, it, expect } from "vitest"
import { currentStreak, longestStreak } from "@/lib/coach-intel/streak"

describe("currentStreak", () => {
  it("counts consecutive non-zero days ending today", () => {
    const daily = [
      { date: "2026-05-12", load: 300 },
      { date: "2026-05-13", load: 200 },
      { date: "2026-05-14", load: 400 },
    ]
    expect(currentStreak(daily, "2026-05-14")).toBe(3)
  })

  it("returns 0 when today has no load", () => {
    const daily = [
      { date: "2026-05-12", load: 300 },
      { date: "2026-05-13", load: 200 },
    ]
    expect(currentStreak(daily, "2026-05-14")).toBe(0)
  })

  it("breaks on the first zero-day going backwards", () => {
    const daily = [
      { date: "2026-05-11", load: 100 },
      { date: "2026-05-13", load: 200 }, // 12 missing = 0
      { date: "2026-05-14", load: 300 },
    ]
    expect(currentStreak(daily, "2026-05-14")).toBe(2)
  })
})

describe("longestStreak", () => {
  it("finds the longest consecutive non-zero run", () => {
    const daily = [
      { date: "2026-05-01", load: 100 },
      { date: "2026-05-02", load: 100 },
      { date: "2026-05-04", load: 100 },
      { date: "2026-05-05", load: 100 },
      { date: "2026-05-06", load: 100 },
    ]
    expect(longestStreak(daily)).toBe(3)
  })

  it("returns 0 when no days have load", () => {
    expect(longestStreak([{ date: "2026-05-01", load: 0 }])).toBe(0)
  })
})
```

- [ ] **Step 3: Run + commit**

Run: `npm run test:run -- __tests__/lib/coach-intel/streak.test.ts`
Expected: 5 passing tests.

```bash
git add lib/coach-intel/streak.ts __tests__/lib/coach-intel/streak.test.ts
git commit -m "feat(viz): current+longest training streak"
```

---

### Task 2.3: `check-goals.ts` + tests

**Files:**
- Create: `lib/coach-intel/check-goals.ts`
- Test: `__tests__/lib/coach-intel/check-goals.test.ts`

- [ ] **Step 1: Write the module**

```typescript
// lib/coach-intel/check-goals.ts
import { getActive, markAchieved } from "@/lib/db/athlete-goals"
import type { AthleteGoal, TestType } from "@/types/database"

export interface GoalContext {
  testType?: TestType
  testValue?: number
  readinessScore?: number
  weeklyLoad?: number
}

function isSatisfied(goal: AthleteGoal, ctx: GoalContext): boolean {
  if (goal.metric_kind === "test") {
    if (!ctx.testType || ctx.testValue === undefined) return false
    if (goal.test_type !== ctx.testType) return false
    return goal.direction === "higher"
      ? ctx.testValue >= goal.target_value
      : ctx.testValue <= goal.target_value
  }
  if (goal.metric_kind === "readiness") {
    if (ctx.readinessScore === undefined) return false
    return ctx.readinessScore >= goal.target_value
  }
  if (goal.metric_kind === "weekly_load") {
    if (ctx.weeklyLoad === undefined) return false
    return ctx.weeklyLoad >= goal.target_value
  }
  return false
}

export async function checkGoals(
  clientUserId: string,
  ctx: GoalContext,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<AthleteGoal[]> {
  const active = await getActive(clientUserId)
  const achieved: AthleteGoal[] = []
  for (const g of active) {
    if (isSatisfied(g, ctx)) {
      const updated = await markAchieved(g.id, today)
      achieved.push(updated)
    }
  }
  return achieved
}
```

- [ ] **Step 2: Write tests**

```typescript
// __tests__/lib/coach-intel/check-goals.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/athlete-goals", () => ({
  getActive: vi.fn(),
  markAchieved: vi.fn(),
}))

import * as agDal from "@/lib/db/athlete-goals"
import { checkGoals } from "@/lib/coach-intel/check-goals"

beforeEach(() => vi.clearAllMocks())

describe("checkGoals", () => {
  it("marks a test goal achieved when value meets target (higher direction)", async () => {
    ;(agDal.getActive as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "g1",
        metric_kind: "test",
        test_type: "drop_jump",
        target_value: 40,
        direction: "higher",
      },
    ])
    ;(agDal.markAchieved as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "g1",
      status: "achieved",
    })
    const r = await checkGoals(
      "u1",
      { testType: "drop_jump", testValue: 42 },
      "2026-05-14",
    )
    expect(r).toHaveLength(1)
    expect(agDal.markAchieved).toHaveBeenCalledWith("g1", "2026-05-14")
  })

  it("does NOT mark when value falls short (higher direction)", async () => {
    ;(agDal.getActive as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "g1",
        metric_kind: "test",
        test_type: "drop_jump",
        target_value: 40,
        direction: "higher",
      },
    ])
    const r = await checkGoals("u1", { testType: "drop_jump", testValue: 38 })
    expect(r).toEqual([])
    expect(agDal.markAchieved).not.toHaveBeenCalled()
  })

  it("respects lower direction for sprint goals", async () => {
    ;(agDal.getActive as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "g1",
        metric_kind: "test",
        test_type: "sprint_10m",
        target_value: 2.0,
        direction: "lower",
      },
    ])
    ;(agDal.markAchieved as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "g1" })
    const r = await checkGoals("u1", { testType: "sprint_10m", testValue: 1.95 })
    expect(r).toHaveLength(1)
  })

  it("readiness goal achieved when readiness_score meets target", async () => {
    ;(agDal.getActive as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "g2",
        metric_kind: "readiness",
        test_type: null,
        target_value: 80,
        direction: "higher",
      },
    ])
    ;(agDal.markAchieved as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "g2" })
    const r = await checkGoals("u1", { readinessScore: 85 })
    expect(r).toHaveLength(1)
  })

  it("weekly_load goal achieved when weeklyLoad meets target", async () => {
    ;(agDal.getActive as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "g3",
        metric_kind: "weekly_load",
        test_type: null,
        target_value: 2500,
        direction: "higher",
      },
    ])
    ;(agDal.markAchieved as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "g3" })
    const r = await checkGoals("u1", { weeklyLoad: 2600 })
    expect(r).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run + commit**

Run: `npm run test:run -- __tests__/lib/coach-intel/check-goals.test.ts`
Expected: 5 passing tests.

```bash
git add lib/coach-intel/check-goals.ts __tests__/lib/coach-intel/check-goals.test.ts
git commit -m "feat(viz): check-goals achievement evaluator"
```

---

### Task 2.4: Wire `checkGoals` into the three write endpoints

**Files:**
- Modify: `app/api/performance-tests/route.ts`
- Modify: `app/api/readiness/route.ts`
- Modify: `app/api/training-sessions/route.ts`

- [ ] **Step 1: Update performance-tests POST**

In `app/api/performance-tests/route.ts`, after the `create()` call, insert:

```typescript
import { checkGoals } from "@/lib/coach-intel/check-goals"

// ... existing imports + POST handler ...

const test = await create(clientUserId, parsed.data, session.user.id)

try {
  await checkGoals(clientUserId, {
    testType: test.test_type,
    testValue: test.result_value,
  })
} catch (e) {
  console.error("[performance-tests] checkGoals failed", e)
}

return NextResponse.json({ test })
```

- [ ] **Step 2: Update readiness POST**

In `app/api/readiness/route.ts`, after the existing `runEvaluation` block, add:

```typescript
import { checkGoals } from "@/lib/coach-intel/check-goals"

// ... after runEvaluation try/catch ...

try {
  await checkGoals(targetUserId, { readinessScore: result.readiness_score })
} catch (e) {
  console.error("[readiness] checkGoals failed", e)
}
```

- [ ] **Step 3: Update training-sessions POST**

In `app/api/training-sessions/route.ts`, compute the current week's total and call `checkGoals`. After the `runEvaluation` try/catch, add:

```typescript
import { listByUser as listSessions } from "@/lib/db/training-sessions"
import { checkGoals } from "@/lib/coach-intel/check-goals"

// ... after runEvaluation try/catch ...

try {
  // Compute current week (last 7 days) total load
  const today = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10)
  const sessions = await listSessions(clientUserId, { from, to: today })
  const weeklyLoad = sessions.reduce((a, s) => a + s.session_load, 0)
  await checkGoals(clientUserId, { weeklyLoad })
} catch (e) {
  console.error("[training-sessions] checkGoals failed", e)
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/performance-tests/route.ts app/api/readiness/route.ts app/api/training-sessions/route.ts
git commit -m "feat(viz): trigger checkGoals after readiness/training/test writes"
```

---

## Phase 3 — Badges

### Task 3.1: Badge types + 4 rule files + index

**Files:**
- Create: `lib/badges/types.ts`
- Create: `lib/badges/iron-streak.ts`
- Create: `lib/badges/pr-machine.ts`
- Create: `lib/badges/recovery-pro.ts`
- Create: `lib/badges/consistent.ts`
- Create: `lib/badges/index.ts`
- Test: `__tests__/lib/badges/iron-streak.test.ts`
- Test: `__tests__/lib/badges/pr-machine.test.ts`
- Test: `__tests__/lib/badges/recovery-pro.test.ts`
- Test: `__tests__/lib/badges/consistent.test.ts`

- [ ] **Step 1: `lib/badges/types.ts`**

```typescript
import type { Badge } from "@/types/database"
import type { DailyLoad } from "@/lib/coach-intel/load"
import type { PerformanceTest, DailyReadiness } from "@/types/database"

export interface BadgeInput {
  asOf: string
  dailyLoads: DailyLoad[]
  tests: PerformanceTest[]
  readiness: DailyReadiness[]
  monthlyCompliancePct: number | null // last calendar month
}

export type BadgeRule = (input: BadgeInput) => Badge | null

export type { Badge }
```

- [ ] **Step 2: `lib/badges/iron-streak.ts`**

```typescript
import type { BadgeRule } from "./types"
import { currentStreak } from "@/lib/coach-intel/streak"

export const ironStreak: BadgeRule = (input) => {
  const streak = currentStreak(input.dailyLoads, input.asOf)
  if (streak < 30) return null
  const tier = streak >= 100 ? "gold" : streak >= 60 ? "silver" : "bronze"
  return {
    id: "iron_streak",
    name: "Iron Streak",
    description: `${streak} consecutive training days`,
    icon: "Flame",
    tier,
  }
}
```

- [ ] **Step 3: `lib/badges/pr-machine.ts`**

```typescript
import type { BadgeRule } from "./types"

export const prMachine: BadgeRule = (input) => {
  const since = new Date(input.asOf + "T00:00:00Z")
  since.setUTCDate(since.getUTCDate() - 30)
  const sinceStr = since.toISOString().slice(0, 10)
  const recentPrs = input.tests.filter((t) => t.is_pr && t.test_date >= sinceStr)
  if (recentPrs.length < 3) return null
  return {
    id: "pr_machine",
    name: "PR Machine",
    description: `${recentPrs.length} PRs in the last 30 days`,
    icon: "Trophy",
    tier: recentPrs.length >= 6 ? "gold" : recentPrs.length >= 4 ? "silver" : "bronze",
  }
}
```

- [ ] **Step 4: `lib/badges/recovery-pro.ts`**

```typescript
import type { BadgeRule } from "./types"

export const recoveryPro: BadgeRule = (input) => {
  const since = new Date(input.asOf + "T00:00:00Z")
  since.setUTCDate(since.getUTCDate() - 13)
  const sinceStr = since.toISOString().slice(0, 10)
  const window = input.readiness.filter((r) => r.date >= sinceStr && r.date <= input.asOf)
  if (window.length < 14) return null
  if (!window.every((r) => r.readiness_score >= 80)) return null
  return {
    id: "recovery_pro",
    name: "Recovery Pro",
    description: "Readiness ≥ 80 for 14 consecutive days",
    icon: "Heart",
    tier: "silver",
  }
}
```

- [ ] **Step 5: `lib/badges/consistent.ts`**

```typescript
import type { BadgeRule } from "./types"

export const consistent: BadgeRule = (input) => {
  if (input.monthlyCompliancePct === null) return null
  if (input.monthlyCompliancePct < 90) return null
  return {
    id: "consistent",
    name: "Consistent",
    description: `${input.monthlyCompliancePct}% program compliance last month`,
    icon: "CheckCircle2",
    tier: input.monthlyCompliancePct === 100 ? "gold" : "silver",
  }
}
```

- [ ] **Step 6: `lib/badges/index.ts`**

```typescript
import { ironStreak } from "./iron-streak"
import { prMachine } from "./pr-machine"
import { recoveryPro } from "./recovery-pro"
import { consistent } from "./consistent"
import type { Badge, BadgeInput } from "./types"

const RULES = [ironStreak, prMachine, recoveryPro, consistent] as const

export function computeBadges(input: BadgeInput): Badge[] {
  return RULES.map((r) => r(input)).filter((b): b is Badge => b !== null)
}

export type { Badge, BadgeInput } from "./types"
```

- [ ] **Step 7: Write tests**

```typescript
// __tests__/lib/badges/iron-streak.test.ts
import { describe, it, expect } from "vitest"
import { ironStreak } from "@/lib/badges/iron-streak"

describe("ironStreak", () => {
  it("fires bronze at 30+ consecutive training days", () => {
    const daily = Array.from({ length: 35 }, (_, i) => {
      const d = new Date("2026-05-14T00:00:00Z")
      d.setUTCDate(d.getUTCDate() - i)
      return { date: d.toISOString().slice(0, 10), load: 100 }
    })
    const r = ironStreak({
      asOf: "2026-05-14",
      dailyLoads: daily,
      tests: [],
      readiness: [],
      monthlyCompliancePct: null,
    })
    expect(r).not.toBeNull()
    expect(r?.tier).toBe("bronze")
  })

  it("returns null at 29 days", () => {
    const daily = Array.from({ length: 29 }, (_, i) => {
      const d = new Date("2026-05-14T00:00:00Z")
      d.setUTCDate(d.getUTCDate() - i)
      return { date: d.toISOString().slice(0, 10), load: 100 }
    })
    const r = ironStreak({
      asOf: "2026-05-14",
      dailyLoads: daily,
      tests: [],
      readiness: [],
      monthlyCompliancePct: null,
    })
    expect(r).toBeNull()
  })
})
```

```typescript
// __tests__/lib/badges/pr-machine.test.ts
import { describe, it, expect } from "vitest"
import { prMachine } from "@/lib/badges/pr-machine"
import type { PerformanceTest } from "@/types/database"

function pr(date: string): PerformanceTest {
  return {
    id: "x",
    client_user_id: "u",
    created_by: "u",
    test_type: "drop_jump",
    custom_name: null,
    result_value: 0,
    result_unit: "cm",
    trial_values: null,
    best_method: "highest",
    test_date: date,
    body_weight_kg: null,
    notes: null,
    video_url: null,
    is_pr: true,
    pct_change_from_prev: null,
    created_at: "",
    updated_at: "",
  }
}

describe("prMachine", () => {
  it("fires when 3+ PRs in the last 30 days", () => {
    const r = prMachine({
      asOf: "2026-05-14",
      dailyLoads: [],
      tests: [pr("2026-05-01"), pr("2026-05-05"), pr("2026-05-10")],
      readiness: [],
      monthlyCompliancePct: null,
    })
    expect(r).not.toBeNull()
  })

  it("returns null with only 2 PRs", () => {
    const r = prMachine({
      asOf: "2026-05-14",
      dailyLoads: [],
      tests: [pr("2026-05-01"), pr("2026-05-05")],
      readiness: [],
      monthlyCompliancePct: null,
    })
    expect(r).toBeNull()
  })
})
```

```typescript
// __tests__/lib/badges/recovery-pro.test.ts
import { describe, it, expect } from "vitest"
import { recoveryPro } from "@/lib/badges/recovery-pro"
import type { DailyReadiness } from "@/types/database"

function readiness(date: string, score: number): DailyReadiness {
  return {
    id: "x",
    client_user_id: "u",
    date,
    sleep_hours: null,
    sleep_quality: 5,
    soreness_overall: 1,
    soreness_by_region: {},
    fatigue: 1,
    mood: 5,
    stress: 1,
    hydration: 5,
    resting_hr: null,
    hrv_ms: null,
    notes: null,
    readiness_score: score,
    created_at: "",
    updated_at: "",
  }
}

describe("recoveryPro", () => {
  it("fires when 14 consecutive days have readiness ≥ 80", () => {
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date("2026-05-14T00:00:00Z")
      d.setUTCDate(d.getUTCDate() - i)
      return readiness(d.toISOString().slice(0, 10), 85)
    })
    const r = recoveryPro({
      asOf: "2026-05-14",
      dailyLoads: [],
      tests: [],
      readiness: days,
      monthlyCompliancePct: null,
    })
    expect(r).not.toBeNull()
  })

  it("returns null when one day dips below 80", () => {
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date("2026-05-14T00:00:00Z")
      d.setUTCDate(d.getUTCDate() - i)
      return readiness(d.toISOString().slice(0, 10), i === 5 ? 70 : 85)
    })
    const r = recoveryPro({
      asOf: "2026-05-14",
      dailyLoads: [],
      tests: [],
      readiness: days,
      monthlyCompliancePct: null,
    })
    expect(r).toBeNull()
  })
})
```

```typescript
// __tests__/lib/badges/consistent.test.ts
import { describe, it, expect } from "vitest"
import { consistent } from "@/lib/badges/consistent"

describe("consistent", () => {
  it("fires silver at 90% monthly compliance", () => {
    const r = consistent({
      asOf: "2026-05-14",
      dailyLoads: [],
      tests: [],
      readiness: [],
      monthlyCompliancePct: 92,
    })
    expect(r?.tier).toBe("silver")
  })

  it("fires gold at 100% monthly compliance", () => {
    const r = consistent({
      asOf: "2026-05-14",
      dailyLoads: [],
      tests: [],
      readiness: [],
      monthlyCompliancePct: 100,
    })
    expect(r?.tier).toBe("gold")
  })

  it("returns null below 90%", () => {
    const r = consistent({
      asOf: "2026-05-14",
      dailyLoads: [],
      tests: [],
      readiness: [],
      monthlyCompliancePct: 80,
    })
    expect(r).toBeNull()
  })
})
```

- [ ] **Step 8: Run + commit**

Run: `npm run test:run -- __tests__/lib/badges/`
Expected: ~10 passing tests.

```bash
git add lib/badges/ __tests__/lib/badges/
git commit -m "feat(viz): computed badges (iron-streak, pr-machine, recovery-pro, consistent)"
```

---

## Phase 4 — Body Map

### Task 4.1: SVG asset + picker + display

**Files:**
- Create: `components/shared/body-map/body-map-svg.tsx`
- Create: `components/shared/body-map/body-map-picker.tsx`
- Create: `components/shared/body-map/body-map-display.tsx`

- [ ] **Step 1: Write `body-map-svg.tsx`**

A simplified front + back human silhouette as inline SVG. Each region group has `data-region` and (for paired regions) `data-side`. Region zones are positioned to roughly match anatomical placement; the exact paths use simple ellipses/rounded rects since perfect anatomy isn't the goal.

```typescript
// components/shared/body-map/body-map-svg.tsx
import { cn } from "@/lib/utils"
import type { BodyRegion, InjurySide } from "@/types/database"

export interface BodyMapRegion {
  region: BodyRegion
  side: InjurySide
}

export interface BodyMapSVGProps {
  /** Returns Tailwind classes for a region (e.g. fill color based on selection / injury). */
  classForRegion?: (r: BodyMapRegion) => string
  /** Click handler. */
  onClick?: (r: BodyMapRegion) => void
  /** Hover handler — used by display variant for tooltips. */
  onHover?: (r: BodyMapRegion | null) => void
  className?: string
}

const DEFAULT_CLS =
  "fill-muted stroke-border stroke-1 hover:fill-primary/40 cursor-pointer transition-colors"

export function BodyMapSVG({ classForRegion, onClick, onHover, className }: BodyMapSVGProps) {
  const cls = (r: BodyMapRegion) => cn(DEFAULT_CLS, classForRegion?.(r))
  const handle = (r: BodyMapRegion) => ({
    onClick: () => onClick?.(r),
    onMouseEnter: () => onHover?.(r),
    onMouseLeave: () => onHover?.(null),
    className: cls(r),
    role: "button" as const,
    tabIndex: 0,
    "aria-label": `${r.region}${r.side !== "n_a" ? " " + r.side : ""}`,
    "data-region": r.region,
    "data-side": r.side,
  })

  return (
    <svg viewBox="0 0 400 200" className={cn("w-full", className)}>
      {/* FRONT view (left half: x 0..200) */}
      <g transform="translate(0,0)">
        <text x="100" y="14" textAnchor="middle" className="text-xs fill-muted-foreground">Front</text>
        {/* head */}
        <ellipse cx="100" cy="35" rx="14" ry="16" {...handle({ region: "head", side: "n_a" })} />
        {/* neck */}
        <rect x="93" y="50" width="14" height="8" {...handle({ region: "neck", side: "n_a" })} />
        {/* chest */}
        <rect x="78" y="58" width="44" height="28" rx="4" {...handle({ region: "chest", side: "n_a" })} />
        {/* shoulders */}
        <ellipse cx="74" cy="62" rx="8" ry="10" {...handle({ region: "shoulder", side: "left" })} />
        <ellipse cx="126" cy="62" rx="8" ry="10" {...handle({ region: "shoulder", side: "right" })} />
        {/* elbows */}
        <ellipse cx="64" cy="86" rx="6" ry="7" {...handle({ region: "elbow", side: "left" })} />
        <ellipse cx="136" cy="86" rx="6" ry="7" {...handle({ region: "elbow", side: "right" })} />
        {/* wrists */}
        <ellipse cx="58" cy="108" rx="5" ry="6" {...handle({ region: "wrist", side: "left" })} />
        <ellipse cx="142" cy="108" rx="5" ry="6" {...handle({ region: "wrist", side: "right" })} />
        {/* hands */}
        <ellipse cx="55" cy="120" rx="5" ry="6" {...handle({ region: "hand", side: "left" })} />
        <ellipse cx="145" cy="120" rx="5" ry="6" {...handle({ region: "hand", side: "right" })} />
        {/* hips */}
        <ellipse cx="86" cy="98" rx="8" ry="8" {...handle({ region: "hip", side: "left" })} />
        <ellipse cx="114" cy="98" rx="8" ry="8" {...handle({ region: "hip", side: "right" })} />
        {/* quads */}
        <rect x="80" y="108" width="14" height="32" rx="6" {...handle({ region: "quad", side: "left" })} />
        <rect x="106" y="108" width="14" height="32" rx="6" {...handle({ region: "quad", side: "right" })} />
        {/* knees */}
        <ellipse cx="87" cy="146" rx="7" ry="6" {...handle({ region: "knee", side: "left" })} />
        <ellipse cx="113" cy="146" rx="7" ry="6" {...handle({ region: "knee", side: "right" })} />
      </g>
      {/* BACK view (right half: x 200..400) */}
      <g transform="translate(200,0)">
        <text x="100" y="14" textAnchor="middle" className="text-xs fill-muted-foreground">Back</text>
        {/* upper back */}
        <rect x="78" y="58" width="44" height="14" rx="3" {...handle({ region: "upper_back", side: "n_a" })} />
        {/* lower back */}
        <rect x="80" y="74" width="40" height="14" rx="3" {...handle({ region: "lower_back", side: "n_a" })} />
        {/* glutes */}
        <ellipse cx="86" cy="98" rx="9" ry="8" {...handle({ region: "glute", side: "left" })} />
        <ellipse cx="114" cy="98" rx="9" ry="8" {...handle({ region: "glute", side: "right" })} />
        {/* hamstrings */}
        <rect x="80" y="108" width="14" height="32" rx="6" {...handle({ region: "hamstring", side: "left" })} />
        <rect x="106" y="108" width="14" height="32" rx="6" {...handle({ region: "hamstring", side: "right" })} />
        {/* calves */}
        <rect x="82" y="148" width="10" height="24" rx="4" {...handle({ region: "calf", side: "left" })} />
        <rect x="108" y="148" width="10" height="24" rx="4" {...handle({ region: "calf", side: "right" })} />
        {/* ankles */}
        <ellipse cx="87" cy="178" rx="5" ry="5" {...handle({ region: "ankle", side: "left" })} />
        <ellipse cx="113" cy="178" rx="5" ry="5" {...handle({ region: "ankle", side: "right" })} />
        {/* feet */}
        <ellipse cx="87" cy="190" rx="6" ry="4" {...handle({ region: "foot", side: "left" })} />
        <ellipse cx="113" cy="190" rx="6" ry="4" {...handle({ region: "foot", side: "right" })} />
      </g>
    </svg>
  )
}
```

- [ ] **Step 2: Write `body-map-picker.tsx`**

```typescript
// components/shared/body-map/body-map-picker.tsx
"use client"

import { useState } from "react"
import type { BodyRegion, InjurySide } from "@/types/database"
import { BODY_REGION_LABELS } from "@/lib/validators/injury"
import { BodyMapSVG, type BodyMapRegion } from "./body-map-svg"

export interface BodyMapValue {
  region: BodyRegion | null
  side: InjurySide
}

export function BodyMapPicker({
  value,
  onChange,
}: {
  value: BodyMapValue
  onChange: (v: BodyMapValue) => void
}) {
  const [hover, setHover] = useState<BodyMapRegion | null>(null)
  const selected = value.region
  const selectedSide = value.side

  return (
    <div className="space-y-2">
      <div className="bg-card rounded-lg border p-2">
        <BodyMapSVG
          classForRegion={(r) =>
            r.region === selected && (r.side === selectedSide || selectedSide === "n_a")
              ? "!fill-primary"
              : ""
          }
          onClick={(r) => onChange({ region: r.region, side: r.side })}
          onHover={setHover}
        />
      </div>
      <p className="text-muted-foreground text-center text-sm">
        {selected
          ? `Selected: ${BODY_REGION_LABELS[selected]}${selectedSide !== "n_a" ? ` (${selectedSide})` : ""}`
          : hover
            ? `Hovering: ${BODY_REGION_LABELS[hover.region]}${hover.side !== "n_a" ? ` (${hover.side})` : ""}`
            : "Click a body region"}
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Write `body-map-display.tsx`**

```typescript
// components/shared/body-map/body-map-display.tsx
"use client"

import { useRouter } from "next/navigation"
import type { Injury, BodyRegion } from "@/types/database"
import { BodyMapSVG, type BodyMapRegion } from "./body-map-svg"

const STATUS_FILL: Record<Injury["status"], string> = {
  active: "!fill-error",
  recovering: "!fill-warning",
  resolved: "!fill-success/40",
}

export function BodyMapDisplay({
  injuries,
  clientUserId,
}: {
  injuries: Injury[]
  clientUserId?: string
}) {
  const router = useRouter()

  // For each region, pick the most severe (active > recovering > resolved) injury
  const byRegion = new Map<BodyRegion, Injury>()
  const priority: Record<Injury["status"], number> = {
    active: 3,
    recovering: 2,
    resolved: 1,
  }
  for (const i of injuries) {
    const existing = byRegion.get(i.body_region)
    if (!existing || priority[i.status] > priority[existing.status]) {
      byRegion.set(i.body_region, i)
    }
  }

  return (
    <BodyMapSVG
      classForRegion={(r: BodyMapRegion) => {
        const i = byRegion.get(r.region)
        if (!i) return ""
        if (i.side !== "n_a" && i.side !== "bilateral" && i.side !== r.side) return ""
        return STATUS_FILL[i.status]
      }}
      onClick={(r) => {
        const i = byRegion.get(r.region)
        if (i && clientUserId) {
          router.push(`/admin/clients/${clientUserId}/injuries/${i.id}`)
        } else if (i) {
          router.push(`/client/injuries/${i.id}`)
        }
      }}
    />
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add components/shared/body-map/
git commit -m "feat(viz): body-map SVG + picker + read-only display"
```

---

### Task 4.2: Use BodyMapPicker in ReportInjuryForm + BodyMapDisplay on admin Injuries tab

**Files:**
- Modify: `components/client/performance/report-injury-form.tsx`
- Modify: `components/admin/performance/athlete-performance-hub.tsx`

- [ ] **Step 1: Update `report-injury-form.tsx`**

Replace the body_region + side two-Select pair with the picker. Find this block:

```tsx
<div className="grid grid-cols-2 gap-4">
  <div className="grid gap-2">
    <Label>Body region</Label>
    <Select ...>...</Select>
  </div>
  <div className="grid gap-2">
    <Label>Side</Label>
    <Select ...>...</Select>
  </div>
</div>
```

Replace with:

```tsx
import { BodyMapPicker } from "@/components/shared/body-map/body-map-picker"

// ...

<div className="grid gap-2">
  <Label>Body region</Label>
  <BodyMapPicker
    value={{
      region: form.watch("body_region") ?? null,
      side: form.watch("side"),
    }}
    onChange={({ region, side }) => {
      if (region) form.setValue("body_region", region)
      form.setValue("side", side)
    }}
  />
</div>
```

- [ ] **Step 2: Update admin hub injuries tab**

In `components/admin/performance/athlete-performance-hub.tsx`, find the `<TabsContent value="injuries">` and prepend the body-map display:

```tsx
import { BodyMapDisplay } from "@/components/shared/body-map/body-map-display"

// ...

<TabsContent value="injuries" className="mt-6 space-y-6">
  <BodyMapDisplay injuries={allInjuries} clientUserId={clientUserId} />
  <InjuryTimelineList injuries={allInjuries} clientUserId={clientUserId} />
</TabsContent>
```

- [ ] **Step 3: Commit**

```bash
git add components/client/performance/report-injury-form.tsx components/admin/performance/athlete-performance-hub.tsx
git commit -m "feat(viz): replace injury dropdown with body-map picker; add display to admin hub"
```

---

## Phase 5 — Profile components

### Task 5.1: `AthleteRadarCard`

**Files:**
- Create: `components/client/profile/athlete-radar-card.tsx`

- [ ] **Step 1: Write the component**

```typescript
// components/client/profile/athlete-radar-card.tsx
"use client"

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { normalize, RADAR_CATEGORIES } from "@/lib/coach-intel/test-normalization"
import type { PerformanceTest, TestType } from "@/types/database"

export function AthleteRadarCard({ tests }: { tests: PerformanceTest[] }) {
  // For each category, find the latest test of any matching type and normalize it
  const data = Object.entries(RADAR_CATEGORIES).map(([category, types]) => {
    let best: number | null = null
    for (const t of types as TestType[]) {
      const candidates = tests
        .filter((x) => x.test_type === t)
        .sort((a, b) => b.test_date.localeCompare(a.test_date))
      if (candidates.length === 0) continue
      const score = normalize(t, candidates[0].result_value, candidates[0].body_weight_kg)
      if (score !== null && (best === null || score > best)) best = score
    }
    return { category, score: best ?? 0 }
  })

  const hasData = data.some((d) => d.score > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Athlete profile</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-muted-foreground py-12 text-center">
            Log performance tests to see your sport profile.
          </p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={data}>
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="category" />
                <PolarRadiusAxis domain={[0, 100]} />
                <Tooltip />
                <Radar
                  dataKey="score"
                  stroke="var(--primary)"
                  fill="var(--primary)"
                  fillOpacity={0.3}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/client/profile/athlete-radar-card.tsx
git commit -m "feat(viz): athlete radar card (5-axis sport snapshot)"
```

---

### Task 5.2: `TrainingStreakHeatmap`

**Files:**
- Create: `components/client/profile/training-streak-heatmap.tsx`

- [ ] **Step 1: Write the component**

```typescript
// components/client/profile/training-streak-heatmap.tsx
"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { dailyLoads } from "@/lib/coach-intel/load"
import { currentStreak, longestStreak } from "@/lib/coach-intel/streak"
import type { TrainingSession } from "@/types/database"

const BUCKETS = [
  { max: 0, fill: "var(--muted)" },
  { max: 199, fill: "color-mix(in oklch, var(--primary) 20%, transparent)" },
  { max: 399, fill: "color-mix(in oklch, var(--primary) 45%, transparent)" },
  { max: 599, fill: "color-mix(in oklch, var(--primary) 70%, transparent)" },
  { max: Infinity, fill: "var(--primary)" },
]

function bucketFor(load: number) {
  return BUCKETS.find((b) => load <= b.max)!.fill
}

export function TrainingStreakHeatmap({ sessions }: { sessions: TrainingSession[] }) {
  const today = new Date().toISOString().slice(0, 10)
  const start = new Date()
  start.setUTCDate(start.getUTCDate() - 7 * 12 + 1)
  const startIso = start.toISOString().slice(0, 10)
  const daily = dailyLoads(
    sessions.map((s) => ({ date: s.date, session_load: s.session_load })),
    startIso,
    today,
  )
  const cs = currentStreak(daily, today)
  const ls = longestStreak(daily)

  // Build a 12 × 7 grid: column = week, row = day-of-week
  const cellSize = 14
  const gap = 2
  const cols = 12
  const rows = 7

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Training streak{" "}
          <span className="text-muted-foreground text-sm font-normal">
            (current {cs}d · best {ls}d)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <svg
          viewBox={`0 0 ${cols * (cellSize + gap)} ${rows * (cellSize + gap)}`}
          className="w-full max-w-md"
        >
          {daily.map((d, i) => {
            const col = Math.floor(i / 7)
            const row = i % 7
            return (
              <rect
                key={d.date}
                x={col * (cellSize + gap)}
                y={row * (cellSize + gap)}
                width={cellSize}
                height={cellSize}
                rx={2}
                fill={bucketFor(d.load)}
              >
                <title>
                  {d.date} · load {d.load}
                </title>
              </rect>
            )
          })}
        </svg>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/client/profile/training-streak-heatmap.tsx
git commit -m "feat(viz): training-streak heatmap (12w x 7d) with current+longest"
```

---

### Task 5.3: `BadgeShelfCard`

**Files:**
- Create: `components/client/profile/badge-shelf-card.tsx`

- [ ] **Step 1: Write the component**

```typescript
// components/client/profile/badge-shelf-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import * as Icons from "lucide-react"
import type { Badge } from "@/types/database"

const TIER_RING: Record<Badge["tier"], string> = {
  bronze: "ring-2 ring-orange-700/40",
  silver: "ring-2 ring-zinc-400/60",
  gold: "ring-2 ring-yellow-500/70",
}

const TIER_BG: Record<Badge["tier"], string> = {
  bronze: "bg-orange-700/10",
  silver: "bg-zinc-400/10",
  gold: "bg-yellow-500/15",
}

export function BadgeShelfCard({ badges }: { badges: Badge[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Badges ({badges.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {badges.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center">
            Earn your first badge by logging readiness for 14 days.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {badges.map((b) => {
              // Look up the lucide icon by name with a safe fallback
              const Icon = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[b.icon] ?? Icons.Award
              return (
                <li
                  key={b.id}
                  className={cn(
                    "flex flex-col items-center rounded-lg p-3 text-center",
                    TIER_BG[b.tier],
                    TIER_RING[b.tier],
                  )}
                >
                  <Icon className="mb-1 h-6 w-6" />
                  <p className="text-sm font-semibold">{b.name}</p>
                  <p className="text-muted-foreground text-xs">{b.description}</p>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/client/profile/badge-shelf-card.tsx
git commit -m "feat(viz): badge-shelf-card with tiered tinting"
```

---

### Task 5.4: Goal components — log form, list, open-goals card

**Files:**
- Create: `components/client/profile/log-goal-form.tsx`
- Create: `components/client/profile/goals-list.tsx`
- Create: `components/client/profile/open-goals-card.tsx`

- [ ] **Step 1: `log-goal-form.tsx`**

```typescript
// components/client/profile/log-goal-form.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  GOAL_METRIC_KINDS,
  GOAL_METRIC_KIND_LABELS,
  GOAL_DIRECTIONS,
  athleteGoalFormSchema,
  type AthleteGoalFormData,
} from "@/lib/validators/athlete-goal"
import { TEST_TYPES, TEST_TYPE_LABELS } from "@/lib/validators/performance-test"

export function LogGoalForm({ clientUserId }: { clientUserId?: string }) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<AthleteGoalFormData>({
    resolver: zodResolver(athleteGoalFormSchema),
    defaultValues: {
      metric_kind: "test",
      test_type: "drop_jump",
      target_value: 40,
      target_unit: "cm",
      direction: "higher",
      start_value: null,
      deadline: null,
      notes: null,
    },
  })

  const kind = form.watch("metric_kind")

  async function onSubmit(values: AthleteGoalFormData) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/athlete-goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          clientUserId ? { ...values, client_user_id: clientUserId } : values,
        ),
      })
      if (!res.ok) throw new Error("Save failed")
      toast.success("Goal added")
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid gap-2">
        <Label>Metric</Label>
        <Select
          value={form.watch("metric_kind")}
          onValueChange={(v) =>
            form.setValue("metric_kind", v as AthleteGoalFormData["metric_kind"])
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GOAL_METRIC_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {GOAL_METRIC_KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {kind === "test" && (
        <div className="grid gap-2">
          <Label>Test type</Label>
          <Select
            value={form.watch("test_type") ?? "drop_jump"}
            onValueChange={(v) =>
              form.setValue("test_type", v as AthleteGoalFormData["test_type"])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEST_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TEST_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Target value</Label>
          <Input
            type="number"
            step="0.001"
            {...form.register("target_value", { valueAsNumber: true })}
          />
        </div>
        <div className="grid gap-2">
          <Label>Unit</Label>
          <Input {...form.register("target_unit")} />
        </div>
      </div>

      {kind === "test" && (
        <div className="grid gap-2">
          <Label>Direction</Label>
          <Select
            value={form.watch("direction")}
            onValueChange={(v) =>
              form.setValue("direction", v as AthleteGoalFormData["direction"])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GOAL_DIRECTIONS.map((d) => (
                <SelectItem key={d} value={d}>
                  {d === "higher" ? "Higher is better" : "Lower is better"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-2">
        <Label>Deadline (optional)</Label>
        <Input
          type="date"
          {...form.register("deadline", { setValueAs: (v) => (v === "" ? null : v) })}
        />
      </div>

      <div className="grid gap-2">
        <Label>Notes</Label>
        <Textarea
          rows={2}
          {...form.register("notes", { setValueAs: (v) => (v === "" ? null : v) })}
        />
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Saving..." : "Add goal"}
      </Button>
    </form>
  )
}
```

- [ ] **Step 2: `goals-list.tsx`**

```typescript
// components/client/profile/goals-list.tsx
"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { StatusPill } from "@/components/shared/status-pill"
import { GOAL_METRIC_KIND_LABELS } from "@/lib/validators/athlete-goal"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import type { AthleteGoal, TestType } from "@/types/database"

function progressPct(g: AthleteGoal): number {
  if (g.status === "achieved") return 100
  if (g.start_value === null) return 0
  const span = g.target_value - g.start_value
  if (span === 0) return 100
  // For lower-is-better, invert progress
  return Math.max(0, Math.min(100, ((g.start_value - g.target_value) / -span) * 100))
}

function label(g: AthleteGoal): string {
  if (g.metric_kind === "test" && g.test_type) {
    return TEST_TYPE_LABELS[g.test_type as TestType]
  }
  return GOAL_METRIC_KIND_LABELS[g.metric_kind]
}

export function GoalsList({ goals }: { goals: AthleteGoal[] }) {
  const router = useRouter()
  async function archive(id: string) {
    const res = await fetch(`/api/athlete-goals/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    })
    if (res.ok) {
      toast.success("Goal archived")
      router.refresh()
    } else {
      toast.error("Failed")
    }
  }
  if (goals.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-12 text-center">
          No goals yet.
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardContent className="p-0">
        <ol className="divide-y">
          {goals.map((g) => (
            <li key={g.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="font-medium">{label(g)}</p>
                  <p className="text-muted-foreground text-sm">
                    Target: {g.target_value} {g.target_unit}
                    {g.direction === "lower" ? " (faster)" : " (more)"}
                    {g.deadline ? ` by ${g.deadline}` : ""}
                  </p>
                </div>
                <StatusPill
                  status={
                    g.status === "achieved"
                      ? "resolved"
                      : g.status === "active"
                        ? "active"
                        : "neutral"
                  }
                  label={g.status}
                />
              </div>
              <div className="bg-muted mt-3 h-2 overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full transition-all"
                  style={{ width: `${progressPct(g)}%` }}
                />
              </div>
              {g.status === "active" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  onClick={() => archive(g.id)}
                >
                  Archive
                </Button>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: `open-goals-card.tsx`**

```typescript
// components/client/profile/open-goals-card.tsx
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { GOAL_METRIC_KIND_LABELS } from "@/lib/validators/athlete-goal"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import type { AthleteGoal, TestType } from "@/types/database"

export function OpenGoalsCard({
  goals,
  goalsHref,
}: {
  goals: AthleteGoal[]
  goalsHref: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open goals ({goals.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {goals.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            <Link href={goalsHref} className="underline">
              Set your first goal
            </Link>{" "}
            to track progress.
          </p>
        ) : (
          <ul className="space-y-2">
            {goals.slice(0, 3).map((g) => {
              const label =
                g.metric_kind === "test" && g.test_type
                  ? TEST_TYPE_LABELS[g.test_type as TestType]
                  : GOAL_METRIC_KIND_LABELS[g.metric_kind]
              return (
                <li key={g.id} className="text-sm">
                  <Link href={goalsHref} className="hover:underline">
                    {label}: <span className="font-semibold">{g.target_value}</span>{" "}
                    {g.target_unit}
                    {g.deadline ? (
                      <span className="text-muted-foreground"> · by {g.deadline}</span>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add components/client/profile/
git commit -m "feat(viz): goal log-form + list + open-goals card"
```

---

## Phase 6 — Routes + API

### Task 6.1: Goals API endpoints

**Files:**
- Create: `app/api/athlete-goals/route.ts`
- Create: `app/api/athlete-goals/[id]/route.ts`

- [ ] **Step 1: `app/api/athlete-goals/route.ts`**

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { athleteGoalFormSchema } from "@/lib/validators/athlete-goal"
import { create, listByUser } from "@/lib/db/athlete-goals"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const url = new URL(req.url)
  const clientUserId =
    session.user.role === "admin" && url.searchParams.get("client_user_id")
      ? url.searchParams.get("client_user_id")!
      : session.user.id
  const goals = await listByUser(clientUserId)
  return NextResponse.json({ goals })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json()
  const parsed = athleteGoalFormSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const clientUserId =
    session.user.role === "admin" && body.client_user_id
      ? (body.client_user_id as string)
      : session.user.id
  const goal = await create(clientUserId, parsed.data)
  return NextResponse.json({ goal })
}
```

- [ ] **Step 2: `app/api/athlete-goals/[id]/route.ts`**

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { athleteGoalFormSchema } from "@/lib/validators/athlete-goal"
import { archive, getById, update } from "@/lib/db/athlete-goals"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const existing = await getById(id)
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (session.user.role !== "admin" && existing.client_user_id !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const body = await req.json()
  if (body.action === "archive") {
    const goal = await archive(id)
    return NextResponse.json({ goal })
  }
  const parsed = athleteGoalFormSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const goal = await update(id, parsed.data)
  return NextResponse.json({ goal })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const existing = await getById(id)
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (session.user.role !== "admin" && existing.client_user_id !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  await archive(id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/athlete-goals/
git commit -m "feat(viz): athlete-goals API (POST, GET, PATCH archive, DELETE)"
```

---

### Task 6.2: Profile summary endpoint

**Files:**
- Create: `app/api/clients/[id]/profile/summary/route.ts`

- [ ] **Step 1: Write the endpoint**

```typescript
// app/api/clients/[id]/profile/summary/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listByUser as listTests } from "@/lib/db/performance-tests"
import { listByUser as listSessions } from "@/lib/db/training-sessions"
import { listByUser as listReadiness } from "@/lib/db/daily-readiness"
import { getActive as activeGoals } from "@/lib/db/athlete-goals"
import { dailyLoads } from "@/lib/coach-intel/load"
import { currentStreak, longestStreak } from "@/lib/coach-intel/streak"
import { computeBadges } from "@/lib/badges"

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  if (session.user.role !== "admin" && session.user.id !== id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const from = addDays(today, -90)

  const [tests, sessions, readiness, goals] = await Promise.all([
    listTests(id),
    listSessions(id, { from, to: today }),
    listReadiness(id, { from, to: today }),
    activeGoals(id),
  ])

  const daily = dailyLoads(sessions, from, today)
  const badges = computeBadges({
    asOf: today,
    dailyLoads: daily,
    tests,
    readiness,
    monthlyCompliancePct: null, // TODO when compliance scheduling lands properly
  })

  return NextResponse.json({
    profile: {
      asOf: today,
      currentStreak: currentStreak(daily, today),
      longestStreak: longestStreak(daily),
      tests: tests.slice(0, 50),
      sessions,
      readiness,
      activeGoals: goals,
      badges,
    },
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/clients/[id]/profile/summary/route.ts
git commit -m "feat(viz): GET /api/clients/[id]/profile/summary (radar + streak + badges + goals)"
```

---

### Task 6.3: Client `/profile` + `/goals` pages

**Files:**
- Create: `app/(client)/client/profile/page.tsx`
- Create: `app/(client)/client/goals/page.tsx`

- [ ] **Step 1: `/client/profile/page.tsx`**

```typescript
// app/(client)/client/profile/page.tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listByUser as listTests } from "@/lib/db/performance-tests"
import { listByUser as listSessions } from "@/lib/db/training-sessions"
import { listByUser as listReadiness } from "@/lib/db/daily-readiness"
import { getActive as activeGoals } from "@/lib/db/athlete-goals"
import { dailyLoads } from "@/lib/coach-intel/load"
import { computeBadges } from "@/lib/badges"
import { AthleteRadarCard } from "@/components/client/profile/athlete-radar-card"
import { TrainingStreakHeatmap } from "@/components/client/profile/training-streak-heatmap"
import { BadgeShelfCard } from "@/components/client/profile/badge-shelf-card"
import { OpenGoalsCard } from "@/components/client/profile/open-goals-card"

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export default async function ClientProfilePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/profile")
  const uid = session.user.id

  const today = new Date().toISOString().slice(0, 10)
  const from = addDays(today, -90)

  const [tests, sessions, readiness, goals] = await Promise.all([
    listTests(uid),
    listSessions(uid, { from, to: today }),
    listReadiness(uid, { from, to: today }),
    activeGoals(uid),
  ])

  const daily = dailyLoads(sessions, from, today)
  const badges = computeBadges({
    asOf: today,
    dailyLoads: daily,
    tests,
    readiness,
    monthlyCompliancePct: null,
  })

  return (
    <div className="container max-w-5xl space-y-6 py-8">
      <h1 className="font-heading text-3xl font-bold">Profile</h1>
      <div className="grid gap-6 md:grid-cols-2">
        <AthleteRadarCard tests={tests} />
        <TrainingStreakHeatmap sessions={sessions} />
        <BadgeShelfCard badges={badges} />
        <OpenGoalsCard goals={goals} goalsHref="/client/goals" />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `/client/goals/page.tsx`**

```typescript
// app/(client)/client/goals/page.tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listByUser } from "@/lib/db/athlete-goals"
import { LogGoalForm } from "@/components/client/profile/log-goal-form"
import { GoalsList } from "@/components/client/profile/goals-list"

export default async function ClientGoalsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/goals")
  const goals = await listByUser(session.user.id)

  return (
    <div className="container max-w-3xl space-y-8 py-8">
      <h1 className="font-heading text-3xl font-bold">Goals</h1>
      <section>
        <h2 className="font-heading mb-4 text-xl font-semibold">All goals</h2>
        <GoalsList goals={goals} />
      </section>
      <section>
        <h2 className="font-heading mb-4 text-xl font-semibold">Add a new goal</h2>
        <LogGoalForm />
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add "app/(client)/client/profile/" "app/(client)/client/goals/"
git commit -m "feat(viz): client /profile + /goals pages"
```

---

### Task 6.4: Admin hub Profile tab

**Files:**
- Modify: `components/admin/performance/athlete-performance-hub.tsx`
- Modify: `app/(admin)/admin/clients/[id]/performance/page.tsx`

- [ ] **Step 1: Update the page to fetch profile data**

In `app/(admin)/admin/clients/[id]/performance/page.tsx`, after the existing `Promise.all`, append the profile-related fetches and pass them in. Replace the entire `Promise.all` + return block with:

```typescript
import { getActive as activeGoals } from "@/lib/db/athlete-goals"
import { computeBadges } from "@/lib/badges"

// ... inside the component, replacing the existing Promise.all + return:

const [
  latestReadiness,
  trend,
  allInjuries,
  activeInjuries,
  prs,
  recentTests,
  trainingSessions,
  openFlags,
  goals,
  fullTests,
  allReadiness,
] = await Promise.all([
  getLatest(id),
  getReadinessTrend(id, 30),
  listByUser(id),
  getActive(id),
  getPRsByUser(id),
  listTests(id).then((t) => t.slice(0, 10)),
  listTrainingSessions(id, { from, to: today }),
  getOpenByUser(id),
  activeGoals(id),
  listTests(id),
  // fetch full 90-day readiness for badge eval (was only 30d trend before)
  (await import("@/lib/db/daily-readiness")).listByUser(id, { from, to: today }),
])

const daily = dailyLoads(trainingSessions, from, today)
// ... existing acute, chronic, week, wow calculations unchanged ...

const badges = computeBadges({
  asOf: today,
  dailyLoads: daily,
  tests: fullTests,
  readiness: allReadiness,
  monthlyCompliancePct: null,
})

return (
  <AthletePerformanceHub
    clientUserId={id}
    tab={tab}
    latestReadiness={latestReadiness}
    readinessTrend={trend}
    activeInjuries={activeInjuries}
    allInjuries={allInjuries}
    prs={prs}
    recentTests={recentTests}
    coachIntel={{
      // ... existing ...
    }}
    profile={{
      tests: fullTests,
      sessions: trainingSessions,
      goals,
      badges,
    }}
  />
)
```

- [ ] **Step 2: Update the hub component to render the new tab**

In `components/admin/performance/athlete-performance-hub.tsx`, add `profile` to the props and render a new tab. Import the components:

```typescript
import { AthleteRadarCard } from "@/components/client/profile/athlete-radar-card"
import { TrainingStreakHeatmap } from "@/components/client/profile/training-streak-heatmap"
import { BadgeShelfCard } from "@/components/client/profile/badge-shelf-card"
import { OpenGoalsCard } from "@/components/client/profile/open-goals-card"
import type { AthleteGoal, Badge, PerformanceTest, TrainingSession } from "@/types/database"

export interface ProfileSummary {
  tests: PerformanceTest[]
  sessions: TrainingSession[]
  goals: AthleteGoal[]
  badges: Badge[]
}

// in the component signature, add `profile: ProfileSummary` after coachIntel
```

Add to `<TabsList>` after the Alerts tab:

```tsx
<TabsTrigger value="profile" asChild>
  <Link href={`/admin/clients/${clientUserId}/performance?tab=profile`}>Profile</Link>
</TabsTrigger>
```

Add the tab content before the existing Injuries tab content:

```tsx
<TabsContent value="profile" className="mt-6 grid gap-6 md:grid-cols-2">
  <AthleteRadarCard tests={profile.tests} />
  <TrainingStreakHeatmap sessions={profile.sessions} />
  <BadgeShelfCard badges={profile.badges} />
  <OpenGoalsCard
    goals={profile.goals}
    goalsHref={`/admin/clients/${clientUserId}/performance?tab=profile`}
  />
</TabsContent>
```

Also add `OpenGoalsCard` to the Overview tab (after `RiskFlagsCard`):

```tsx
<OpenGoalsCard
  goals={profile.goals}
  goalsHref={`/admin/clients/${clientUserId}/performance?tab=profile`}
/>
```

- [ ] **Step 3: Commit**

```bash
git add components/admin/performance/athlete-performance-hub.tsx "app/(admin)/admin/clients/[id]/performance/page.tsx"
git commit -m "feat(viz): admin hub Profile tab (radar + heatmap + badges + open goals)"
```

---

## Phase 7 — E2E + Verify

### Task 7.1: Playwright e2e

**Files:**
- Create: `__tests__/e2e/visualization-engagement.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
// __tests__/e2e/visualization-engagement.spec.ts
import { test, expect, type Page } from "@playwright/test"

const CLIENT_EMAIL = process.env.E2E_CLIENT_EMAIL
const CLIENT_PASSWORD = process.env.E2E_CLIENT_PASSWORD
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD
const CLIENT_USER_ID = process.env.E2E_CLIENT_USER_ID

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login")
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole("button", { name: /sign in|log in/i }).click()
  await page.waitForURL(/\/(client|admin)/, { timeout: 10_000 })
}

test.describe("Visualization & Engagement", () => {
  test("athlete renders profile page with all four cards", async ({ page }) => {
    test.skip(!CLIENT_EMAIL || !CLIENT_PASSWORD, "E2E client creds not set")
    await signIn(page, CLIENT_EMAIL!, CLIENT_PASSWORD!)
    await page.goto("/client/profile")
    await expect(page.getByText(/athlete profile/i)).toBeVisible()
    await expect(page.getByText(/training streak/i)).toBeVisible()
    await expect(page.getByText(/badges/i)).toBeVisible()
    await expect(page.getByText(/open goals/i)).toBeVisible()
  })

  test("athlete creates a goal", async ({ page }) => {
    test.skip(!CLIENT_EMAIL || !CLIENT_PASSWORD, "E2E client creds not set")
    await signIn(page, CLIENT_EMAIL!, CLIENT_PASSWORD!)
    await page.goto("/client/goals")
    await page.getByRole("button", { name: /add goal/i }).click()
    await expect(page.getByText(/goal added/i)).toBeVisible()
  })

  test("admin sees Profile tab on hub", async ({ page }) => {
    test.skip(
      !ADMIN_EMAIL || !ADMIN_PASSWORD || !CLIENT_USER_ID,
      "E2E admin creds or client id not set",
    )
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!)
    await page.goto(`/admin/clients/${CLIENT_USER_ID}/performance?tab=profile`)
    await expect(page.getByText(/athlete profile/i)).toBeVisible()
  })
})
```

- [ ] **Step 2: Commit**

```bash
git add __tests__/e2e/visualization-engagement.spec.ts
git commit -m "test(viz): e2e for profile + goal creation + admin tab"
```

---

### Task 7.2: Final verification

- [ ] **Step 1: Run all new tests**

Run: `npm run test:run -- __tests__/lib/coach-intel/ __tests__/lib/badges/ __tests__/lib/db/athlete-goals.test.ts __tests__/lib/validators/athlete-goal.test.ts`
Expected: all pass.

- [ ] **Step 2: Format new files**

Run:
```bash
npx prettier --write \
  "lib/coach-intel/test-normalization.ts" \
  "lib/coach-intel/streak.ts" \
  "lib/coach-intel/check-goals.ts" \
  "lib/badges/*.ts" \
  "lib/db/athlete-goals.ts" \
  "lib/validators/athlete-goal.ts" \
  "components/shared/body-map/*.tsx" \
  "components/client/profile/*.tsx" \
  "app/api/athlete-goals/**/*.ts" \
  "app/api/clients/[id]/profile/**/*.ts" \
  "__tests__/lib/coach-intel/test-normalization.test.ts" \
  "__tests__/lib/coach-intel/streak.test.ts" \
  "__tests__/lib/coach-intel/check-goals.test.ts" \
  "__tests__/lib/badges/*.ts" \
  "__tests__/lib/db/athlete-goals.test.ts" \
  "__tests__/lib/validators/athlete-goal.test.ts" \
  "__tests__/e2e/visualization-engagement.spec.ts"
```

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: build succeeds. **Watch for the same `zod .default()` resolver issue from Sub-1.** The `athleteGoalFormSchema` is explicitly designed without `.default()` to avoid this.

- [ ] **Step 4: Manual smoke**

```bash
npm run dev
```

- Sign in as client → `/client/goals` → add a test goal (drop_jump ≥ 40cm) → submit → goal appears in list.
- `/client/performance` → log a drop_jump test with result 42 → goal auto-marked achieved (status pill flips).
- `/client/profile` → all four cards render (radar may be empty if no tests yet).
- `/client/injuries/new` → click hamstring on body map → form submits with `body_region=hamstring`.
- Admin sign-in → `/admin/clients/[id]/performance?tab=profile` → renders.
- `?tab=injuries` → body map display shows colored markers.

- [ ] **Step 5: Final commit**

```bash
git status
git commit -am "style(viz): prettier formatting pass" 2>/dev/null || true
```

---

## Self-Review (completed inline)

**Spec coverage:**

| Spec section | Implemented by |
|---|---|
| §4.1 athlete_goals + achievement detection | Tasks 1.1, 2.3, 2.4 |
| §5 Body map (picker + display + SVG) | Task 4.1, 4.2 |
| §6 Radar chart | Tasks 2.1, 5.1 |
| §7 Streak heatmap | Tasks 2.2, 5.2 |
| §8 Goals UI | Tasks 5.4, 6.1, 6.3 |
| §9 Badges | Task 3.1, 5.3 |
| §10 Routes | Tasks 4.2, 6.3, 6.4 |
| §11 API | Tasks 6.1, 6.2 |
| §14 Tests | Throughout + Task 7.1 |

No gaps.

**Placeholder check:** Marked one TODO in `profile/summary/route.ts` (`monthlyCompliancePct: null`) — that's documented in the spec as a deliberate deferral; not a placeholder.

**Type consistency:** `AthleteGoal`, `Badge`, `BadgeInput`, `BodyMapValue`, `GoalContext`, function names `checkGoals`, `computeBadges`, `normalize`, `currentStreak`, `longestStreak` all consistent.

---

## Execution

Same ralph-loop pattern as Sub-1 and Sub-2. ~13 task slices.

Alternative: `superpowers:subagent-driven-development` or `superpowers:executing-plans`.
