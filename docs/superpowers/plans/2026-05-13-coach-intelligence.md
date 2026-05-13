# Coach Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. The user has requested execution via the `ralph-loop` plugin — same pattern as Sub-project 1. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add coach intelligence on top of the Sub-project 1 data foundation — training-load tracking, ACWR/monotony/strain/compliance/WoW math, and rule-based risk flags surfaced in the admin hub.

**Architecture:** Two new Supabase tables (`training_sessions` with a `session_load` GENERATED column; `risk_flags`). All analytics live as pure functions in `lib/coach-intel/` (no I/O) so they're exhaustively unit-testable with fixtures. A thin orchestrator (`run-evaluation`) reads data, calls the pure rule evaluator, and persists/dedupes flags via the `risk-flags` DAL. The evaluator runs synchronously after each `/api/readiness` and `/api/training-sessions` write.

**Tech Stack:** Same as Sub-1 — Next.js 16, TS strict, Supabase Postgres (service-role), NextAuth v5, Tailwind v4, shadcn/ui, Recharts, RHF + Zod, Vitest.

**Source spec:** [docs/superpowers/specs/2026-05-13-coach-intelligence-design.md](../specs/2026-05-13-coach-intelligence-design.md)

## Conventions locked from existing code

Inheriting all conventions from Sub-project 1 — see [2026-05-13-athlete-performance-core.md](./2026-05-13-athlete-performance-core.md#conventions-locked-from-existing-code-deviations-from-spec). Recap:

- `client_user_id UUID REFERENCES users(id) ON DELETE CASCADE` for client FKs
- `TEXT + CHECK` enums (not Postgres ENUM types)
- RLS admin pattern: `EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')`
- Migrations applied via `mcp__supabase__apply_migration`
- Service-role DAL pattern; types cast at boundary
- Commits go directly to `main`

---

## File Structure

### New files

```
supabase/migrations/
  00132_training_sessions.sql
  00133_risk_flags.sql

lib/coach-intel/
  thresholds.ts        # Named constants for rule thresholds
  load.ts              # dailyLoads, rollingAverage, acuteLoad, chronicLoad, acwr
  monotony.ts          # weeklyStats (mean, stdDev, monotony, strain)
  week-over-week.ts    # weekOverWeek deltas
  compliance.ts        # compliance from assignments + sessions
  evaluate-rules.ts    # Pure rule evaluation -> ProposedFlag[]
  run-evaluation.ts    # Orchestrator that loads data + persists flags

lib/db/
  training-sessions.ts
  risk-flags.ts

app/api/training-sessions/route.ts
app/api/training-sessions/[id]/route.ts
app/api/risk-flags/[id]/route.ts
app/api/clients/[id]/training/load-trend/route.ts
app/api/clients/[id]/coach-intel/summary/route.ts
app/api/clients/[id]/coach-intel/re-evaluate/route.ts

app/(client)/client/training/page.tsx
app/(client)/client/training/history/page.tsx
app/(admin)/admin/clients/[id]/performance/log-session/page.tsx

components/admin/coach-intel/
  training-load-card.tsx
  training-load-chart.tsx
  acwr-chart.tsx
  monotony-strain-card.tsx
  week-over-week-card.tsx
  compliance-ring-card.tsx
  risk-flags-card.tsx
  risk-flags-list.tsx
components/client/coach-intel/
  log-training-session-form.tsx
  my-training-history.tsx

__tests__/lib/coach-intel/
  load.test.ts
  monotony.test.ts
  week-over-week.test.ts
  compliance.test.ts
  evaluate-rules.test.ts
  run-evaluation.test.ts
__tests__/lib/db/
  training-sessions.test.ts
  risk-flags.test.ts
__tests__/e2e/
  coach-intelligence.spec.ts
```

### Modified files

- `types/database.ts` — append `TrainingSession`, `RiskFlag`, `RiskFlagType`, `RiskFlagSeverity`, `RiskFlagStatus`, `SessionType`
- `app/api/readiness/route.ts` — call `runEvaluation` after the upsert (best-effort, swallow errors)
- `components/admin/performance/athlete-performance-hub.tsx` — add Load + Alerts tabs and Overview-tab cards (TrainingLoadCard, RiskFlagsCard)
- `app/(admin)/admin/clients/[id]/performance/page.tsx` — load coach-intel data + pass into the hub

---

## Phase 1 — Migrations + Types

### Task 1.1: Migration `00132_training_sessions.sql`

**Files:**
- Create: `supabase/migrations/00132_training_sessions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Training Sessions: per-athlete daily training load log
-- =====================================================================

CREATE TABLE IF NOT EXISTS training_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,

  session_type TEXT NOT NULL CHECK (session_type IN (
    'gym','sport','field','conditioning','mobility','other'
  )),
  rpe INT NOT NULL CHECK (rpe BETWEEN 1 AND 10),
  duration_min INT NOT NULL CHECK (duration_min > 0 AND duration_min <= 600),
  session_load INT GENERATED ALWAYS AS (rpe * duration_min) STORED,
  notes TEXT,
  program_assignment_id UUID REFERENCES program_assignments(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT training_sessions_user_date_type_unique UNIQUE (client_user_id, date, session_type)
);

CREATE INDEX idx_training_sessions_user ON training_sessions(client_user_id);
CREATE INDEX idx_training_sessions_user_date ON training_sessions(client_user_id, date DESC);
CREATE INDEX idx_training_sessions_assignment ON training_sessions(program_assignment_id);

CREATE TRIGGER set_training_sessions_updated_at
  BEFORE UPDATE ON training_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE training_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage training sessions"
  ON training_sessions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Clients can view own training sessions"
  ON training_sessions FOR SELECT TO authenticated
  USING (client_user_id = auth.uid());

CREATE POLICY "Clients can insert own training sessions"
  ON training_sessions FOR INSERT TO authenticated
  WITH CHECK (client_user_id = auth.uid());

CREATE POLICY "Clients can update own training sessions"
  ON training_sessions FOR UPDATE TO authenticated
  USING (client_user_id = auth.uid());
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `00132_training_sessions`.

- [ ] **Step 3: Append types**

```typescript
// types/database.ts — append after PerformanceTestPR

export type SessionType = "gym" | "sport" | "field" | "conditioning" | "mobility" | "other"

export interface TrainingSession {
  id: string
  client_user_id: string
  date: string // YYYY-MM-DD
  session_type: SessionType
  rpe: number // 1-10
  duration_min: number
  session_load: number // generated = rpe * duration_min
  notes: string | null
  program_assignment_id: string | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 4: Verify table**

Use `mcp__supabase__list_tables` and confirm `training_sessions`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00132_training_sessions.sql types/database.ts
git commit -m "feat(coach-intel): training_sessions table + types"
```

---

### Task 1.2: Migration `00133_risk_flags.sql`

**Files:**
- Create: `supabase/migrations/00133_risk_flags.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Risk Flags: auto-generated alerts from rule evaluator (coach-only)
-- =====================================================================

CREATE TABLE IF NOT EXISTS risk_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  flag_type TEXT NOT NULL CHECK (flag_type IN (
    'load_spike','fatigue','overtraining','high_strain','rpe_creep'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  message TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','dismissed')),
  triggered_at DATE NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_risk_flags_user ON risk_flags(client_user_id);
CREATE INDEX idx_risk_flags_user_status ON risk_flags(client_user_id, status);
CREATE INDEX idx_risk_flags_dedupe
  ON risk_flags(client_user_id, flag_type, triggered_at);

ALTER TABLE risk_flags ENABLE ROW LEVEL SECURITY;

-- Coach-only by design — no client SELECT policy
CREATE POLICY "Admins can manage risk flags"
  ON risk_flags FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `00133_risk_flags`.

- [ ] **Step 3: Append types**

```typescript
// types/database.ts — append after TrainingSession

export type RiskFlagType =
  | "load_spike"
  | "fatigue"
  | "overtraining"
  | "high_strain"
  | "rpe_creep"

export type RiskFlagSeverity = "low" | "medium" | "high"
export type RiskFlagStatus = "open" | "acknowledged" | "dismissed"

export interface RiskFlagEvidence {
  // Open shape — each rule writes its own fields. Common fields:
  asOf?: string
  acwr?: number
  acuteLoad?: number
  chronicLoad?: number
  monotony?: number
  strain?: number
  weeklyLoad?: number
  prevWeeklyLoad?: number
  deltaPct?: number
  recentReadinessScores?: { date: string; readiness_score: number }[]
  recentRpes?: { date: string; rpe: number }[]
}

export interface RiskFlag {
  id: string
  client_user_id: string
  flag_type: RiskFlagType
  severity: RiskFlagSeverity
  message: string
  evidence: RiskFlagEvidence
  status: RiskFlagStatus
  triggered_at: string
  created_at: string
  acknowledged_at: string | null
  acknowledged_by: string | null
}
```

- [ ] **Step 4: Verify table**

Use `mcp__supabase__list_tables` and confirm `risk_flags`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00133_risk_flags.sql types/database.ts
git commit -m "feat(coach-intel): risk_flags table + types"
```

---

## Phase 2 — Pure Compute Modules

All files in `lib/coach-intel/`. No Supabase imports. Pure functions over arrays + dates.

### Task 2.1: `thresholds.ts`

**Files:**
- Create: `lib/coach-intel/thresholds.ts`

- [ ] **Step 1: Write the constants module**

```typescript
// lib/coach-intel/thresholds.ts
//
// Fixed thresholds for rule-based risk-flag generation. Tuned after
// real-world use; updates are one-file edits.

export const ACWR_DANGER = 1.5
export const ACWR_SWEET_SPOT_LOW = 0.8
export const ACWR_SWEET_SPOT_HIGH = 1.3

export const READINESS_FATIGUE_THRESHOLD = 40
export const FATIGUE_CONSECUTIVE_DAYS = 3

export const WEEKLY_LOAD_SPIKE_PCT = 30

export const MONOTONY_HIGH = 2.0

export const RPE_CREEP_THRESHOLD = 8
export const RPE_CREEP_CONSECUTIVE_SESSIONS = 3

export const ACUTE_WINDOW_DAYS = 7
export const CHRONIC_WINDOW_DAYS = 28
```

- [ ] **Step 2: Commit**

```bash
git add lib/coach-intel/thresholds.ts
git commit -m "feat(coach-intel): named threshold constants"
```

---

### Task 2.2: `load.ts` — dailyLoads, rollingAverage, acuteLoad, chronicLoad, acwr

**Files:**
- Create: `lib/coach-intel/load.ts`
- Test: `__tests__/lib/coach-intel/load.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/coach-intel/load.test.ts
import { describe, it, expect } from "vitest"
import {
  dailyLoads,
  rollingAverage,
  acuteLoad,
  chronicLoad,
  acwr,
} from "@/lib/coach-intel/load"

const sessions = [
  { date: "2026-05-10", session_load: 200 },
  { date: "2026-05-10", session_load: 100 }, // two sessions same day
  { date: "2026-05-12", session_load: 300 },
]

describe("dailyLoads", () => {
  it("sums multiple sessions per day", () => {
    const r = dailyLoads(sessions, "2026-05-10", "2026-05-12")
    expect(r.find((d) => d.date === "2026-05-10")?.load).toBe(300)
  })

  it("fills missing dates with 0", () => {
    const r = dailyLoads(sessions, "2026-05-10", "2026-05-12")
    expect(r).toHaveLength(3)
    expect(r.find((d) => d.date === "2026-05-11")?.load).toBe(0)
  })
})

describe("rollingAverage", () => {
  it("returns simple unweighted means of N-day windows ending each day", () => {
    const dl = [
      { date: "2026-05-10", load: 100 },
      { date: "2026-05-11", load: 200 },
      { date: "2026-05-12", load: 300 },
    ]
    const r = rollingAverage(dl, 2)
    expect(r.find((d) => d.date === "2026-05-12")?.value).toBe(250)
    expect(r.find((d) => d.date === "2026-05-11")?.value).toBe(150)
  })

  it("uses available days when window exceeds data length", () => {
    const dl = [{ date: "2026-05-10", load: 100 }]
    const r = rollingAverage(dl, 7)
    expect(r[0].value).toBe(100)
  })
})

describe("acuteLoad / chronicLoad", () => {
  it("acuteLoad is 7-day mean ending on asOf", () => {
    const dl = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-05-${String(10 + i).padStart(2, "0")}`,
      load: 100,
    }))
    expect(acuteLoad(dl, "2026-05-19")).toBe(100)
  })

  it("chronicLoad is 28-day mean ending on asOf", () => {
    const dl = Array.from({ length: 28 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, "0")}`,
      load: 200,
    }))
    expect(chronicLoad(dl, "2026-04-28")).toBe(200)
  })
})

describe("acwr", () => {
  it("returns acute/chronic when chronic > 0", () => {
    const dl = Array.from({ length: 28 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, "0")}`,
      load: i < 21 ? 100 : 200, // first 21 days low, last 7 days high
    }))
    const r = acwr(dl, "2026-05-28")!
    expect(r).toBeGreaterThan(1.0)
  })

  it("returns null when chronic is 0 (insufficient history)", () => {
    const dl = [{ date: "2026-05-28", load: 100 }]
    expect(acwr(dl, "2026-05-28")).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/lib/coach-intel/load.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the module**

```typescript
// lib/coach-intel/load.ts
import { ACUTE_WINDOW_DAYS, CHRONIC_WINDOW_DAYS } from "./thresholds"

export interface SessionInput {
  date: string
  session_load: number
}

export interface DailyLoad {
  date: string
  load: number
}

export interface RollingPoint {
  date: string
  value: number
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  const start = new Date(from + "T00:00:00Z")
  const end = new Date(to + "T00:00:00Z")
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export function dailyLoads(
  sessions: SessionInput[],
  from: string,
  to: string,
): DailyLoad[] {
  const sums = new Map<string, number>()
  for (const s of sessions) {
    if (s.date >= from && s.date <= to) {
      sums.set(s.date, (sums.get(s.date) ?? 0) + s.session_load)
    }
  }
  return dateRange(from, to).map((d) => ({ date: d, load: sums.get(d) ?? 0 }))
}

export function rollingAverage(
  daily: DailyLoad[],
  windowDays: number,
): RollingPoint[] {
  return daily.map((_, i) => {
    const start = Math.max(0, i - windowDays + 1)
    const slice = daily.slice(start, i + 1)
    const sum = slice.reduce((a, b) => a + b.load, 0)
    return { date: daily[i].date, value: sum / slice.length }
  })
}

function windowMean(daily: DailyLoad[], asOf: string, windowDays: number): number {
  const end = new Date(asOf + "T00:00:00Z")
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (windowDays - 1))
  const startStr = start.toISOString().slice(0, 10)
  const slice = daily.filter((d) => d.date >= startStr && d.date <= asOf)
  if (slice.length === 0) return 0
  return slice.reduce((a, b) => a + b.load, 0) / slice.length
}

export function acuteLoad(daily: DailyLoad[], asOf: string): number {
  return windowMean(daily, asOf, ACUTE_WINDOW_DAYS)
}

export function chronicLoad(daily: DailyLoad[], asOf: string): number {
  return windowMean(daily, asOf, CHRONIC_WINDOW_DAYS)
}

export function acwr(daily: DailyLoad[], asOf: string): number | null {
  const chronic = chronicLoad(daily, asOf)
  if (chronic === 0) return null
  return acuteLoad(daily, asOf) / chronic
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/lib/coach-intel/load.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/coach-intel/load.ts __tests__/lib/coach-intel/load.test.ts
git commit -m "feat(coach-intel): dailyLoads + rolling + acuteLoad + chronicLoad + acwr"
```

---

### Task 2.3: `monotony.ts` — weeklyStats

**Files:**
- Create: `lib/coach-intel/monotony.ts`
- Test: `__tests__/lib/coach-intel/monotony.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/coach-intel/monotony.test.ts
import { describe, it, expect } from "vitest"
import { weeklyStats } from "@/lib/coach-intel/monotony"

describe("weeklyStats", () => {
  it("computes totalLoad, mean, stdDev, monotony, strain over a 7-day window", () => {
    const daily = [
      { date: "2026-05-04", load: 100 }, // Mon
      { date: "2026-05-05", load: 200 },
      { date: "2026-05-06", load: 150 },
      { date: "2026-05-07", load: 250 },
      { date: "2026-05-08", load: 100 },
      { date: "2026-05-09", load: 0 },
      { date: "2026-05-10", load: 0 }, // Sun
    ]
    const s = weeklyStats(daily, "2026-05-04")
    expect(s.totalLoad).toBe(800)
    expect(s.mean).toBeCloseTo(800 / 7)
    expect(s.stdDev).toBeGreaterThan(0)
    expect(s.monotony).not.toBeNull()
    expect(s.strain).not.toBeNull()
  })

  it("returns null monotony/strain when stdDev is 0 (uniform load)", () => {
    const daily = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-05-${String(4 + i).padStart(2, "0")}`,
      load: 100,
    }))
    const s = weeklyStats(daily, "2026-05-04")
    expect(s.stdDev).toBe(0)
    expect(s.monotony).toBeNull()
    expect(s.strain).toBeNull()
  })

  it("returns null monotony/strain when week is entirely empty", () => {
    const s = weeklyStats([], "2026-05-04")
    expect(s.totalLoad).toBe(0)
    expect(s.mean).toBe(0)
    expect(s.monotony).toBeNull()
    expect(s.strain).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/lib/coach-intel/monotony.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the module**

```typescript
// lib/coach-intel/monotony.ts
import type { DailyLoad } from "./load"

export interface WeeklyStats {
  weekStart: string // YYYY-MM-DD (the input)
  totalLoad: number
  mean: number
  stdDev: number
  monotony: number | null
  strain: number | null
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function weeklyStats(daily: DailyLoad[], weekStart: string): WeeklyStats {
  const weekEnd = addDays(weekStart, 6)
  const slice = daily.filter((d) => d.date >= weekStart && d.date <= weekEnd)

  // Use the 7-day window even when some days are missing — treat as 0.
  const loads = Array.from({ length: 7 }, (_, i) => {
    const target = addDays(weekStart, i)
    return slice.find((d) => d.date === target)?.load ?? 0
  })

  const totalLoad = loads.reduce((a, b) => a + b, 0)
  const mean = totalLoad / 7
  const variance = loads.reduce((acc, v) => acc + (v - mean) ** 2, 0) / 7
  const stdDev = Math.sqrt(variance)
  const monotony = stdDev > 0 ? mean / stdDev : null
  const strain = monotony !== null ? totalLoad * monotony : null

  return { weekStart, totalLoad, mean, stdDev, monotony, strain }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/lib/coach-intel/monotony.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/coach-intel/monotony.ts __tests__/lib/coach-intel/monotony.test.ts
git commit -m "feat(coach-intel): weeklyStats (mean, stdDev, monotony, strain)"
```

---

### Task 2.4: `week-over-week.ts`

**Files:**
- Create: `lib/coach-intel/week-over-week.ts`
- Test: `__tests__/lib/coach-intel/week-over-week.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/coach-intel/week-over-week.test.ts
import { describe, it, expect } from "vitest"
import { weekOverWeek } from "@/lib/coach-intel/week-over-week"

describe("weekOverWeek", () => {
  it("reports +50% when current week is 1.5x prior week", () => {
    const daily = [
      // prior week: 7 days x 100 = 700 total
      ...Array.from({ length: 7 }, (_, i) => ({
        date: `2026-04-${String(27 + i).padStart(2, "0")}`,
        load: 100,
      })),
      // current week: 7 days x 150 = 1050 total
      ...Array.from({ length: 7 }, (_, i) => ({
        date: `2026-05-${String(4 + i).padStart(2, "0")}`,
        load: 150,
      })),
    ]
    const r = weekOverWeek(daily, "2026-05-04")
    expect(r.current.totalLoad).toBe(1050)
    expect(r.previous.totalLoad).toBe(700)
    expect(r.deltaPct).toBeCloseTo(50, 1)
  })

  it("returns null deltaPct when previous week had zero load", () => {
    const daily = [
      ...Array.from({ length: 7 }, (_, i) => ({
        date: `2026-05-${String(4 + i).padStart(2, "0")}`,
        load: 100,
      })),
    ]
    const r = weekOverWeek(daily, "2026-05-04")
    expect(r.deltaPct).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/lib/coach-intel/week-over-week.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the module**

```typescript
// lib/coach-intel/week-over-week.ts
import type { DailyLoad } from "./load"

export interface WeekSummary {
  weekStart: string
  totalLoad: number
}

export interface WeekOverWeek {
  current: WeekSummary
  previous: WeekSummary
  deltaPct: number | null
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function sumWeek(daily: DailyLoad[], start: string): number {
  const end = addDays(start, 6)
  return daily.filter((d) => d.date >= start && d.date <= end).reduce((a, b) => a + b.load, 0)
}

export function weekOverWeek(daily: DailyLoad[], currentWeekStart: string): WeekOverWeek {
  const prevStart = addDays(currentWeekStart, -7)
  const current = { weekStart: currentWeekStart, totalLoad: sumWeek(daily, currentWeekStart) }
  const previous = { weekStart: prevStart, totalLoad: sumWeek(daily, prevStart) }
  const deltaPct =
    previous.totalLoad > 0
      ? ((current.totalLoad - previous.totalLoad) / previous.totalLoad) * 100
      : null
  return { current, previous, deltaPct }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/lib/coach-intel/week-over-week.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/coach-intel/week-over-week.ts __tests__/lib/coach-intel/week-over-week.test.ts
git commit -m "feat(coach-intel): weekOverWeek delta"
```

---

### Task 2.5: `compliance.ts`

**Files:**
- Create: `lib/coach-intel/compliance.ts`
- Test: `__tests__/lib/coach-intel/compliance.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/coach-intel/compliance.test.ts
import { describe, it, expect } from "vitest"
import { compliance } from "@/lib/coach-intel/compliance"

describe("compliance", () => {
  it("returns 75% when 3 of 4 scheduled assignments have a completed session", () => {
    const scheduled = [
      { id: "a1", scheduled_date: "2026-05-04" },
      { id: "a2", scheduled_date: "2026-05-05" },
      { id: "a3", scheduled_date: "2026-05-06" },
      { id: "a4", scheduled_date: "2026-05-07" },
    ]
    const completed = [
      { program_assignment_id: "a1" },
      { program_assignment_id: "a2" },
      { program_assignment_id: "a3" },
    ]
    const r = compliance(scheduled, completed, "2026-05-04", "2026-05-07")
    expect(r.scheduledCount).toBe(4)
    expect(r.completedCount).toBe(3)
    expect(r.pct).toBe(75)
  })

  it("returns 100% pct when no sessions are scheduled (avoids div/0)", () => {
    const r = compliance([], [], "2026-05-04", "2026-05-07")
    expect(r.pct).toBe(100)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/lib/coach-intel/compliance.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the module**

```typescript
// lib/coach-intel/compliance.ts

export interface ScheduledAssignmentInput {
  id: string
  scheduled_date: string
}

export interface CompletedSessionInput {
  program_assignment_id: string | null
}

export interface ComplianceResult {
  scheduledCount: number
  completedCount: number
  pct: number // 0-100
}

export function compliance(
  scheduled: ScheduledAssignmentInput[],
  completed: CompletedSessionInput[],
  from: string,
  to: string,
): ComplianceResult {
  const inWindow = scheduled.filter((a) => a.scheduled_date >= from && a.scheduled_date <= to)
  const completedIds = new Set(
    completed.map((s) => s.program_assignment_id).filter((id): id is string => Boolean(id)),
  )
  const completedCount = inWindow.filter((a) => completedIds.has(a.id)).length
  const scheduledCount = inWindow.length
  const pct =
    scheduledCount === 0 ? 100 : Math.round((completedCount / scheduledCount) * 100)
  return { scheduledCount, completedCount, pct }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/lib/coach-intel/compliance.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/coach-intel/compliance.ts __tests__/lib/coach-intel/compliance.test.ts
git commit -m "feat(coach-intel): compliance %"
```

---

### Task 2.6: `evaluate-rules.ts` — pure rule evaluator

**Files:**
- Create: `lib/coach-intel/evaluate-rules.ts`
- Test: `__tests__/lib/coach-intel/evaluate-rules.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/coach-intel/evaluate-rules.test.ts
import { describe, it, expect } from "vitest"
import { evaluateRules } from "@/lib/coach-intel/evaluate-rules"

const asOf = "2026-05-13"

function dlSession(date: string, rpe: number, durationMin = 60) {
  return { date, rpe, duration_min: durationMin, session_load: rpe * durationMin }
}

describe("evaluateRules", () => {
  it("fires load_spike when ACWR > 1.5", () => {
    // chronic = 28 days of low load; acute = 7 days of very high load
    const sessions = [
      ...Array.from({ length: 21 }, (_, i) => dlSession(`2026-04-${String(15 + i).padStart(2, "0")}`, 4)),
      ...Array.from({ length: 7 }, (_, i) => dlSession(`2026-05-${String(7 + i).padStart(2, "0")}`, 9)),
    ]
    const flags = evaluateRules({ sessions, readiness: [], asOf })
    expect(flags.find((f) => f.flag_type === "load_spike")).toBeDefined()
  })

  it("does NOT fire load_spike when ACWR within sweet spot", () => {
    const sessions = Array.from({ length: 28 }, (_, i) =>
      dlSession(`2026-04-${String(15 + i).padStart(2, "0")}`, 5),
    )
    const flags = evaluateRules({ sessions, readiness: [], asOf })
    expect(flags.find((f) => f.flag_type === "load_spike")).toBeUndefined()
  })

  it("fires fatigue when readiness < 40 for 3 consecutive days", () => {
    const readiness = [
      { date: "2026-05-11", readiness_score: 30 },
      { date: "2026-05-12", readiness_score: 35 },
      { date: "2026-05-13", readiness_score: 38 },
    ]
    const flags = evaluateRules({ sessions: [], readiness, asOf })
    expect(flags.find((f) => f.flag_type === "fatigue")).toBeDefined()
  })

  it("does NOT fire fatigue when only 2 consecutive low days", () => {
    const readiness = [
      { date: "2026-05-12", readiness_score: 30 },
      { date: "2026-05-13", readiness_score: 35 },
    ]
    const flags = evaluateRules({ sessions: [], readiness, asOf })
    expect(flags.find((f) => f.flag_type === "fatigue")).toBeUndefined()
  })

  it("fires overtraining when weekly load Δ > 30%", () => {
    const sessions = [
      // prior week: 7 days x 200 load
      ...Array.from({ length: 7 }, (_, i) => dlSession(`2026-04-${String(27 + i).padStart(2, "0")}`, 5, 40)),
      // current week: 7 days x 350 load (+75%)
      ...Array.from({ length: 7 }, (_, i) => dlSession(`2026-05-${String(4 + i).padStart(2, "0")}`, 7, 50)),
    ]
    const flags = evaluateRules({ sessions, readiness: [], asOf: "2026-05-10" })
    expect(flags.find((f) => f.flag_type === "overtraining")).toBeDefined()
  })

  it("fires rpe_creep when last 3 sessions all have RPE > 8", () => {
    const sessions = [
      dlSession("2026-05-11", 9),
      dlSession("2026-05-12", 9),
      dlSession("2026-05-13", 10),
    ]
    const flags = evaluateRules({ sessions, readiness: [], asOf })
    expect(flags.find((f) => f.flag_type === "rpe_creep")).toBeDefined()
  })

  it("returns no flags for empty inputs (cold start)", () => {
    const flags = evaluateRules({ sessions: [], readiness: [], asOf })
    expect(flags).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/lib/coach-intel/evaluate-rules.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the module**

```typescript
// lib/coach-intel/evaluate-rules.ts
import type { RiskFlagType, RiskFlagSeverity, RiskFlagEvidence } from "@/types/database"
import { dailyLoads, acuteLoad, chronicLoad, acwr, type SessionInput } from "./load"
import { weeklyStats } from "./monotony"
import { weekOverWeek } from "./week-over-week"
import {
  ACWR_DANGER,
  READINESS_FATIGUE_THRESHOLD,
  FATIGUE_CONSECUTIVE_DAYS,
  WEEKLY_LOAD_SPIKE_PCT,
  MONOTONY_HIGH,
  RPE_CREEP_THRESHOLD,
  RPE_CREEP_CONSECUTIVE_SESSIONS,
} from "./thresholds"

export interface SessionWithRpe extends SessionInput {
  rpe: number
}

export interface ReadinessInput {
  date: string
  readiness_score: number
}

export interface ProposedFlag {
  flag_type: RiskFlagType
  severity: RiskFlagSeverity
  message: string
  evidence: RiskFlagEvidence
  triggered_at: string
}

export interface EvaluateInput {
  sessions: SessionWithRpe[]
  readiness: ReadinessInput[]
  asOf: string // YYYY-MM-DD
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function loadSpike(input: EvaluateInput): ProposedFlag | null {
  const from = addDays(input.asOf, -28)
  const daily = dailyLoads(input.sessions, from, input.asOf)
  const ratio = acwr(daily, input.asOf)
  if (ratio === null || ratio <= ACWR_DANGER) return null
  return {
    flag_type: "load_spike",
    severity: "high",
    message: `ACWR ${ratio.toFixed(2)} — high load spike (target ≤ ${ACWR_DANGER})`,
    evidence: {
      asOf: input.asOf,
      acwr: Number(ratio.toFixed(2)),
      acuteLoad: Math.round(acuteLoad(daily, input.asOf)),
      chronicLoad: Math.round(chronicLoad(daily, input.asOf)),
    },
    triggered_at: input.asOf,
  }
}

function fatigue(input: EvaluateInput): ProposedFlag | null {
  const need = FATIGUE_CONSECUTIVE_DAYS
  const recent = [...input.readiness]
    .filter((r) => r.date <= input.asOf)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, need)
  if (recent.length < need) return null
  if (!recent.every((r) => r.readiness_score < READINESS_FATIGUE_THRESHOLD)) return null
  return {
    flag_type: "fatigue",
    severity: "medium",
    message: `Readiness < ${READINESS_FATIGUE_THRESHOLD} for ${need} consecutive days`,
    evidence: { asOf: input.asOf, recentReadinessScores: recent },
    triggered_at: input.asOf,
  }
}

function overtraining(input: EvaluateInput): ProposedFlag | null {
  // Current week = asOf - 6 .. asOf
  const currentWeekStart = addDays(input.asOf, -6)
  const from = addDays(currentWeekStart, -7)
  const daily = dailyLoads(input.sessions, from, input.asOf)
  const wow = weekOverWeek(daily, currentWeekStart)
  if (wow.deltaPct === null || wow.deltaPct <= WEEKLY_LOAD_SPIKE_PCT) return null
  return {
    flag_type: "overtraining",
    severity: "high",
    message: `Weekly load up ${wow.deltaPct.toFixed(0)}% vs prior week`,
    evidence: {
      asOf: input.asOf,
      weeklyLoad: wow.current.totalLoad,
      prevWeeklyLoad: wow.previous.totalLoad,
      deltaPct: Number(wow.deltaPct.toFixed(2)),
    },
    triggered_at: input.asOf,
  }
}

function highStrain(input: EvaluateInput): ProposedFlag | null {
  const currentWeekStart = addDays(input.asOf, -6)
  const daily = dailyLoads(input.sessions, currentWeekStart, input.asOf)
  const w = weeklyStats(daily, currentWeekStart)
  if (w.monotony === null || w.monotony <= MONOTONY_HIGH) return null
  return {
    flag_type: "high_strain",
    severity: "medium",
    message: `Weekly monotony ${w.monotony.toFixed(2)} (target ≤ ${MONOTONY_HIGH})`,
    evidence: {
      asOf: input.asOf,
      monotony: Number(w.monotony.toFixed(2)),
      strain: w.strain !== null ? Math.round(w.strain) : undefined,
      weeklyLoad: w.totalLoad,
    },
    triggered_at: input.asOf,
  }
}

function rpeCreep(input: EvaluateInput): ProposedFlag | null {
  const need = RPE_CREEP_CONSECUTIVE_SESSIONS
  const recent = [...input.sessions]
    .filter((s) => s.date <= input.asOf)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, need)
  if (recent.length < need) return null
  if (!recent.every((s) => s.rpe > RPE_CREEP_THRESHOLD)) return null
  return {
    flag_type: "rpe_creep",
    severity: "low",
    message: `Last ${need} sessions all RPE > ${RPE_CREEP_THRESHOLD}`,
    evidence: {
      asOf: input.asOf,
      recentRpes: recent.map((r) => ({ date: r.date, rpe: r.rpe })),
    },
    triggered_at: input.asOf,
  }
}

const RULES = [loadSpike, fatigue, overtraining, highStrain, rpeCreep] as const

export function evaluateRules(input: EvaluateInput): ProposedFlag[] {
  return RULES.map((r) => r(input)).filter((f): f is ProposedFlag => f !== null)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/lib/coach-intel/evaluate-rules.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/coach-intel/evaluate-rules.ts __tests__/lib/coach-intel/evaluate-rules.test.ts
git commit -m "feat(coach-intel): rule evaluator (5 rules, pure)"
```

---

## Phase 3 — DAL

### Task 3.1: `lib/db/training-sessions.ts`

**Files:**
- Create: `lib/db/training-sessions.ts`
- Test: `__tests__/lib/db/training-sessions.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/db/training-sessions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const supabaseMock = { from: vi.fn() }
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => supabaseMock,
}))

import { upsert, getLatest } from "@/lib/db/training-sessions"

beforeEach(() => vi.clearAllMocks())

describe("training-sessions DAL", () => {
  it("upsert calls supabase.upsert with onConflict on (client_user_id, date, session_type)", async () => {
    const upsertFn = vi.fn().mockReturnValue({
      select: () => ({ single: () => ({ data: { id: "t1" }, error: null }) }),
    })
    supabaseMock.from.mockReturnValue({ upsert: upsertFn })
    await upsert("u1", {
      date: "2026-05-13",
      session_type: "gym",
      rpe: 7,
      duration_min: 60,
      notes: null,
      program_assignment_id: null,
    } as never)
    expect(upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        client_user_id: "u1",
        date: "2026-05-13",
        session_type: "gym",
        rpe: 7,
      }),
      { onConflict: "client_user_id,date,session_type" },
    )
  })

  it("getLatest orders by date desc and limits N", async () => {
    const rows = [{ id: "t1" }]
    supabaseMock.from.mockReturnValue({
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => ({ data: rows, error: null }) }) }),
      }),
    })
    const r = await getLatest("u1", 10)
    expect(r).toEqual(rows)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/lib/db/training-sessions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the DAL**

```typescript
// lib/db/training-sessions.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { TrainingSession, SessionType } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getByUserAndDateAndType(
  clientUserId: string,
  date: string,
  sessionType: SessionType,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("training_sessions")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("date", date)
    .eq("session_type", sessionType)
    .maybeSingle()
  if (error) return null
  return data as TrainingSession | null
}

export async function listByUser(
  clientUserId: string,
  opts: { from?: string; to?: string; sessionType?: SessionType } = {},
) {
  const supabase = getClient()
  let q = supabase.from("training_sessions").select("*").eq("client_user_id", clientUserId)
  if (opts.from) q = q.gte("date", opts.from)
  if (opts.to) q = q.lte("date", opts.to)
  if (opts.sessionType) q = q.eq("session_type", opts.sessionType)
  const { data, error } = await q.order("date", { ascending: false })
  if (error) throw error
  return data as TrainingSession[]
}

export async function getById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("training_sessions")
    .select("*")
    .eq("id", id)
    .single()
  if (error) return null
  return data as TrainingSession
}

export async function upsert(
  clientUserId: string,
  payload: Omit<TrainingSession, "id" | "client_user_id" | "session_load" | "created_at" | "updated_at">,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("training_sessions")
    .upsert(
      { client_user_id: clientUserId, ...payload },
      { onConflict: "client_user_id,date,session_type" },
    )
    .select()
    .single()
  if (error) throw error
  return data as TrainingSession
}

export async function update(
  id: string,
  patch: Partial<Omit<TrainingSession, "id" | "client_user_id" | "session_load" | "created_at" | "updated_at">>,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("training_sessions")
    .update(patch)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as TrainingSession
}

export async function deleteOne(id: string) {
  const supabase = getClient()
  const { error } = await supabase.from("training_sessions").delete().eq("id", id)
  if (error) throw error
}

export async function getLatest(clientUserId: string, n = 10) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("training_sessions")
    .select("*")
    .eq("client_user_id", clientUserId)
    .order("date", { ascending: false })
    .limit(n)
  if (error) throw error
  return data as TrainingSession[]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/lib/db/training-sessions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/training-sessions.ts __tests__/lib/db/training-sessions.test.ts
git commit -m "feat(coach-intel): training-sessions DAL"
```

---

### Task 3.2: `lib/db/risk-flags.ts`

**Files:**
- Create: `lib/db/risk-flags.ts`
- Test: `__tests__/lib/db/risk-flags.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/db/risk-flags.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const supabaseMock = { from: vi.fn() }
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => supabaseMock,
}))

import { createIfNew, acknowledge } from "@/lib/db/risk-flags"

beforeEach(() => vi.clearAllMocks())

describe("risk-flags DAL", () => {
  it("createIfNew returns null when an open flag of same type exists within 7 days", async () => {
    // First call: existing-flag lookup returns 1 row
    supabaseMock.from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              gte: () => ({ data: [{ id: "existing" }], error: null }),
            }),
          }),
        }),
      }),
    })
    const r = await createIfNew("u1", {
      flag_type: "fatigue",
      severity: "medium",
      message: "x",
      evidence: {},
      triggered_at: "2026-05-13",
    })
    expect(r).toBeNull()
  })

  it("createIfNew inserts when no recent open flag of same type exists", async () => {
    // First call: existing-flag lookup returns no rows
    supabaseMock.from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              gte: () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
    })
    // Second call: insert
    const insertFn = vi.fn().mockReturnValue({
      select: () => ({ single: () => ({ data: { id: "f1" }, error: null }) }),
    })
    supabaseMock.from.mockReturnValueOnce({ insert: insertFn })
    const r = await createIfNew("u1", {
      flag_type: "fatigue",
      severity: "medium",
      message: "x",
      evidence: {},
      triggered_at: "2026-05-13",
    })
    expect(r).toEqual({ id: "f1" })
    expect(insertFn).toHaveBeenCalled()
  })

  it("acknowledge sets status='acknowledged' + acknowledged_at + acknowledged_by", async () => {
    const updateFn = vi.fn().mockReturnValue({
      eq: () => ({ select: () => ({ single: () => ({ data: { id: "f1" }, error: null }) }) }),
    })
    supabaseMock.from.mockReturnValue({ update: updateFn })
    await acknowledge("f1", "admin-1")
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "acknowledged",
        acknowledged_by: "admin-1",
      }),
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/lib/db/risk-flags.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the DAL**

```typescript
// lib/db/risk-flags.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { RiskFlag, RiskFlagStatus, RiskFlagType } from "@/types/database"
import type { ProposedFlag } from "@/lib/coach-intel/evaluate-rules"

function getClient() {
  return createServiceRoleClient()
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function listByUser(
  clientUserId: string,
  opts: { status?: RiskFlagStatus; flagType?: RiskFlagType } = {},
) {
  const supabase = getClient()
  let q = supabase.from("risk_flags").select("*").eq("client_user_id", clientUserId)
  if (opts.status) q = q.eq("status", opts.status)
  if (opts.flagType) q = q.eq("flag_type", opts.flagType)
  const { data, error } = await q.order("triggered_at", { ascending: false })
  if (error) throw error
  return data as RiskFlag[]
}

export async function getOpenByUser(clientUserId: string) {
  return listByUser(clientUserId, { status: "open" })
}

export async function getCountByUser(
  clientUserId: string,
  status: RiskFlagStatus = "open",
) {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("risk_flags")
    .select("*", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .eq("status", status)
  if (error) throw error
  return count ?? 0
}

export async function createIfNew(clientUserId: string, proposed: ProposedFlag) {
  const supabase = getClient()
  const since = addDays(proposed.triggered_at, -7)
  const { data: existing, error: lookupErr } = await supabase
    .from("risk_flags")
    .select("id")
    .eq("client_user_id", clientUserId)
    .eq("flag_type", proposed.flag_type)
    .eq("status", "open")
    .gte("triggered_at", since)
  if (lookupErr) throw lookupErr
  if (existing && existing.length > 0) return null

  const { data, error } = await supabase
    .from("risk_flags")
    .insert({ client_user_id: clientUserId, ...proposed })
    .select()
    .single()
  if (error) throw error
  return data as RiskFlag
}

export async function acknowledge(id: string, byUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("risk_flags")
    .update({
      status: "acknowledged",
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: byUserId,
    })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as RiskFlag
}

export async function dismiss(id: string, byUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("risk_flags")
    .update({
      status: "dismissed",
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: byUserId,
    })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as RiskFlag
}

/** Close open flags whose rule no longer fires this evaluation cycle. */
export async function closeStaleByType(clientUserId: string, flagType: RiskFlagType) {
  const supabase = getClient()
  const { error } = await supabase
    .from("risk_flags")
    .update({
      status: "dismissed",
      acknowledged_at: new Date().toISOString(),
    })
    .eq("client_user_id", clientUserId)
    .eq("flag_type", flagType)
    .eq("status", "open")
  if (error) throw error
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/lib/db/risk-flags.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/risk-flags.ts __tests__/lib/db/risk-flags.test.ts
git commit -m "feat(coach-intel): risk-flags DAL with dedupe-aware createIfNew"
```

---

## Phase 4 — Evaluator Orchestrator

### Task 4.1: `lib/coach-intel/run-evaluation.ts`

**Files:**
- Create: `lib/coach-intel/run-evaluation.ts`
- Test: `__tests__/lib/coach-intel/run-evaluation.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// __tests__/lib/coach-intel/run-evaluation.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/training-sessions", () => ({
  listByUser: vi.fn(),
}))
vi.mock("@/lib/db/daily-readiness", () => ({
  listByUser: vi.fn(),
}))
vi.mock("@/lib/db/risk-flags", () => ({
  createIfNew: vi.fn(),
  closeStaleByType: vi.fn(),
}))

import * as tsDal from "@/lib/db/training-sessions"
import * as drDal from "@/lib/db/daily-readiness"
import * as rfDal from "@/lib/db/risk-flags"
import { runEvaluation } from "@/lib/coach-intel/run-evaluation"

beforeEach(() => vi.clearAllMocks())

describe("runEvaluation", () => {
  it("calls createIfNew for each proposed flag returned by the evaluator", async () => {
    // Stack 3 high-RPE sessions to fire rpe_creep
    ;(tsDal.listByUser as any).mockResolvedValue([
      { date: "2026-05-11", rpe: 9, duration_min: 60, session_load: 540 },
      { date: "2026-05-12", rpe: 9, duration_min: 60, session_load: 540 },
      { date: "2026-05-13", rpe: 9, duration_min: 60, session_load: 540 },
    ])
    ;(drDal.listByUser as any).mockResolvedValue([])
    ;(rfDal.createIfNew as any).mockResolvedValue({ id: "f1" })

    const result = await runEvaluation("u1", "2026-05-13")

    expect(rfDal.createIfNew).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ flag_type: "rpe_creep" }),
    )
    expect(result.created.length).toBeGreaterThan(0)
  })

  it("calls closeStaleByType for rules that did not fire", async () => {
    ;(tsDal.listByUser as any).mockResolvedValue([])
    ;(drDal.listByUser as any).mockResolvedValue([])

    await runEvaluation("u1", "2026-05-13")

    // No rule fires for empty input → every rule type should be passed to closeStaleByType
    expect(rfDal.closeStaleByType).toHaveBeenCalledWith("u1", "load_spike")
    expect(rfDal.closeStaleByType).toHaveBeenCalledWith("u1", "rpe_creep")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/lib/coach-intel/run-evaluation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the orchestrator**

```typescript
// lib/coach-intel/run-evaluation.ts
import { listByUser as listTrainingSessions } from "@/lib/db/training-sessions"
import { listByUser as listReadiness } from "@/lib/db/daily-readiness"
import { createIfNew, closeStaleByType } from "@/lib/db/risk-flags"
import { evaluateRules } from "./evaluate-rules"
import type { RiskFlag, RiskFlagType } from "@/types/database"

const ALL_FLAG_TYPES: RiskFlagType[] = [
  "load_spike",
  "fatigue",
  "overtraining",
  "high_strain",
  "rpe_creep",
]

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export interface RunEvaluationResult {
  created: RiskFlag[]
  closedTypes: RiskFlagType[]
}

export async function runEvaluation(
  clientUserId: string,
  asOf: string,
): Promise<RunEvaluationResult> {
  const from = addDays(asOf, -35) // 28-day chronic window + safety margin

  const [sessions, readiness] = await Promise.all([
    listTrainingSessions(clientUserId, { from, to: asOf }),
    listReadiness(clientUserId, { from, to: asOf }),
  ])

  const proposed = evaluateRules({
    sessions: sessions.map((s) => ({
      date: s.date,
      rpe: s.rpe,
      duration_min: s.duration_min,
      session_load: s.session_load,
    })),
    readiness: readiness.map((r) => ({ date: r.date, readiness_score: r.readiness_score })),
    asOf,
  })

  const created: RiskFlag[] = []
  for (const p of proposed) {
    const c = await createIfNew(clientUserId, p)
    if (c) created.push(c)
  }

  // Close any open flags for rules that didn't fire this run
  const firedTypes = new Set(proposed.map((p) => p.flag_type))
  const closedTypes: RiskFlagType[] = []
  for (const t of ALL_FLAG_TYPES) {
    if (!firedTypes.has(t)) {
      await closeStaleByType(clientUserId, t)
      closedTypes.push(t)
    }
  }

  return { created, closedTypes }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/lib/coach-intel/run-evaluation.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/coach-intel/run-evaluation.ts __tests__/lib/coach-intel/run-evaluation.test.ts
git commit -m "feat(coach-intel): runEvaluation orchestrator (load → eval → persist)"
```

---

### Task 4.2: Wire `runEvaluation` into `/api/readiness`

**Files:**
- Modify: `app/api/readiness/route.ts`

- [ ] **Step 1: Read current route**

Run: `Read app/api/readiness/route.ts` (already done — keep current shape; just add the evaluator call).

- [ ] **Step 2: Update the route**

Replace the file content with:

```typescript
// app/api/readiness/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { readinessFormSchema } from "@/lib/validators/daily-readiness"
import { upsert } from "@/lib/db/daily-readiness"
import { runEvaluation } from "@/lib/coach-intel/run-evaluation"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json()
  const parsed = readinessFormSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }

  const { date, ...rest } = parsed.data
  const targetUserId =
    session.user.role === "admin" && body.client_user_id
      ? (body.client_user_id as string)
      : session.user.id

  const result = await upsert(targetUserId, date, rest)

  // Fire and forget the rule evaluator. Failures are logged but do not affect the write.
  try {
    await runEvaluation(targetUserId, date)
  } catch (e) {
    console.error("[readiness] runEvaluation failed", e)
  }

  return NextResponse.json({ readiness: result })
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/readiness/route.ts
git commit -m "feat(coach-intel): trigger runEvaluation after readiness upsert"
```

---

## Phase 5 — API Routes

### Task 5.1: `POST /api/training-sessions` + `PATCH/DELETE /api/training-sessions/[id]`

**Files:**
- Create: `app/api/training-sessions/route.ts`
- Create: `app/api/training-sessions/[id]/route.ts`

- [ ] **Step 1: Write the route + validator usage**

First create the validator. **Files:** `lib/validators/training-session.ts`

```typescript
// lib/validators/training-session.ts
import { z } from "zod"

export const SESSION_TYPES = ["gym", "sport", "field", "conditioning", "mobility", "other"] as const

export const SESSION_TYPE_LABELS: Record<(typeof SESSION_TYPES)[number], string> = {
  gym: "Gym",
  sport: "Sport practice",
  field: "Field",
  conditioning: "Conditioning",
  mobility: "Mobility",
  other: "Other",
}

export const trainingSessionFormSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  session_type: z.enum(SESSION_TYPES),
  rpe: z.number().int().min(1).max(10),
  duration_min: z.number().int().min(1).max(600),
  notes: z.string().max(1000).nullable(),
  program_assignment_id: z.string().uuid().nullable(),
})

export type TrainingSessionFormData = z.infer<typeof trainingSessionFormSchema>
```

- [ ] **Step 2: Write `app/api/training-sessions/route.ts`**

```typescript
// app/api/training-sessions/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { trainingSessionFormSchema } from "@/lib/validators/training-session"
import { upsert, listByUser } from "@/lib/db/training-sessions"
import { runEvaluation } from "@/lib/coach-intel/run-evaluation"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const url = new URL(req.url)
  const clientUserId =
    session.user.role === "admin" && url.searchParams.get("client_user_id")
      ? url.searchParams.get("client_user_id")!
      : session.user.id
  const sessions = await listByUser(clientUserId)
  return NextResponse.json({ sessions })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json()
  const parsed = trainingSessionFormSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const clientUserId =
    session.user.role === "admin" && body.client_user_id
      ? (body.client_user_id as string)
      : session.user.id

  const result = await upsert(clientUserId, parsed.data)

  try {
    await runEvaluation(clientUserId, parsed.data.date)
  } catch (e) {
    console.error("[training-sessions] runEvaluation failed", e)
  }

  return NextResponse.json({ session: result })
}
```

- [ ] **Step 3: Write `app/api/training-sessions/[id]/route.ts`**

```typescript
// app/api/training-sessions/[id]/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { trainingSessionFormSchema } from "@/lib/validators/training-session"
import { update, deleteOne, getById } from "@/lib/db/training-sessions"
import { runEvaluation } from "@/lib/coach-intel/run-evaluation"

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
  const parsed = trainingSessionFormSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const updated = await update(id, parsed.data)
  try {
    await runEvaluation(existing.client_user_id, updated.date)
  } catch (e) {
    console.error("[training-sessions] runEvaluation failed", e)
  }
  return NextResponse.json({ session: updated })
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
  await deleteOne(id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/validators/training-session.ts app/api/training-sessions/
git commit -m "feat(coach-intel): training-sessions API + validator"
```

---

### Task 5.2: Risk-flag PATCH + summary + trend + re-evaluate endpoints

**Files:**
- Create: `app/api/risk-flags/[id]/route.ts`
- Create: `app/api/clients/[id]/training/load-trend/route.ts`
- Create: `app/api/clients/[id]/coach-intel/summary/route.ts`
- Create: `app/api/clients/[id]/coach-intel/re-evaluate/route.ts`

- [ ] **Step 1: Write the risk-flag PATCH**

```typescript
// app/api/risk-flags/[id]/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { acknowledge, dismiss } from "@/lib/db/risk-flags"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json()
  if (body.action === "acknowledge") {
    const flag = await acknowledge(id, session.user.id)
    return NextResponse.json({ flag })
  }
  if (body.action === "dismiss") {
    const flag = await dismiss(id, session.user.id)
    return NextResponse.json({ flag })
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400 })
}
```

- [ ] **Step 2: Write the load-trend endpoint**

```typescript
// app/api/clients/[id]/training/load-trend/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listByUser } from "@/lib/db/training-sessions"
import { dailyLoads, rollingAverage } from "@/lib/coach-intel/load"
import { ACUTE_WINDOW_DAYS, CHRONIC_WINDOW_DAYS } from "@/lib/coach-intel/thresholds"

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  if (session.user.role !== "admin" && session.user.id !== id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const url = new URL(req.url)
  const days = Math.min(Number(url.searchParams.get("days") ?? 30) || 30, 365)
  const today = new Date().toISOString().slice(0, 10)
  const from = addDays(today, -(days + CHRONIC_WINDOW_DAYS)) // include warmup for rolling
  const sessions = await listByUser(id, { from, to: today })
  const daily = dailyLoads(sessions, from, today)
  const acute = rollingAverage(daily, ACUTE_WINDOW_DAYS)
  const chronic = rollingAverage(daily, CHRONIC_WINDOW_DAYS)

  // Trim to the requested visible window
  const visibleFrom = addDays(today, -(days - 1))
  const filterFn = <T extends { date: string }>(arr: T[]) =>
    arr.filter((d) => d.date >= visibleFrom)
  return NextResponse.json({
    daily: filterFn(daily),
    acute: filterFn(acute),
    chronic: filterFn(chronic),
  })
}
```

- [ ] **Step 3: Write the coach-intel summary endpoint**

```typescript
// app/api/clients/[id]/coach-intel/summary/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listByUser } from "@/lib/db/training-sessions"
import { listByUser as listReadiness } from "@/lib/db/daily-readiness"
import { getOpenByUser } from "@/lib/db/risk-flags"
import { dailyLoads, acuteLoad, chronicLoad, acwr } from "@/lib/coach-intel/load"
import { weeklyStats } from "@/lib/coach-intel/monotony"
import { weekOverWeek } from "@/lib/coach-intel/week-over-week"
import { CHRONIC_WINDOW_DAYS } from "@/lib/coach-intel/thresholds"

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const { id } = await params
  const today = new Date().toISOString().slice(0, 10)
  const from = addDays(today, -(CHRONIC_WINDOW_DAYS + 7))

  const [sessions, readiness, openFlags] = await Promise.all([
    listByUser(id, { from, to: today }),
    listReadiness(id, { from, to: today }),
    getOpenByUser(id),
  ])

  const daily = dailyLoads(sessions, from, today)
  const currentWeekStart = addDays(today, -6)
  const week = weeklyStats(daily, currentWeekStart)
  const wow = weekOverWeek(daily, currentWeekStart)

  return NextResponse.json({
    summary: {
      asOf: today,
      acuteLoad: Math.round(acuteLoad(daily, today)),
      chronicLoad: Math.round(chronicLoad(daily, today)),
      acwr: acwr(daily, today),
      weeklyTotal: week.totalLoad,
      monotony: week.monotony,
      strain: week.strain,
      weekOverWeek: wow,
      openFlagCount: openFlags.length,
      openFlags: openFlags.slice(0, 5),
      readingsCount: readiness.length,
    },
  })
}
```

- [ ] **Step 4: Write the manual re-evaluate endpoint**

```typescript
// app/api/clients/[id]/coach-intel/re-evaluate/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { runEvaluation } from "@/lib/coach-intel/run-evaluation"

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const { id } = await params
  const today = new Date().toISOString().slice(0, 10)
  const result = await runEvaluation(id, today)
  return NextResponse.json({ result })
}
```

- [ ] **Step 5: Commit**

```bash
git add app/api/risk-flags/ app/api/clients/[id]/training/ app/api/clients/[id]/coach-intel/
git commit -m "feat(coach-intel): risk-flag PATCH + load-trend + summary + re-evaluate APIs"
```

---

## Phase 6 — Client UI

### Task 6.1: Log training session form + page

**Files:**
- Create: `components/client/coach-intel/log-training-session-form.tsx`
- Create: `app/(client)/client/training/page.tsx`

- [ ] **Step 1: Write the form**

```typescript
// components/client/coach-intel/log-training-session-form.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  SESSION_TYPES,
  SESSION_TYPE_LABELS,
  trainingSessionFormSchema,
  type TrainingSessionFormData,
} from "@/lib/validators/training-session"

export function LogTrainingSessionForm({
  initial,
  clientUserId,
}: {
  initial?: Partial<TrainingSessionFormData>
  clientUserId?: string
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const today = new Date().toISOString().slice(0, 10)

  const form = useForm<TrainingSessionFormData>({
    resolver: zodResolver(trainingSessionFormSchema),
    defaultValues: {
      date: today,
      session_type: "gym",
      rpe: 6,
      duration_min: 60,
      notes: null,
      program_assignment_id: null,
      ...initial,
    },
  })

  async function onSubmit(values: TrainingSessionFormData) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/training-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          clientUserId ? { ...values, client_user_id: clientUserId } : values,
        ),
      })
      if (!res.ok) throw new Error("Save failed")
      toast.success("Session logged")
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Date</Label>
          <Input type="date" {...form.register("date")} />
        </div>
        <div className="grid gap-2">
          <Label>Session type</Label>
          <Select
            value={form.watch("session_type")}
            onValueChange={(v) =>
              form.setValue("session_type", v as TrainingSessionFormData["session_type"])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SESSION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {SESSION_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>
          RPE <span className="text-muted-foreground">{form.watch("rpe")}/10</span>
        </Label>
        <Slider
          min={1}
          max={10}
          step={1}
          value={[form.watch("rpe")]}
          onValueChange={([v]) => form.setValue("rpe", v)}
        />
      </div>

      <div className="grid gap-2">
        <Label>Duration (minutes)</Label>
        <Input
          type="number"
          step="1"
          {...form.register("duration_min", { valueAsNumber: true })}
        />
      </div>

      <div className="grid gap-2">
        <Label>Notes</Label>
        <Textarea
          rows={3}
          {...form.register("notes", { setValueAs: (v) => (v === "" ? null : v) })}
        />
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Saving..." : "Save session"}
      </Button>
    </form>
  )
}
```

- [ ] **Step 2: Write the page**

```typescript
// app/(client)/client/training/page.tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { LogTrainingSessionForm } from "@/components/client/coach-intel/log-training-session-form"

export default async function ClientTrainingPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/training")

  return (
    <div className="container max-w-2xl py-8">
      <h1 className="font-heading mb-2 text-3xl font-bold">Log training</h1>
      <p className="text-muted-foreground mb-8">
        RPE + duration. We compute the load and trend automatically.
      </p>
      <LogTrainingSessionForm />
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/client/coach-intel/log-training-session-form.tsx "app/(client)/client/training/page.tsx"
git commit -m "feat(coach-intel): client training-log page"
```

---

### Task 6.2: Client training history page

**Files:**
- Create: `components/client/coach-intel/my-training-history.tsx`
- Create: `app/(client)/client/training/history/page.tsx`

- [ ] **Step 1: Write the history component**

```typescript
// components/client/coach-intel/my-training-history.tsx
"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SESSION_TYPE_LABELS } from "@/lib/validators/training-session"
import type { TrainingSession } from "@/types/database"

export function MyTrainingHistory({ sessions }: { sessions: TrainingSession[] }) {
  if (sessions.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-12 text-center">
          No training sessions logged yet.
        </CardContent>
      </Card>
    )
  }

  const byDate = new Map<string, number>()
  for (const s of sessions) byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.session_load)
  const chartData = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, load]) => ({ date, load }))

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Daily load (last 30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="load" fill="var(--primary)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ol className="divide-y">
            {sessions.slice(0, 20).map((s) => (
              <li key={s.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">
                    {SESSION_TYPE_LABELS[s.session_type]}
                    <span className="text-muted-foreground ml-2 text-sm">{s.date}</span>
                  </p>
                  <p className="text-muted-foreground text-sm">
                    RPE {s.rpe}/10 · {s.duration_min}min · load {s.session_load}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Write the page**

```typescript
// app/(client)/client/training/history/page.tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listByUser } from "@/lib/db/training-sessions"
import { MyTrainingHistory } from "@/components/client/coach-intel/my-training-history"

export default async function ClientTrainingHistoryPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/training/history")
  const sessions = await listByUser(session.user.id)

  return (
    <div className="container max-w-4xl py-8">
      <h1 className="font-heading mb-8 text-3xl font-bold">Training history</h1>
      <MyTrainingHistory sessions={sessions} />
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/client/coach-intel/my-training-history.tsx "app/(client)/client/training/history/page.tsx"
git commit -m "feat(coach-intel): client training-history page"
```

---

## Phase 7 — Admin UI

### Task 7.1: Admin coach-intel cards (load, ACWR, monotony/strain, WoW, compliance)

**Files:**
- Create: `components/admin/coach-intel/training-load-card.tsx`
- Create: `components/admin/coach-intel/training-load-chart.tsx`
- Create: `components/admin/coach-intel/acwr-chart.tsx`
- Create: `components/admin/coach-intel/monotony-strain-card.tsx`
- Create: `components/admin/coach-intel/week-over-week-card.tsx`
- Create: `components/admin/coach-intel/compliance-ring-card.tsx`

- [ ] **Step 1: Write `training-load-card.tsx`**

```typescript
// components/admin/coach-intel/training-load-card.tsx
"use client"

import { LineChart, Line, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function TrainingLoadCard({
  weeklyTotal,
  sparkline,
}: {
  weeklyTotal: number
  sparkline: { date: string; load: number }[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly load</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-heading text-3xl font-bold">{weeklyTotal}</p>
        <p className="text-muted-foreground text-xs">last 7 days</p>
        {sparkline.length > 1 && (
          <div className="mt-3 h-12">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline}>
                <Line
                  type="monotone"
                  dataKey="load"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Write `training-load-chart.tsx`**

```typescript
// components/admin/coach-intel/training-load-chart.tsx
"use client"

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function TrainingLoadChart({
  daily,
  acute,
  chronic,
}: {
  daily: { date: string; load: number }[]
  acute: { date: string; value: number }[]
  chronic: { date: string; value: number }[]
}) {
  const merged = daily.map((d) => ({
    date: d.date,
    load: d.load,
    acute: acute.find((a) => a.date === d.date)?.value ?? null,
    chronic: chronic.find((c) => c.date === d.date)?.value ?? null,
  }))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Training load — daily + 7d/28d rolling</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={merged}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="load" name="Daily load" fill="var(--primary)" />
              <Line
                type="monotone"
                dataKey="acute"
                name="Acute (7d)"
                stroke="var(--warning)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="chronic"
                name="Chronic (28d)"
                stroke="var(--success)"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Write `acwr-chart.tsx`**

```typescript
// components/admin/coach-intel/acwr-chart.tsx
"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceArea,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ACWR_SWEET_SPOT_LOW,
  ACWR_SWEET_SPOT_HIGH,
  ACWR_DANGER,
} from "@/lib/coach-intel/thresholds"

export function ACWRChart({
  acute,
  chronic,
}: {
  acute: { date: string; value: number }[]
  chronic: { date: string; value: number }[]
}) {
  const data = acute.map((a) => {
    const c = chronic.find((x) => x.date === a.date)?.value ?? 0
    return { date: a.date, acwr: c > 0 ? a.value / c : null }
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>ACWR (acute / chronic)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} />
              <YAxis domain={[0, 2.5]} />
              <Tooltip />
              <ReferenceArea
                y1={ACWR_SWEET_SPOT_LOW}
                y2={ACWR_SWEET_SPOT_HIGH}
                fill="var(--success)"
                fillOpacity={0.08}
              />
              <ReferenceArea
                y1={ACWR_DANGER}
                y2={2.5}
                fill="var(--error)"
                fillOpacity={0.08}
              />
              <Line
                type="monotone"
                dataKey="acwr"
                stroke="var(--primary)"
                strokeWidth={2}
                dot
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Write `monotony-strain-card.tsx`**

```typescript
// components/admin/coach-intel/monotony-strain-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MONOTONY_HIGH } from "@/lib/coach-intel/thresholds"

export function MonotonyStrainCard({
  monotony,
  strain,
}: {
  monotony: number | null
  strain: number | null
}) {
  const colorClass =
    monotony === null
      ? "text-muted-foreground"
      : monotony > MONOTONY_HIGH
        ? "text-error"
        : "text-success"
  return (
    <Card>
      <CardHeader>
        <CardTitle>Monotony &amp; strain (this week)</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-muted-foreground text-xs">Monotony</p>
          <p className={`font-heading text-3xl font-bold ${colorClass}`}>
            {monotony !== null ? monotony.toFixed(2) : "—"}
          </p>
          <p className="text-muted-foreground text-xs">target ≤ {MONOTONY_HIGH}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Strain</p>
          <p className="font-heading text-3xl font-bold">
            {strain !== null ? Math.round(strain) : "—"}
          </p>
          <p className="text-muted-foreground text-xs">load × monotony</p>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: Write `week-over-week-card.tsx`**

```typescript
// components/admin/coach-intel/week-over-week-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function WeekOverWeekCard({
  current,
  previous,
  deltaPct,
}: {
  current: { totalLoad: number }
  previous: { totalLoad: number }
  deltaPct: number | null
}) {
  const colorClass =
    deltaPct === null
      ? "text-muted-foreground"
      : deltaPct > 0
        ? "text-success"
        : "text-error"
  return (
    <Card>
      <CardHeader>
        <CardTitle>Week over week</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-muted-foreground text-xs">This week</p>
          <p className="font-heading text-3xl font-bold">{current.totalLoad}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Prior week</p>
          <p className="font-heading text-3xl font-bold">{previous.totalLoad}</p>
        </div>
        <div className="col-span-2">
          <p className="text-muted-foreground text-xs">Δ</p>
          <p className={`font-heading text-2xl font-bold ${colorClass}`}>
            {deltaPct !== null ? `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%` : "—"}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 6: Write `compliance-ring-card.tsx`**

```typescript
// components/admin/coach-intel/compliance-ring-card.tsx
"use client"

import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function ComplianceRingCard({
  scheduledCount,
  completedCount,
  pct,
}: {
  scheduledCount: number
  completedCount: number
  pct: number
}) {
  const color =
    pct >= 80 ? "var(--success)" : pct >= 60 ? "var(--warning)" : "var(--error)"
  return (
    <Card>
      <CardHeader>
        <CardTitle>Compliance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative h-40">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="70%"
              outerRadius="100%"
              data={[{ value: pct, fill: color }]}
              startAngle={210}
              endAngle={-30}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar dataKey="value" cornerRadius={6} background />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="font-heading text-3xl font-bold">{pct}%</p>
            <p className="text-muted-foreground text-xs">
              {completedCount} / {scheduledCount}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add components/admin/coach-intel/
git commit -m "feat(coach-intel): admin coach-intel cards (load, ACWR, monotony, WoW, compliance)"
```

---

### Task 7.2: Risk-flag list + card components

**Files:**
- Create: `components/admin/coach-intel/risk-flags-card.tsx`
- Create: `components/admin/coach-intel/risk-flags-list.tsx`

- [ ] **Step 1: Write `risk-flags-card.tsx`**

```typescript
// components/admin/coach-intel/risk-flags-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { RiskFlag } from "@/types/database"

const SEVERITY_CLASS: Record<RiskFlag["severity"], string> = {
  high: "text-error",
  medium: "text-warning",
  low: "text-muted-foreground",
}

export function RiskFlagsCard({ flags }: { flags: RiskFlag[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open risk flags ({flags.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {flags.length === 0 ? (
          <p className="text-muted-foreground">No open flags.</p>
        ) : (
          <ul className="space-y-2">
            {flags.slice(0, 3).map((f) => (
              <li key={f.id} className="text-sm">
                <span className={SEVERITY_CLASS[f.severity]}>● </span>
                {f.message}
                <span className="text-muted-foreground ml-2 text-xs">{f.triggered_at}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Write `risk-flags-list.tsx`**

```typescript
// components/admin/coach-intel/risk-flags-list.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { RiskFlag } from "@/types/database"

const SEVERITY_LABEL: Record<RiskFlag["severity"], string> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
}

const SEVERITY_BG: Record<RiskFlag["severity"], string> = {
  high: "bg-error/10 text-error",
  medium: "bg-warning/10 text-warning",
  low: "bg-muted text-muted-foreground",
}

export function RiskFlagsList({ flags }: { flags: RiskFlag[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function actOn(id: string, action: "acknowledge" | "dismiss") {
    setBusy(id)
    try {
      const res = await fetch(`/api/risk-flags/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success(`Flag ${action}d`)
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (flags.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-12 text-center">
          No risk flags.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ol className="divide-y">
          {flags.map((f) => (
            <li key={f.id} className="flex items-start justify-between gap-4 p-4">
              <div className="flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-bold ${SEVERITY_BG[f.severity]}`}
                  >
                    {SEVERITY_LABEL[f.severity]}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {f.flag_type} · {f.triggered_at}
                  </span>
                </div>
                <p>{f.message}</p>
              </div>
              {f.status === "open" && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === f.id}
                    onClick={() => actOn(f.id, "acknowledge")}
                  >
                    Ack
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === f.id}
                    onClick={() => actOn(f.id, "dismiss")}
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/admin/coach-intel/risk-flags-card.tsx components/admin/coach-intel/risk-flags-list.tsx
git commit -m "feat(coach-intel): risk-flag card + list with ack/dismiss"
```

---

### Task 7.3: Extend admin hub with Load + Alerts tabs

**Files:**
- Modify: `components/admin/performance/athlete-performance-hub.tsx`
- Modify: `app/(admin)/admin/clients/[id]/performance/page.tsx`

- [ ] **Step 1: Update the hub page server component to fetch coach-intel data**

```typescript
// app/(admin)/admin/clients/[id]/performance/page.tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getLatest, getReadinessTrend } from "@/lib/db/daily-readiness"
import { listByUser, getActive } from "@/lib/db/injuries"
import {
  getPRsByUser,
  listByUser as listTests,
} from "@/lib/db/performance-tests"
import { listByUser as listTrainingSessions } from "@/lib/db/training-sessions"
import { getOpenByUser } from "@/lib/db/risk-flags"
import {
  dailyLoads,
  acuteLoad,
  chronicLoad,
  acwr,
  rollingAverage,
} from "@/lib/coach-intel/load"
import { weeklyStats } from "@/lib/coach-intel/monotony"
import { weekOverWeek } from "@/lib/coach-intel/week-over-week"
import {
  ACUTE_WINDOW_DAYS,
  CHRONIC_WINDOW_DAYS,
} from "@/lib/coach-intel/thresholds"
import { AthletePerformanceHub } from "@/components/admin/performance/athlete-performance-hub"

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export default async function AdminPerformanceHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const { id } = await params
  const { tab = "overview" } = await searchParams

  const today = new Date().toISOString().slice(0, 10)
  const from = addDays(today, -(CHRONIC_WINDOW_DAYS + 7))

  const [
    latestReadiness,
    trend,
    allInjuries,
    activeInjuries,
    prs,
    recentTests,
    trainingSessions,
    openFlags,
  ] = await Promise.all([
    getLatest(id),
    getReadinessTrend(id, 30),
    listByUser(id),
    getActive(id),
    getPRsByUser(id),
    listTests(id).then((t) => t.slice(0, 10)),
    listTrainingSessions(id, { from, to: today }),
    getOpenByUser(id),
  ])

  const daily = dailyLoads(trainingSessions, from, today)
  const acute = rollingAverage(daily, ACUTE_WINDOW_DAYS)
  const chronic = rollingAverage(daily, CHRONIC_WINDOW_DAYS)
  const currentWeekStart = addDays(today, -6)
  const week = weeklyStats(daily, currentWeekStart)
  const wow = weekOverWeek(daily, currentWeekStart)

  const visibleFrom = addDays(today, -29)
  const trimDaily = daily.filter((d) => d.date >= visibleFrom)
  const trimAcute = acute.filter((d) => d.date >= visibleFrom)
  const trimChronic = chronic.filter((d) => d.date >= visibleFrom)

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
        acuteLoad: Math.round(acuteLoad(daily, today)),
        chronicLoad: Math.round(chronicLoad(daily, today)),
        acwr: acwr(daily, today),
        weeklyTotal: week.totalLoad,
        monotony: week.monotony,
        strain: week.strain,
        weekOverWeek: wow,
        dailyLoadSeries: trimDaily,
        acuteSeries: trimAcute,
        chronicSeries: trimChronic,
        openFlags,
      }}
    />
  )
}
```

- [ ] **Step 2: Update the hub component to render the new tabs**

Replace `components/admin/performance/athlete-performance-hub.tsx` with the version below (preserves the original 4 tabs and adds Load + Alerts).

```typescript
// components/admin/performance/athlete-performance-hub.tsx
"use client"

import Link from "next/link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import type {
  DailyReadiness,
  Injury,
  PerformanceTest,
  PerformanceTestPR,
  RiskFlag,
} from "@/types/database"
import { ReadinessScoreGauge } from "./readiness-score-gauge"
import { ReadinessTrendChart } from "./readiness-trend-chart"
import { ActiveInjuriesCard } from "./active-injuries-card"
import { InjuryTimelineList } from "./injury-timeline-list"
import { PRsShelfCard } from "./prs-shelf-card"
import { PerformanceTestCard } from "./performance-test-card"
import { TrainingLoadCard } from "@/components/admin/coach-intel/training-load-card"
import { TrainingLoadChart } from "@/components/admin/coach-intel/training-load-chart"
import { ACWRChart } from "@/components/admin/coach-intel/acwr-chart"
import { MonotonyStrainCard } from "@/components/admin/coach-intel/monotony-strain-card"
import { WeekOverWeekCard } from "@/components/admin/coach-intel/week-over-week-card"
import { RiskFlagsCard } from "@/components/admin/coach-intel/risk-flags-card"
import { RiskFlagsList } from "@/components/admin/coach-intel/risk-flags-list"

export interface CoachIntelSummary {
  acuteLoad: number
  chronicLoad: number
  acwr: number | null
  weeklyTotal: number
  monotony: number | null
  strain: number | null
  weekOverWeek: {
    current: { weekStart: string; totalLoad: number }
    previous: { weekStart: string; totalLoad: number }
    deltaPct: number | null
  }
  dailyLoadSeries: { date: string; load: number }[]
  acuteSeries: { date: string; value: number }[]
  chronicSeries: { date: string; value: number }[]
  openFlags: RiskFlag[]
}

export function AthletePerformanceHub({
  clientUserId,
  tab,
  latestReadiness,
  readinessTrend,
  activeInjuries,
  allInjuries,
  prs,
  recentTests,
  coachIntel,
}: {
  clientUserId: string
  tab: string
  latestReadiness: DailyReadiness | null
  readinessTrend: { date: string; readiness_score: number }[]
  activeInjuries: Injury[]
  allInjuries: Injury[]
  prs: PerformanceTestPR[]
  recentTests: PerformanceTest[]
  coachIntel: CoachIntelSummary
}) {
  const grouped = recentTests.reduce<Record<string, PerformanceTest[]>>((acc, t) => {
    const key = t.test_type === "custom" ? `custom:${t.custom_name}` : t.test_type
    acc[key] = acc[key] ?? []
    acc[key].push(t)
    return acc
  }, {})

  const sparkline = coachIntel.dailyLoadSeries.slice(-7)

  return (
    <div className="container max-w-6xl py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-3xl font-bold">Performance</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/admin/clients/${clientUserId}/performance/injuries/new`}>
              + Report injury
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/admin/clients/${clientUserId}/performance/log-session`}>
              + Log session
            </Link>
          </Button>
          <Button asChild>
            <Link href={`/admin/clients/${clientUserId}/performance/log-test`}>+ Log test</Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="overview" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=overview`}>Overview</Link>
          </TabsTrigger>
          <TabsTrigger value="readiness" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=readiness`}>Readiness</Link>
          </TabsTrigger>
          <TabsTrigger value="load" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=load`}>Load</Link>
          </TabsTrigger>
          <TabsTrigger value="alerts" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=alerts`}>
              Alerts ({coachIntel.openFlags.length})
            </Link>
          </TabsTrigger>
          <TabsTrigger value="injuries" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=injuries`}>Injuries</Link>
          </TabsTrigger>
          <TabsTrigger value="tests" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=tests`}>Tests</Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 grid gap-6 md:grid-cols-2">
          <ReadinessScoreGauge readiness={latestReadiness} />
          <TrainingLoadCard weeklyTotal={coachIntel.weeklyTotal} sparkline={sparkline} />
          <ActiveInjuriesCard injuries={activeInjuries} clientUserId={clientUserId} />
          <RiskFlagsCard flags={coachIntel.openFlags} />
          <PRsShelfCard prs={prs} />
          {recentTests[0] && (
            <PerformanceTestCard
              latest={recentTests[0]}
              history={recentTests
                .filter((t) => t.test_type === recentTests[0].test_type)
                .slice(0, 10)}
              clientUserId={clientUserId}
            />
          )}
        </TabsContent>

        <TabsContent value="readiness" className="mt-6">
          <ReadinessTrendChart data={readinessTrend} />
        </TabsContent>

        <TabsContent value="load" className="mt-6 space-y-6">
          <TrainingLoadChart
            daily={coachIntel.dailyLoadSeries}
            acute={coachIntel.acuteSeries}
            chronic={coachIntel.chronicSeries}
          />
          <ACWRChart acute={coachIntel.acuteSeries} chronic={coachIntel.chronicSeries} />
          <div className="grid gap-4 md:grid-cols-2">
            <MonotonyStrainCard monotony={coachIntel.monotony} strain={coachIntel.strain} />
            <WeekOverWeekCard
              current={coachIntel.weekOverWeek.current}
              previous={coachIntel.weekOverWeek.previous}
              deltaPct={coachIntel.weekOverWeek.deltaPct}
            />
          </div>
        </TabsContent>

        <TabsContent value="alerts" className="mt-6">
          <RiskFlagsList flags={coachIntel.openFlags} />
        </TabsContent>

        <TabsContent value="injuries" className="mt-6">
          <InjuryTimelineList injuries={allInjuries} clientUserId={clientUserId} />
        </TabsContent>

        <TabsContent value="tests" className="mt-6 grid gap-4 md:grid-cols-2">
          {Object.entries(grouped).map(([key, list]) => (
            <PerformanceTestCard
              key={key}
              latest={list[0]}
              history={list}
              clientUserId={clientUserId}
            />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/clients/[id]/performance/page.tsx" components/admin/performance/athlete-performance-hub.tsx
git commit -m "feat(coach-intel): admin hub Load + Alerts tabs + Overview cards"
```

---

### Task 7.4: Admin log-session page

**Files:**
- Create: `app/(admin)/admin/clients/[id]/performance/log-session/page.tsx`

- [ ] **Step 1: Write the page**

```typescript
// app/(admin)/admin/clients/[id]/performance/log-session/page.tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { LogTrainingSessionForm } from "@/components/client/coach-intel/log-training-session-form"

export default async function AdminLogSessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const { id } = await params
  return (
    <div className="container max-w-2xl py-8">
      <h1 className="font-heading mb-6 text-2xl font-bold">Log training session</h1>
      <LogTrainingSessionForm clientUserId={id} />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/(admin)/admin/clients/[id]/performance/log-session/"
git commit -m "feat(coach-intel): admin log-session page"
```

---

## Phase 8 — E2E + Verification

### Task 8.1: Playwright e2e

**Files:**
- Create: `__tests__/e2e/coach-intelligence.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
// __tests__/e2e/coach-intelligence.spec.ts
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

test.describe("Coach Intelligence", () => {
  test("athlete logs a training session", async ({ page }) => {
    test.skip(!CLIENT_EMAIL || !CLIENT_PASSWORD, "E2E client creds not set")
    await signIn(page, CLIENT_EMAIL!, CLIENT_PASSWORD!)
    await page.goto("/client/training")
    await page.getByRole("button", { name: /save session/i }).click()
    await expect(page.getByText(/session logged/i)).toBeVisible()
  })

  test("admin sees Load and Alerts tabs on the hub", async ({ page }) => {
    test.skip(
      !ADMIN_EMAIL || !ADMIN_PASSWORD || !CLIENT_USER_ID,
      "E2E admin creds or client id not set",
    )
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!)
    await page.goto(`/admin/clients/${CLIENT_USER_ID}/performance`)
    await expect(page.getByRole("tab", { name: /load/i })).toBeVisible()
    await expect(page.getByRole("tab", { name: /alerts/i })).toBeVisible()
  })
})
```

- [ ] **Step 2: Commit**

```bash
git add __tests__/e2e/coach-intelligence.spec.ts
git commit -m "test(coach-intel): e2e for training-log + admin tabs"
```

---

### Task 8.2: Final verification

**Files:** none modified — verification only.

- [ ] **Step 1: Run coach-intel tests**

Run: `npm run test:run -- __tests__/lib/coach-intel/ __tests__/lib/db/training-sessions.test.ts __tests__/lib/db/risk-flags.test.ts`
Expected: all PASS. Total ~25 tests.

- [ ] **Step 2: Run full Vitest suite to check for regressions**

Run: `npm run test:run`
Expected: existing perf-db tests still pass; pre-existing admin/shop revalidatePath failures are noise (carried over from before). No new failures.

- [ ] **Step 3: Format perf-db files**

```bash
npx prettier --write \
  "lib/coach-intel/*.ts" \
  "lib/db/training-sessions.ts" "lib/db/risk-flags.ts" \
  "lib/validators/training-session.ts" \
  "components/admin/coach-intel/*.tsx" \
  "components/client/coach-intel/*.tsx" \
  "app/api/training-sessions/**/*.ts" \
  "app/api/risk-flags/**/*.ts" \
  "app/api/clients/[id]/training/**/*.ts" \
  "app/api/clients/[id]/coach-intel/**/*.ts" \
  "__tests__/lib/coach-intel/*.ts" \
  "__tests__/lib/db/training-sessions.test.ts" \
  "__tests__/lib/db/risk-flags.test.ts" \
  "__tests__/e2e/coach-intelligence.spec.ts"
```

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: build succeeds. **Watch for the same `zod .default()` resolver issue from Sub-project 1** — if a form validator uses `.default()`, the inferred input/output types diverge and `useForm<T>` rejects the resolver. The training-session validator avoids this (no `.default()` in §5.1 Task 5.1). If the build complains about a similar mismatch elsewhere, drop the `.default()` and supply the value via `defaultValues`.

- [ ] **Step 5: Manual smoke**

```bash
npm run dev
```

- Sign in as a client → `/client/training` → log a session (RPE 9, duration 60 → load 540) → toast appears.
- Repeat 2 more days with RPE 9 → on the third entry, the `rpe_creep` rule fires.
- Sign in as admin → `/admin/clients/[client-id]/performance` → Overview tab shows `RiskFlagsCard` with the rpe_creep flag → Alerts tab shows it with Ack/Dismiss → click Ack → flag disappears.
- Load tab shows the daily/acute/chronic chart, ACWR chart, monotony+strain card, week-over-week card.

- [ ] **Step 6: Final commit (if any cleanup)**

```bash
git status
git commit -am "chore(coach-intel): final cleanup" 2>/dev/null || true
```

---

## Self-Review (completed inline)

**Spec coverage:**

| Spec section | Implemented by |
|---|---|
| §4.1 training_sessions | Task 1.1 |
| §4.2 risk_flags | Task 1.2 |
| §5 lib/coach-intel/* | Tasks 2.1–2.6 |
| §6.1 training-sessions DAL | Task 3.1 |
| §6.2 risk-flags DAL | Task 3.2 |
| §6.3 run-evaluation orchestrator | Task 4.1 |
| §7.1 client routes | Tasks 6.1, 6.2 |
| §7.2 admin hub new tabs + Overview cards | Task 7.3 |
| §7.3 admin log-session route | Task 7.4 |
| §8 API routes | Tasks 4.2, 5.1, 5.2 |
| §9 components | Tasks 7.1, 7.2 |
| §10 migrations | Tasks 1.1, 1.2 |
| §11 testing | Throughout + Task 8.1 |
| §15 Definition of Done | Task 8.2 |

No gaps detected.

**Placeholder check:** No "TBD" / vague hand-waving. Every code block is complete.

**Type consistency:** `RiskFlagType`, `RiskFlagSeverity`, `ProposedFlag`, `CoachIntelSummary`, function names (`runEvaluation`, `evaluateRules`, `acwr`, `weeklyStats`, `weekOverWeek`, `compliance`, `dailyLoads`) are referenced consistently across all tasks. `lib/coach-intel/load.ts` exports `SessionInput`, `DailyLoad`, `RollingPoint` — all consumed correctly by `monotony.ts`, `week-over-week.ts`, `evaluate-rules.ts`.

---

## Execution

The user has requested execution via the **ralph-loop** plugin (same as Sub-project 1).

**Estimated ralph iterations:** ~16 (one per task, with a couple of tasks sharing iterations as I did with Sub-project 1's pull-forward decisions).

**Alternative paths** if not using ralph-loop:
1. **Subagent-Driven** (`superpowers:subagent-driven-development`)
2. **Inline Execution** (`superpowers:executing-plans`)

After choosing the execution path, the implementer marks each `- [ ]` complete as work progresses.
