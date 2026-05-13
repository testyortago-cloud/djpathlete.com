# Athlete Performance Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. The user has also requested execution via the `ralph-loop` plugin — see "Execution" at the bottom. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the data foundation for the Athlete Performance Database — daily readiness logging, longitudinal injury tracking, and standalone performance tests with PR/trend detection — plus an admin Athlete Performance Hub.

**Architecture:** Four new Supabase tables + one SQL view, accessed via service-role DAL functions in `lib/db/`. Zod validators in `lib/validators/`. Client-facing pages under `app/(client)/client/` for self-logging; admin hub under `app/(admin)/admin/clients/[id]/performance/`. Charts via Recharts. No Airtable, no ACWR/risk math (deferred to Sub-project 2), no body-map picker (deferred to Sub-project 3).

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase Postgres (service-role from server), NextAuth v5, Tailwind v4 (Green Azure + Gray Orange brand), shadcn/ui (new-york), Recharts, React Hook Form + Zod, Vitest, Playwright.

**Source spec:** [docs/superpowers/specs/2026-05-13-athlete-performance-core-design.md](../specs/2026-05-13-athlete-performance-core-design.md)

## Conventions locked from existing code (deviations from spec)

These override the spec where they differ — the spec used generic SQL conventions; we match the project's actual conventions:

- **Column name for client FK:** `client_user_id UUID REFERENCES users(id) ON DELETE CASCADE` (matches `performance_assessments` — newer convention than `client_profiles.user_id`)
- **Enums:** `TEXT NOT NULL CHECK (col IN ('a','b','c'))` — Postgres ENUM types are NOT used in this project
- **RLS admin check:** `EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')`
- **Migration numbers:** start at `00127` (current highest is `00126_ads_agent_lifecycle.sql`)
- **Service-role DAL pattern:** `function getClient() { return createServiceRoleClient() }`; types cast at boundary, no `Database` generic
- **Migrations applied via:** `mcp__supabase__apply_migration` (CLI not linked — see `memory/supabase_migrations_via_mcp.md`)
- **No feature branches:** commits go directly to `main` (see `memory/work_directly_on_main.md`)

---

## File Structure

### New files

```
supabase/migrations/
  00127_daily_readiness.sql
  00128_injuries.sql
  00129_performance_tests.sql
  00130_performance_test_pr_view.sql

lib/validators/
  daily-readiness.ts
  injury.ts
  performance-test.ts

lib/db/
  daily-readiness.ts
  injuries.ts
  performance-tests.ts

app/api/readiness/route.ts
app/api/injuries/route.ts
app/api/injuries/[id]/route.ts
app/api/injuries/[id]/milestones/route.ts
app/api/injuries/[id]/milestones/[index]/route.ts
app/api/performance-tests/route.ts
app/api/performance-tests/[id]/route.ts
app/api/clients/[id]/performance/summary/route.ts
app/api/clients/[id]/readiness/trend/route.ts
app/api/clients/[id]/tests/[testType]/history/route.ts

app/(client)/client/readiness/page.tsx
app/(client)/client/readiness/history/page.tsx
app/(client)/client/injuries/page.tsx
app/(client)/client/injuries/[id]/page.tsx
app/(client)/client/performance/page.tsx
app/(client)/client/performance/[testType]/page.tsx

app/(admin)/admin/clients/[id]/performance/page.tsx
app/(admin)/admin/clients/[id]/performance/log-test/page.tsx
app/(admin)/admin/clients/[id]/performance/injuries/new/page.tsx

components/shared/status-pill.tsx
components/admin/performance/
  readiness-score-gauge.tsx
  readiness-trend-chart.tsx
  active-injuries-card.tsx
  injury-timeline-list.tsx
  injury-rehab-milestone-list.tsx
  performance-test-card.tsx
  performance-test-history-chart.tsx
  prs-shelf-card.tsx
  athlete-performance-hub.tsx
components/client/performance/
  log-readiness-form.tsx
  log-test-dialog.tsx
  report-injury-form.tsx
  my-readiness-history.tsx
  my-performance-tests.tsx

__tests__/lib/db/daily-readiness.test.ts
__tests__/lib/db/injuries.test.ts
__tests__/lib/db/performance-tests.test.ts
__tests__/lib/validators/daily-readiness.test.ts
__tests__/lib/validators/injury.test.ts
__tests__/lib/validators/performance-test.test.ts
__tests__/e2e/athlete-performance.spec.ts
```

### Modified files

- `types/database.ts` — append new types (`DailyReadiness`, `Injury`, `RehabMilestone`, `PerformanceTest`, enums)
- `components/admin/sidebar.tsx` (or wherever the admin client detail page nav lives) — add "Performance" link inside the per-client section (verify exact path during Task 4.3)

---

## Phase 1 — Daily Readiness

### Task 1.1: Migration `00127_daily_readiness.sql`

**Files:**
- Create: `supabase/migrations/00127_daily_readiness.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Daily Readiness: time-series wellness check-in per athlete per day
-- =====================================================================

CREATE TABLE IF NOT EXISTS daily_readiness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,

  sleep_hours NUMERIC(4,2),
  sleep_quality INT NOT NULL CHECK (sleep_quality BETWEEN 1 AND 5),
  soreness_overall INT NOT NULL CHECK (soreness_overall BETWEEN 1 AND 5),
  soreness_by_region JSONB NOT NULL DEFAULT '{}'::jsonb,
  fatigue INT NOT NULL CHECK (fatigue BETWEEN 1 AND 5),
  mood INT NOT NULL CHECK (mood BETWEEN 1 AND 5),
  stress INT NOT NULL CHECK (stress BETWEEN 1 AND 5),
  hydration INT NOT NULL CHECK (hydration BETWEEN 1 AND 5),
  resting_hr INT CHECK (resting_hr IS NULL OR resting_hr BETWEEN 20 AND 200),
  hrv_ms INT CHECK (hrv_ms IS NULL OR hrv_ms BETWEEN 0 AND 500),
  notes TEXT,

  readiness_score NUMERIC(5,2) GENERATED ALWAYS AS (
    ROUND(
      (((sleep_quality - 1)::numeric / 4) * 25) +
      (((5 - soreness_overall)::numeric / 4) * 20) +
      (((5 - fatigue)::numeric / 4) * 20) +
      (((mood - 1)::numeric / 4) * 15) +
      (((5 - stress)::numeric / 4) * 10) +
      (((hydration - 1)::numeric / 4) * 10),
      2
    )
  ) STORED,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT daily_readiness_user_date_unique UNIQUE (client_user_id, date)
);

CREATE INDEX idx_daily_readiness_user ON daily_readiness(client_user_id);
CREATE INDEX idx_daily_readiness_user_date ON daily_readiness(client_user_id, date DESC);

CREATE TRIGGER set_daily_readiness_updated_at
  BEFORE UPDATE ON daily_readiness
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE daily_readiness ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage daily readiness"
  ON daily_readiness FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Clients can view own readiness"
  ON daily_readiness FOR SELECT TO authenticated
  USING (client_user_id = auth.uid());

CREATE POLICY "Clients can insert own readiness"
  ON daily_readiness FOR INSERT TO authenticated
  WITH CHECK (client_user_id = auth.uid());

CREATE POLICY "Clients can update own readiness"
  ON daily_readiness FOR UPDATE TO authenticated
  USING (client_user_id = auth.uid());
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use the `mcp__supabase__apply_migration` tool with name `00127_daily_readiness` and the SQL body above.

Expected: success response, no error.

- [ ] **Step 3: Append types to `types/database.ts`**

Add at the end of the file (preserve existing exports):

```typescript
// ============================================
// Athlete Performance Core (added 2026-05-13)
// ============================================

export interface DailyReadiness {
  id: string
  client_user_id: string
  date: string // YYYY-MM-DD
  sleep_hours: number | null
  sleep_quality: number // 1-5
  soreness_overall: number // 1-5
  soreness_by_region: Record<string, number> // body_region key -> 1-5
  fatigue: number // 1-5
  mood: number // 1-5
  stress: number // 1-5
  hydration: number // 1-5
  resting_hr: number | null
  hrv_ms: number | null
  notes: string | null
  readiness_score: number // 0-100, generated
  created_at: string
  updated_at: string
}
```

- [ ] **Step 4: Verify the table exists**

Use `mcp__supabase__list_tables` and confirm `daily_readiness` is present with all 18 columns.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00127_daily_readiness.sql types/database.ts
git commit -m "feat(perf-db): daily_readiness table + types"
```

---

### Task 1.2: Validator `lib/validators/daily-readiness.ts`

**Files:**
- Create: `lib/validators/daily-readiness.ts`
- Test: `__tests__/lib/validators/daily-readiness.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/validators/daily-readiness.test.ts
import { describe, it, expect } from "vitest"
import { readinessFormSchema, READINESS_FIELDS } from "@/lib/validators/daily-readiness"

describe("readinessFormSchema", () => {
  const validInput = {
    date: "2026-05-13",
    sleep_hours: 7.5,
    sleep_quality: 4,
    soreness_overall: 2,
    soreness_by_region: { hamstring: 3 },
    fatigue: 2,
    mood: 4,
    stress: 2,
    hydration: 4,
    resting_hr: 58,
    hrv_ms: 65,
    notes: "felt fresh",
  }

  it("accepts a valid input", () => {
    const result = readinessFormSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it("rejects ratings outside 1-5", () => {
    const r = readinessFormSchema.safeParse({ ...validInput, fatigue: 6 })
    expect(r.success).toBe(false)
  })

  it("accepts null optional fields", () => {
    const r = readinessFormSchema.safeParse({
      ...validInput,
      sleep_hours: null,
      resting_hr: null,
      hrv_ms: null,
      notes: null,
    })
    expect(r.success).toBe(true)
  })

  it("READINESS_FIELDS exposes all 1-5 fields with inverted flags", () => {
    expect(READINESS_FIELDS.some((f) => f.key === "soreness_overall" && f.inverted)).toBe(true)
    expect(READINESS_FIELDS.some((f) => f.key === "sleep_quality" && !f.inverted)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run __tests__/lib/validators/daily-readiness.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the validator**

```typescript
// lib/validators/daily-readiness.ts
import { z } from "zod"

const rating = z.number().int().min(1).max(5)

export const READINESS_FIELDS = [
  { key: "sleep_quality", label: "Sleep Quality", inverted: false },
  { key: "soreness_overall", label: "Soreness", inverted: true },
  { key: "fatigue", label: "Fatigue", inverted: true },
  { key: "mood", label: "Mood", inverted: false },
  { key: "stress", label: "Stress", inverted: true },
  { key: "hydration", label: "Hydration", inverted: false },
] as const

export const readinessFormSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  sleep_hours: z.number().min(0).max(24).nullable(),
  sleep_quality: rating,
  soreness_overall: rating,
  soreness_by_region: z.record(z.string(), rating).default({}),
  fatigue: rating,
  mood: rating,
  stress: rating,
  hydration: rating,
  resting_hr: z.number().int().min(20).max(200).nullable(),
  hrv_ms: z.number().int().min(0).max(500).nullable(),
  notes: z.string().max(2000).nullable(),
})

export type ReadinessFormData = z.infer<typeof readinessFormSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run __tests__/lib/validators/daily-readiness.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/validators/daily-readiness.ts __tests__/lib/validators/daily-readiness.test.ts
git commit -m "feat(perf-db): daily-readiness validator"
```

---

### Task 1.3: DAL `lib/db/daily-readiness.ts`

**Files:**
- Create: `lib/db/daily-readiness.ts`
- Test: `__tests__/lib/db/daily-readiness.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/db/daily-readiness.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const supabaseMock = {
  from: vi.fn(),
}
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => supabaseMock,
}))

import {
  getByUserAndDate,
  listByUser,
  upsert,
  getLatest,
  getReadinessTrend,
} from "@/lib/db/daily-readiness"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("daily-readiness DAL", () => {
  it("getByUserAndDate returns single row", async () => {
    const expected = { id: "r1", client_user_id: "u1", date: "2026-05-13", readiness_score: 75 }
    const single = vi.fn().mockResolvedValue({ data: expected, error: null })
    supabaseMock.from.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ single }) }) }),
    })
    const r = await getByUserAndDate("u1", "2026-05-13")
    expect(r).toEqual(expected)
  })

  it("upsert calls supabase.upsert with onConflict", async () => {
    const upsertFn = vi.fn().mockReturnValue({ select: () => ({ single: () => ({ data: { id: "r1" }, error: null }) }) })
    supabaseMock.from.mockReturnValue({ upsert: upsertFn })
    await upsert("u1", "2026-05-13", { sleep_quality: 4 } as never)
    expect(upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({ client_user_id: "u1", date: "2026-05-13", sleep_quality: 4 }),
      { onConflict: "client_user_id,date" },
    )
  })

  it("getReadinessTrend returns date + score pairs", async () => {
    const rows = [
      { date: "2026-05-12", readiness_score: 70 },
      { date: "2026-05-13", readiness_score: 80 },
    ]
    supabaseMock.from.mockReturnValue({
      select: () => ({
        eq: () => ({ gte: () => ({ order: () => ({ data: rows, error: null }) }) }),
      }),
    })
    const r = await getReadinessTrend("u1", 7)
    expect(r).toEqual(rows)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run __tests__/lib/db/daily-readiness.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the DAL**

```typescript
// lib/db/daily-readiness.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { DailyReadiness } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function getByUserAndDate(clientUserId: string, date: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("daily_readiness")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("date", date)
    .single()
  if (error) return null
  return data as DailyReadiness
}

export async function listByUser(
  clientUserId: string,
  opts: { from?: string; to?: string } = {},
) {
  const supabase = getClient()
  let q = supabase.from("daily_readiness").select("*").eq("client_user_id", clientUserId)
  if (opts.from) q = q.gte("date", opts.from)
  if (opts.to) q = q.lte("date", opts.to)
  const { data, error } = await q.order("date", { ascending: false })
  if (error) throw error
  return data as DailyReadiness[]
}

export async function upsert(
  clientUserId: string,
  date: string,
  payload: Omit<DailyReadiness, "id" | "client_user_id" | "date" | "readiness_score" | "created_at" | "updated_at">,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("daily_readiness")
    .upsert(
      { client_user_id: clientUserId, date, ...payload },
      { onConflict: "client_user_id,date" },
    )
    .select()
    .single()
  if (error) throw error
  return data as DailyReadiness
}

export async function getLatest(clientUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("daily_readiness")
    .select("*")
    .eq("client_user_id", clientUserId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data as DailyReadiness | null
}

export async function getReadinessTrend(clientUserId: string, days = 30) {
  const supabase = getClient()
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from("daily_readiness")
    .select("date, readiness_score")
    .eq("client_user_id", clientUserId)
    .gte("date", from)
    .order("date", { ascending: true })
  if (error) throw error
  return data as { date: string; readiness_score: number }[]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run __tests__/lib/db/daily-readiness.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/daily-readiness.ts __tests__/lib/db/daily-readiness.test.ts
git commit -m "feat(perf-db): daily-readiness DAL"
```

---

### Task 1.4: API route `POST /api/readiness`

**Files:**
- Create: `app/api/readiness/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// app/api/readiness/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { readinessFormSchema } from "@/lib/validators/daily-readiness"
import { upsert } from "@/lib/db/daily-readiness"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json()
  const parsed = readinessFormSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }

  const { date, ...rest } = parsed.data
  // Admins can submit on behalf of any client via body.client_user_id; clients can only submit for themselves
  const targetUserId =
    session.user.role === "admin" && body.client_user_id ? (body.client_user_id as string) : session.user.id

  const result = await upsert(targetUserId, date, rest)
  return NextResponse.json({ readiness: result })
}
```

- [ ] **Step 2: Manually verify route compiles**

Run: `npm run build` (just check no TS errors for this file; full build runs in Task 6.3).
Expected: no errors for `app/api/readiness/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/api/readiness/route.ts
git commit -m "feat(perf-db): POST /api/readiness"
```

---

### Task 1.5: Client form page `/client/readiness`

**Files:**
- Create: `components/client/performance/log-readiness-form.tsx`
- Create: `app/(client)/client/readiness/page.tsx`

- [ ] **Step 1: Write the form component**

```typescript
// components/client/performance/log-readiness-form.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { READINESS_FIELDS, readinessFormSchema, type ReadinessFormData } from "@/lib/validators/daily-readiness"

export function LogReadinessForm({ initial }: { initial?: Partial<ReadinessFormData> }) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const form = useForm<ReadinessFormData>({
    resolver: zodResolver(readinessFormSchema),
    defaultValues: {
      date: today,
      sleep_hours: 7.5,
      sleep_quality: 3,
      soreness_overall: 3,
      soreness_by_region: {},
      fatigue: 3,
      mood: 3,
      stress: 3,
      hydration: 3,
      resting_hr: null,
      hrv_ms: null,
      notes: null,
      ...initial,
    },
  })

  async function onSubmit(values: ReadinessFormData) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/readiness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      })
      if (!res.ok) throw new Error("Save failed")
      toast.success("Readiness logged")
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid gap-2">
        <Label>Date</Label>
        <Input type="date" {...form.register("date")} />
      </div>

      <div className="grid gap-2">
        <Label>Sleep hours</Label>
        <Input
          type="number"
          step="0.25"
          {...form.register("sleep_hours", { valueAsNumber: true, setValueAs: (v) => (v === "" ? null : Number(v)) })}
        />
      </div>

      {READINESS_FIELDS.map((f) => {
        const value = form.watch(f.key as keyof ReadinessFormData) as number
        return (
          <div key={f.key} className="grid gap-2">
            <Label>
              {f.label} <span className="text-muted-foreground">{value}/5</span>
            </Label>
            <Slider
              min={1}
              max={5}
              step={1}
              value={[value]}
              onValueChange={([v]) => form.setValue(f.key as keyof ReadinessFormData, v as never)}
            />
          </div>
        )
      })}

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Resting HR (bpm)</Label>
          <Input
            type="number"
            {...form.register("resting_hr", { setValueAs: (v) => (v === "" ? null : Number(v)) })}
          />
        </div>
        <div className="grid gap-2">
          <Label>HRV (ms)</Label>
          <Input
            type="number"
            {...form.register("hrv_ms", { setValueAs: (v) => (v === "" ? null : Number(v)) })}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Notes</Label>
        <Textarea rows={3} {...form.register("notes", { setValueAs: (v) => (v === "" ? null : v) })} />
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Saving..." : "Save readiness"}
      </Button>
    </form>
  )
}
```

- [ ] **Step 2: Write the page**

```typescript
// app/(client)/client/readiness/page.tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getByUserAndDate } from "@/lib/db/daily-readiness"
import { LogReadinessForm } from "@/components/client/performance/log-readiness-form"

export default async function ReadinessPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/readiness")

  const today = new Date().toISOString().slice(0, 10)
  const existing = await getByUserAndDate(session.user.id, today)

  return (
    <div className="container max-w-2xl py-8">
      <h1 className="font-heading mb-2 text-3xl font-bold">Today's readiness</h1>
      <p className="text-muted-foreground mb-8">How are you feeling today?</p>
      <LogReadinessForm initial={existing ?? undefined} />
    </div>
  )
}
```

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`
- Sign in as a client account.
- Navigate to `http://localhost:3050/client/readiness`.
- Adjust sliders, submit.
- Confirm a toast appears.
- Reload page — form should pre-populate with today's saved values.

- [ ] **Step 4: Commit**

```bash
git add components/client/performance/log-readiness-form.tsx app/(client)/client/readiness/page.tsx
git commit -m "feat(perf-db): client readiness check-in page"
```

---

### Task 1.6: Client readiness history page

**Files:**
- Create: `components/client/performance/my-readiness-history.tsx`
- Create: `app/(client)/client/readiness/history/page.tsx`

- [ ] **Step 1: Write the chart component**

```typescript
// components/client/performance/my-readiness-history.tsx
"use client"

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function MyReadinessHistory({ data }: { data: { date: string; readiness_score: number }[] }) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No readiness data yet. Log your first check-in to see your trend.
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Readiness score (last 30 days)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <ReferenceLine y={70} stroke="var(--success)" strokeDasharray="3 3" />
              <ReferenceLine y={40} stroke="var(--error)" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="readiness_score" stroke="var(--primary)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Write the page**

```typescript
// app/(client)/client/readiness/history/page.tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getReadinessTrend } from "@/lib/db/daily-readiness"
import { MyReadinessHistory } from "@/components/client/performance/my-readiness-history"

export default async function ReadinessHistoryPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/readiness/history")

  const trend = await getReadinessTrend(session.user.id, 30)

  return (
    <div className="container max-w-4xl py-8">
      <h1 className="font-heading mb-8 text-3xl font-bold">Readiness history</h1>
      <MyReadinessHistory data={trend} />
    </div>
  )
}
```

- [ ] **Step 3: Manual smoke test**

Navigate to `/client/readiness/history` while signed in as the same client. Chart renders, today's score visible.

- [ ] **Step 4: Commit**

```bash
git add components/client/performance/my-readiness-history.tsx app/(client)/client/readiness/history/page.tsx
git commit -m "feat(perf-db): client readiness history chart"
```

---

## Phase 2 — Injuries

### Task 2.1: Migration `00128_injuries.sql`

**Files:**
- Create: `supabase/migrations/00128_injuries.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Injuries: longitudinal injury timeline with rehab milestones
-- =====================================================================

CREATE TABLE IF NOT EXISTS injuries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  body_region TEXT NOT NULL CHECK (body_region IN (
    'head','neck','shoulder','elbow','wrist','hand','chest','upper_back','lower_back',
    'hip','glute','hamstring','quad','knee','calf','ankle','foot','other'
  )),
  side TEXT NOT NULL DEFAULT 'n_a' CHECK (side IN ('left','right','bilateral','n_a')),
  injury_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('minor','moderate','severe')),
  mechanism TEXT,
  description TEXT,

  date_occurred DATE NOT NULL,
  date_resolved DATE,

  days_lost INT GENERATED ALWAYS AS (
    CASE
      WHEN date_resolved IS NOT NULL THEN GREATEST(date_resolved - date_occurred, 0)
      ELSE GREATEST(CURRENT_DATE - date_occurred, 0)
    END
  ) STORED,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','recovering','resolved')),
  rehab_milestones JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT resolved_implies_date CHECK (
    (status = 'resolved' AND date_resolved IS NOT NULL) OR status <> 'resolved'
  )
);

CREATE INDEX idx_injuries_user ON injuries(client_user_id);
CREATE INDEX idx_injuries_user_status ON injuries(client_user_id, status);
CREATE INDEX idx_injuries_user_date ON injuries(client_user_id, date_occurred DESC);

CREATE TRIGGER set_injuries_updated_at
  BEFORE UPDATE ON injuries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE injuries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage injuries"
  ON injuries FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Clients can view own injuries"
  ON injuries FOR SELECT TO authenticated
  USING (client_user_id = auth.uid());

CREATE POLICY "Clients can insert own injuries"
  ON injuries FOR INSERT TO authenticated
  WITH CHECK (client_user_id = auth.uid());

CREATE POLICY "Clients can update own injuries"
  ON injuries FOR UPDATE TO authenticated
  USING (client_user_id = auth.uid());
```

> **Note:** `days_lost` is GENERATED STORED using `CURRENT_DATE` which is non-deterministic — older Postgres versions reject this. Supabase Postgres 15+ accepts it via `STABLE` semantics on `CURRENT_DATE`. If apply fails on this constraint, change to a regular nullable column updated via the `update_updated_at_column` trigger pattern (extend the trigger or add a second one). Try the GENERATED form first.

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `00128_injuries`.

If the GENERATED column is rejected, fall back to: remove `days_lost` from the GENERATED form; add a regular `days_lost INT` column; create a `BEFORE INSERT OR UPDATE` trigger that sets it. Document the fallback in the migration comment.

- [ ] **Step 3: Append types to `types/database.ts`**

```typescript
export type BodyRegion =
  | "head" | "neck" | "shoulder" | "elbow" | "wrist" | "hand"
  | "chest" | "upper_back" | "lower_back" | "hip" | "glute"
  | "hamstring" | "quad" | "knee" | "calf" | "ankle" | "foot" | "other"

export type InjurySide = "left" | "right" | "bilateral" | "n_a"
export type InjurySeverity = "minor" | "moderate" | "severe"
export type InjuryStatus = "active" | "recovering" | "resolved"

export interface RehabMilestone {
  name: string
  target_date: string | null
  completed_date: string | null
  notes: string | null
}

export interface Injury {
  id: string
  client_user_id: string
  body_region: BodyRegion
  side: InjurySide
  injury_type: string
  severity: InjurySeverity
  mechanism: string | null
  description: string | null
  date_occurred: string
  date_resolved: string | null
  days_lost: number
  status: InjuryStatus
  rehab_milestones: RehabMilestone[]
  created_at: string
  updated_at: string
}
```

- [ ] **Step 4: Verify table exists**

Use `mcp__supabase__list_tables`. Confirm `injuries` with all columns.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00128_injuries.sql types/database.ts
git commit -m "feat(perf-db): injuries table + types"
```

---

### Task 2.2: Validator `lib/validators/injury.ts`

**Files:**
- Create: `lib/validators/injury.ts`
- Test: `__tests__/lib/validators/injury.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/validators/injury.test.ts
import { describe, it, expect } from "vitest"
import { injuryFormSchema, rehabMilestoneSchema, BODY_REGIONS, BODY_REGION_LABELS } from "@/lib/validators/injury"

describe("injuryFormSchema", () => {
  const valid = {
    body_region: "hamstring" as const,
    side: "right" as const,
    injury_type: "strain",
    severity: "moderate" as const,
    mechanism: "sprinting",
    description: "grade 2 strain mid-belly",
    date_occurred: "2026-05-10",
    date_resolved: null,
    status: "active" as const,
    rehab_milestones: [],
  }

  it("accepts valid input", () => {
    expect(injuryFormSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects invalid body_region", () => {
    expect(injuryFormSchema.safeParse({ ...valid, body_region: "spleen" }).success).toBe(false)
  })

  it("rejects resolved status without date_resolved", () => {
    expect(injuryFormSchema.safeParse({ ...valid, status: "resolved", date_resolved: null }).success).toBe(false)
  })

  it("BODY_REGIONS has labels for every key", () => {
    BODY_REGIONS.forEach((r) => expect(BODY_REGION_LABELS[r]).toBeTruthy())
  })

  it("rehabMilestoneSchema accepts minimal milestone", () => {
    expect(
      rehabMilestoneSchema.safeParse({ name: "Pain-free ROM", target_date: null, completed_date: null, notes: null })
        .success,
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run __tests__/lib/validators/injury.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the validator**

```typescript
// lib/validators/injury.ts
import { z } from "zod"

export const BODY_REGIONS = [
  "head","neck","shoulder","elbow","wrist","hand","chest","upper_back","lower_back",
  "hip","glute","hamstring","quad","knee","calf","ankle","foot","other",
] as const

export const BODY_REGION_LABELS: Record<(typeof BODY_REGIONS)[number], string> = {
  head: "Head", neck: "Neck", shoulder: "Shoulder", elbow: "Elbow", wrist: "Wrist",
  hand: "Hand", chest: "Chest", upper_back: "Upper Back", lower_back: "Lower Back",
  hip: "Hip", glute: "Glute", hamstring: "Hamstring", quad: "Quad", knee: "Knee",
  calf: "Calf", ankle: "Ankle", foot: "Foot", other: "Other",
}

export const INJURY_SIDES = ["left", "right", "bilateral", "n_a"] as const
export const INJURY_SEVERITIES = ["minor", "moderate", "severe"] as const
export const INJURY_STATUSES = ["active", "recovering", "resolved"] as const

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")

export const rehabMilestoneSchema = z.object({
  name: z.string().min(1).max(200),
  target_date: isoDate.nullable(),
  completed_date: isoDate.nullable(),
  notes: z.string().max(1000).nullable(),
})

export const injuryFormSchema = z
  .object({
    body_region: z.enum(BODY_REGIONS),
    side: z.enum(INJURY_SIDES).default("n_a"),
    injury_type: z.string().min(1).max(100),
    severity: z.enum(INJURY_SEVERITIES),
    mechanism: z.string().max(500).nullable(),
    description: z.string().max(2000).nullable(),
    date_occurred: isoDate,
    date_resolved: isoDate.nullable(),
    status: z.enum(INJURY_STATUSES).default("active"),
    rehab_milestones: z.array(rehabMilestoneSchema).default([]),
  })
  .refine((d) => !(d.status === "resolved" && !d.date_resolved), {
    message: "Resolved injuries must have a date_resolved",
    path: ["date_resolved"],
  })

export type InjuryFormData = z.infer<typeof injuryFormSchema>
export type RehabMilestoneFormData = z.infer<typeof rehabMilestoneSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run __tests__/lib/validators/injury.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/validators/injury.ts __tests__/lib/validators/injury.test.ts
git commit -m "feat(perf-db): injury validator"
```

---

### Task 2.3: DAL `lib/db/injuries.ts`

**Files:**
- Create: `lib/db/injuries.ts`
- Test: `__tests__/lib/db/injuries.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/db/injuries.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const supabaseMock = { from: vi.fn() }
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => supabaseMock }))

import {
  listByUser, getActive, getById, create, update, resolve, addMilestone, completeMilestone,
} from "@/lib/db/injuries"

beforeEach(() => vi.clearAllMocks())

describe("injuries DAL", () => {
  it("getActive filters by status in (active, recovering)", async () => {
    const rows = [{ id: "i1", status: "active" }]
    supabaseMock.from.mockReturnValue({
      select: () => ({ eq: () => ({ in: () => ({ order: () => ({ data: rows, error: null }) }) }) }),
    })
    const r = await getActive("u1")
    expect(r).toEqual(rows)
  })

  it("resolve sets status='resolved' and date_resolved", async () => {
    const updateFn = vi.fn().mockReturnValue({
      eq: () => ({ select: () => ({ single: () => ({ data: { id: "i1", status: "resolved" }, error: null }) }) }),
    })
    supabaseMock.from.mockReturnValue({ update: updateFn })
    await resolve("i1", "2026-05-13")
    expect(updateFn).toHaveBeenCalledWith({ status: "resolved", date_resolved: "2026-05-13" })
  })

  it("addMilestone appends to rehab_milestones array", async () => {
    const existing = { id: "i1", rehab_milestones: [{ name: "ROM", target_date: null, completed_date: null, notes: null }] }
    // first call: getById
    supabaseMock.from.mockReturnValueOnce({
      select: () => ({ eq: () => ({ single: () => ({ data: existing, error: null }) }) }),
    })
    // second call: update
    const updateFn = vi.fn().mockReturnValue({
      eq: () => ({ select: () => ({ single: () => ({ data: { ...existing, rehab_milestones: [...existing.rehab_milestones, { name: "Run" }] }, error: null }) }) }),
    })
    supabaseMock.from.mockReturnValueOnce({ update: updateFn })
    await addMilestone("i1", { name: "Run", target_date: null, completed_date: null, notes: null })
    expect(updateFn).toHaveBeenCalledWith({
      rehab_milestones: [...existing.rehab_milestones, { name: "Run", target_date: null, completed_date: null, notes: null }],
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run __tests__/lib/db/injuries.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the DAL**

```typescript
// lib/db/injuries.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { Injury, RehabMilestone, InjuryStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listByUser(clientUserId: string, opts: { status?: InjuryStatus } = {}) {
  const supabase = getClient()
  let q = supabase.from("injuries").select("*").eq("client_user_id", clientUserId)
  if (opts.status) q = q.eq("status", opts.status)
  const { data, error } = await q.order("date_occurred", { ascending: false })
  if (error) throw error
  return data as Injury[]
}

export async function getActive(clientUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("injuries")
    .select("*")
    .eq("client_user_id", clientUserId)
    .in("status", ["active", "recovering"])
    .order("date_occurred", { ascending: false })
  if (error) throw error
  return data as Injury[]
}

export async function getById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("injuries").select("*").eq("id", id).single()
  if (error) return null
  return data as Injury
}

export async function create(
  clientUserId: string,
  payload: Omit<Injury, "id" | "client_user_id" | "days_lost" | "created_at" | "updated_at">,
) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("injuries")
    .insert({ client_user_id: clientUserId, ...payload })
    .select()
    .single()
  if (error) throw error
  return data as Injury
}

export async function update(
  id: string,
  patch: Partial<Omit<Injury, "id" | "client_user_id" | "days_lost" | "created_at" | "updated_at">>,
) {
  const supabase = getClient()
  const { data, error } = await supabase.from("injuries").update(patch).eq("id", id).select().single()
  if (error) throw error
  return data as Injury
}

export async function resolve(id: string, dateResolved: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("injuries")
    .update({ status: "resolved", date_resolved: dateResolved })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Injury
}

export async function addMilestone(id: string, milestone: RehabMilestone) {
  const existing = await getById(id)
  if (!existing) throw new Error("injury not found")
  const next = [...existing.rehab_milestones, milestone]
  const supabase = getClient()
  const { data, error } = await supabase
    .from("injuries")
    .update({ rehab_milestones: next })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Injury
}

export async function completeMilestone(id: string, index: number, completedDate: string, notes?: string) {
  const existing = await getById(id)
  if (!existing) throw new Error("injury not found")
  const next = existing.rehab_milestones.map((m, i) =>
    i === index ? { ...m, completed_date: completedDate, notes: notes ?? m.notes } : m,
  )
  const supabase = getClient()
  const { data, error } = await supabase
    .from("injuries")
    .update({ rehab_milestones: next })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Injury
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run __tests__/lib/db/injuries.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/injuries.ts __tests__/lib/db/injuries.test.ts
git commit -m "feat(perf-db): injuries DAL"
```

---

### Task 2.4: API routes for injuries

**Files:**
- Create: `app/api/injuries/route.ts`
- Create: `app/api/injuries/[id]/route.ts`
- Create: `app/api/injuries/[id]/milestones/route.ts`
- Create: `app/api/injuries/[id]/milestones/[index]/route.ts`

- [ ] **Step 1: Write `POST /api/injuries` and `GET /api/injuries`**

```typescript
// app/api/injuries/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { injuryFormSchema } from "@/lib/validators/injury"
import { create, listByUser } from "@/lib/db/injuries"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const url = new URL(req.url)
  const clientUserId =
    session.user.role === "admin" && url.searchParams.get("client_user_id")
      ? url.searchParams.get("client_user_id")!
      : session.user.id
  const injuries = await listByUser(clientUserId)
  return NextResponse.json({ injuries })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json()
  const parsed = injuryFormSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const clientUserId =
    session.user.role === "admin" && body.client_user_id ? (body.client_user_id as string) : session.user.id
  const injury = await create(clientUserId, parsed.data)
  return NextResponse.json({ injury })
}
```

- [ ] **Step 2: Write `PATCH /api/injuries/[id]` and `DELETE`**

```typescript
// app/api/injuries/[id]/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { injuryFormSchema } from "@/lib/validators/injury"
import { update, getById, resolve } from "@/lib/db/injuries"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const injury = await getById(id)
  if (!injury) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (session.user.role !== "admin" && injury.client_user_id !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  return NextResponse.json({ injury })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  // Allow partial — use .partial() on the schema
  const parsed = injuryFormSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const existing = await getById(id)
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (session.user.role !== "admin" && existing.client_user_id !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  // Short-circuit for resolve action
  if (body.action === "resolve" && parsed.data.date_resolved) {
    const injury = await resolve(id, parsed.data.date_resolved)
    return NextResponse.json({ injury })
  }
  const injury = await update(id, parsed.data)
  return NextResponse.json({ injury })
}
```

- [ ] **Step 3: Write milestone endpoints**

```typescript
// app/api/injuries/[id]/milestones/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { rehabMilestoneSchema } from "@/lib/validators/injury"
import { addMilestone, getById } from "@/lib/db/injuries"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const parsed = rehabMilestoneSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const existing = await getById(id)
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (session.user.role !== "admin" && existing.client_user_id !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const injury = await addMilestone(id, parsed.data)
  return NextResponse.json({ injury })
}
```

```typescript
// app/api/injuries/[id]/milestones/[index]/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { completeMilestone, getById } from "@/lib/db/injuries"
import { z } from "zod"

const patchSchema = z.object({
  completed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(1000).nullable().optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id, index } = await params
  const idx = Number(index)
  if (!Number.isInteger(idx) || idx < 0) {
    return NextResponse.json({ error: "bad_index" }, { status: 400 })
  }
  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const existing = await getById(id)
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (session.user.role !== "admin" && existing.client_user_id !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const injury = await completeMilestone(id, idx, parsed.data.completed_date, parsed.data.notes ?? undefined)
  return NextResponse.json({ injury })
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/injuries/
git commit -m "feat(perf-db): injuries API routes"
```

---

### Task 2.5: Client injury pages

**Files:**
- Create: `components/client/performance/report-injury-form.tsx`
- Create: `app/(client)/client/injuries/page.tsx`
- Create: `app/(client)/client/injuries/[id]/page.tsx`

- [ ] **Step 1: Write the report-injury form**

```typescript
// components/client/performance/report-injury-form.tsx
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  BODY_REGIONS, BODY_REGION_LABELS, INJURY_SIDES, INJURY_SEVERITIES,
  injuryFormSchema, type InjuryFormData,
} from "@/lib/validators/injury"

export function ReportInjuryForm({ clientUserId }: { clientUserId?: string }) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<InjuryFormData>({
    resolver: zodResolver(injuryFormSchema),
    defaultValues: {
      body_region: "hamstring",
      side: "n_a",
      injury_type: "",
      severity: "moderate",
      mechanism: null,
      description: null,
      date_occurred: new Date().toISOString().slice(0, 10),
      date_resolved: null,
      status: "active",
      rehab_milestones: [],
    },
  })

  async function onSubmit(values: InjuryFormData) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/injuries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(clientUserId ? { ...values, client_user_id: clientUserId } : values),
      })
      if (!res.ok) throw new Error("Save failed")
      toast.success("Injury reported")
      router.push(clientUserId ? `/admin/clients/${clientUserId}/performance?tab=injuries` : "/client/injuries")
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
          <Label>Body region</Label>
          <Select
            value={form.watch("body_region")}
            onValueChange={(v) => form.setValue("body_region", v as InjuryFormData["body_region"])}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {BODY_REGIONS.map((r) => <SelectItem key={r} value={r}>{BODY_REGION_LABELS[r]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Side</Label>
          <Select value={form.watch("side")} onValueChange={(v) => form.setValue("side", v as InjuryFormData["side"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {INJURY_SIDES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Injury type</Label>
        <Input placeholder="strain, sprain, tendinopathy…" {...form.register("injury_type")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Severity</Label>
          <Select
            value={form.watch("severity")}
            onValueChange={(v) => form.setValue("severity", v as InjuryFormData["severity"])}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {INJURY_SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Date occurred</Label>
          <Input type="date" {...form.register("date_occurred")} />
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Mechanism</Label>
        <Textarea
          rows={2}
          placeholder="how did it happen?"
          {...form.register("mechanism", { setValueAs: (v) => (v === "" ? null : v) })}
        />
      </div>

      <div className="grid gap-2">
        <Label>Description</Label>
        <Textarea
          rows={3}
          {...form.register("description", { setValueAs: (v) => (v === "" ? null : v) })}
        />
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Saving..." : "Report injury"}
      </Button>
    </form>
  )
}
```

- [ ] **Step 2: Write list page**

```typescript
// app/(client)/client/injuries/page.tsx
import Link from "next/link"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listByUser } from "@/lib/db/injuries"
import { Button } from "@/components/ui/button"
import { ReportInjuryForm } from "@/components/client/performance/report-injury-form"
import { StatusPill } from "@/components/shared/status-pill"
import { BODY_REGION_LABELS } from "@/lib/validators/injury"

export default async function ClientInjuriesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/injuries")
  const injuries = await listByUser(session.user.id)

  return (
    <div className="container max-w-4xl py-8">
      <h1 className="font-heading mb-8 text-3xl font-bold">Injuries</h1>

      <section className="mb-12">
        <h2 className="font-heading mb-4 text-xl font-semibold">Active & past</h2>
        {injuries.length === 0 ? (
          <p className="text-muted-foreground">No injuries logged.</p>
        ) : (
          <ul className="space-y-2">
            {injuries.map((i) => (
              <li key={i.id} className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Link href={`/client/injuries/${i.id}`} className="font-medium hover:underline">
                    {BODY_REGION_LABELS[i.body_region]} — {i.injury_type}
                  </Link>
                  <p className="text-muted-foreground text-sm">
                    {i.date_occurred} · {i.days_lost} days
                  </p>
                </div>
                <StatusPill status={i.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-heading mb-4 text-xl font-semibold">Report a new injury</h2>
        <ReportInjuryForm />
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Write detail page**

```typescript
// app/(client)/client/injuries/[id]/page.tsx
import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import { getById } from "@/lib/db/injuries"
import { BODY_REGION_LABELS } from "@/lib/validators/injury"
import { StatusPill } from "@/components/shared/status-pill"
import { InjuryRehabMilestoneList } from "@/components/admin/performance/injury-rehab-milestone-list"

export default async function InjuryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const { id } = await params
  const injury = await getById(id)
  if (!injury) notFound()
  if (session.user.role !== "admin" && injury.client_user_id !== session.user.id) notFound()

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold">
            {BODY_REGION_LABELS[injury.body_region]} — {injury.injury_type}
          </h1>
          <p className="text-muted-foreground">
            Reported {injury.date_occurred} · {injury.days_lost} days · {injury.severity}
          </p>
        </div>
        <StatusPill status={injury.status} />
      </div>

      {injury.mechanism && (
        <section className="mb-6">
          <h2 className="mb-2 font-semibold">Mechanism</h2>
          <p>{injury.mechanism}</p>
        </section>
      )}

      {injury.description && (
        <section className="mb-6">
          <h2 className="mb-2 font-semibold">Description</h2>
          <p>{injury.description}</p>
        </section>
      )}

      <section>
        <h2 className="mb-4 font-semibold">Rehab milestones</h2>
        <InjuryRehabMilestoneList injury={injury} />
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add components/client/performance/report-injury-form.tsx app/(client)/client/injuries/
git commit -m "feat(perf-db): client injury pages"
```

---

## Phase 3 — Performance Tests

### Task 3.1: Migrations `00129_performance_tests.sql` + `00130_performance_test_pr_view.sql`

**Files:**
- Create: `supabase/migrations/00129_performance_tests.sql`
- Create: `supabase/migrations/00130_performance_test_pr_view.sql`

- [ ] **Step 1: Write the table migration**

```sql
-- Performance Tests: standalone single-test logs with PR + % change
-- =====================================================================

CREATE TABLE IF NOT EXISTS performance_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,

  test_type TEXT NOT NULL CHECK (test_type IN (
    'drop_jump','cmj','squat_jump','broad_jump','sprint_10m','sprint_20m','sprint_40m',
    'sprint_5_10_5','t_test','beep_test','sit_reach','bench_press_1rm','back_squat_1rm',
    'deadlift_1rm','pull_up_max','push_up_max','plank_hold','custom'
  )),
  custom_name TEXT,
  result_value NUMERIC(8,3) NOT NULL,
  result_unit TEXT NOT NULL,
  trial_values JSONB,
  best_method TEXT NOT NULL CHECK (best_method IN ('highest','lowest','mean','median')),
  test_date DATE NOT NULL,
  body_weight_kg NUMERIC(5,2),
  notes TEXT,
  video_url TEXT,
  is_pr BOOLEAN NOT NULL DEFAULT FALSE,
  pct_change_from_prev NUMERIC(6,2),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT custom_name_required CHECK (test_type <> 'custom' OR custom_name IS NOT NULL)
);

CREATE INDEX idx_performance_tests_user ON performance_tests(client_user_id);
CREATE INDEX idx_performance_tests_user_type_date
  ON performance_tests(client_user_id, test_type, test_date DESC);

CREATE TRIGGER set_performance_tests_updated_at
  BEFORE UPDATE ON performance_tests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE performance_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage performance tests"
  ON performance_tests FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Clients can view own tests"
  ON performance_tests FOR SELECT TO authenticated
  USING (client_user_id = auth.uid());

CREATE POLICY "Clients can insert own tests"
  ON performance_tests FOR INSERT TO authenticated
  WITH CHECK (client_user_id = auth.uid());

CREATE POLICY "Clients can update own tests"
  ON performance_tests FOR UPDATE TO authenticated
  USING (client_user_id = auth.uid());
```

- [ ] **Step 2: Apply 00129 via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `00129_performance_tests`.

- [ ] **Step 3: Write the PR view migration**

```sql
-- Performance Test PR View
-- =====================================================================
-- Returns the current PR (single row) per (client_user_id, test_type).
-- "Best" depends on best_method:
--   highest -> max(result_value)
--   lowest  -> min(result_value)
--   mean/median -> default to highest-is-better

CREATE OR REPLACE VIEW performance_test_pr_view AS
SELECT DISTINCT ON (client_user_id, test_type)
  client_user_id, test_type, custom_name, result_value, result_unit,
  test_date, id AS test_id, best_method
FROM performance_tests
ORDER BY client_user_id, test_type,
  CASE best_method
    WHEN 'lowest' THEN result_value
    ELSE -result_value
  END,
  test_date DESC;
```

- [ ] **Step 4: Apply 00130 via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `00130_performance_test_pr_view`.

- [ ] **Step 5: Append types**

```typescript
// types/database.ts
export type TestType =
  | "drop_jump" | "cmj" | "squat_jump" | "broad_jump"
  | "sprint_10m" | "sprint_20m" | "sprint_40m" | "sprint_5_10_5" | "t_test" | "beep_test"
  | "sit_reach"
  | "bench_press_1rm" | "back_squat_1rm" | "deadlift_1rm"
  | "pull_up_max" | "push_up_max" | "plank_hold"
  | "custom"

export type BestMethod = "highest" | "lowest" | "mean" | "median"

export interface PerformanceTest {
  id: string
  client_user_id: string
  created_by: string
  test_type: TestType
  custom_name: string | null
  result_value: number
  result_unit: string
  trial_values: number[] | null
  best_method: BestMethod
  test_date: string
  body_weight_kg: number | null
  notes: string | null
  video_url: string | null
  is_pr: boolean
  pct_change_from_prev: number | null
  created_at: string
  updated_at: string
}

export interface PerformanceTestPR {
  client_user_id: string
  test_type: TestType
  custom_name: string | null
  result_value: number
  result_unit: string
  test_date: string
  test_id: string
  best_method: BestMethod
}
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00129_performance_tests.sql supabase/migrations/00130_performance_test_pr_view.sql types/database.ts
git commit -m "feat(perf-db): performance_tests table + PR view + types"
```

---

### Task 3.2: Validator `lib/validators/performance-test.ts`

**Files:**
- Create: `lib/validators/performance-test.ts`
- Test: `__tests__/lib/validators/performance-test.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/validators/performance-test.test.ts
import { describe, it, expect } from "vitest"
import {
  performanceTestFormSchema, TEST_TYPES, TEST_TYPE_LABELS, TEST_TYPE_DEFAULTS, reduceTrials,
} from "@/lib/validators/performance-test"

describe("performanceTestFormSchema", () => {
  const valid = {
    test_type: "drop_jump" as const,
    custom_name: null,
    result_value: 38.5,
    result_unit: "cm",
    trial_values: [37.0, 38.5, 38.2],
    best_method: "highest" as const,
    test_date: "2026-05-13",
    body_weight_kg: 78.0,
    notes: null,
    video_url: null,
  }

  it("accepts valid input", () => {
    expect(performanceTestFormSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects test_type=custom without custom_name", () => {
    expect(
      performanceTestFormSchema.safeParse({ ...valid, test_type: "custom", custom_name: null }).success,
    ).toBe(false)
  })

  it("TEST_TYPE_DEFAULTS provides unit + best_method for every test_type", () => {
    TEST_TYPES.forEach((t) => {
      expect(TEST_TYPE_DEFAULTS[t]).toBeDefined()
      expect(TEST_TYPE_LABELS[t]).toBeTruthy()
    })
  })
})

describe("reduceTrials", () => {
  it("highest of [4.2, 4.15, 4.18] = 4.2", () => {
    expect(reduceTrials([4.2, 4.15, 4.18], "highest")).toBe(4.2)
  })
  it("lowest of [4.2, 4.15, 4.18] = 4.15", () => {
    expect(reduceTrials([4.2, 4.15, 4.18], "lowest")).toBe(4.15)
  })
  it("mean of [2, 4, 6] = 4", () => {
    expect(reduceTrials([2, 4, 6], "mean")).toBe(4)
  })
  it("median of [1, 2, 5] = 2", () => {
    expect(reduceTrials([1, 2, 5], "median")).toBe(2)
  })
  it("median of [1, 2, 3, 4] = 2.5", () => {
    expect(reduceTrials([1, 2, 3, 4], "median")).toBe(2.5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run __tests__/lib/validators/performance-test.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the validator**

```typescript
// lib/validators/performance-test.ts
import { z } from "zod"

export const TEST_TYPES = [
  "drop_jump","cmj","squat_jump","broad_jump",
  "sprint_10m","sprint_20m","sprint_40m","sprint_5_10_5","t_test","beep_test",
  "sit_reach",
  "bench_press_1rm","back_squat_1rm","deadlift_1rm",
  "pull_up_max","push_up_max","plank_hold",
  "custom",
] as const

export const BEST_METHODS = ["highest", "lowest", "mean", "median"] as const

export const TEST_TYPE_LABELS: Record<(typeof TEST_TYPES)[number], string> = {
  drop_jump: "Drop Jump", cmj: "Countermovement Jump", squat_jump: "Squat Jump", broad_jump: "Broad Jump",
  sprint_10m: "10m Sprint", sprint_20m: "20m Sprint", sprint_40m: "40m Sprint",
  sprint_5_10_5: "5-10-5 Shuttle", t_test: "T-Test", beep_test: "Beep Test",
  sit_reach: "Sit & Reach",
  bench_press_1rm: "Bench Press 1RM", back_squat_1rm: "Back Squat 1RM", deadlift_1rm: "Deadlift 1RM",
  pull_up_max: "Pull-up Max", push_up_max: "Push-up Max", plank_hold: "Plank Hold",
  custom: "Custom Test",
}

type Default = { unit: string; best_method: (typeof BEST_METHODS)[number] }
export const TEST_TYPE_DEFAULTS: Record<(typeof TEST_TYPES)[number], Default> = {
  drop_jump: { unit: "cm", best_method: "highest" },
  cmj: { unit: "cm", best_method: "highest" },
  squat_jump: { unit: "cm", best_method: "highest" },
  broad_jump: { unit: "cm", best_method: "highest" },
  sprint_10m: { unit: "sec", best_method: "lowest" },
  sprint_20m: { unit: "sec", best_method: "lowest" },
  sprint_40m: { unit: "sec", best_method: "lowest" },
  sprint_5_10_5: { unit: "sec", best_method: "lowest" },
  t_test: { unit: "sec", best_method: "lowest" },
  beep_test: { unit: "level", best_method: "highest" },
  sit_reach: { unit: "cm", best_method: "highest" },
  bench_press_1rm: { unit: "kg", best_method: "highest" },
  back_squat_1rm: { unit: "kg", best_method: "highest" },
  deadlift_1rm: { unit: "kg", best_method: "highest" },
  pull_up_max: { unit: "reps", best_method: "highest" },
  push_up_max: { unit: "reps", best_method: "highest" },
  plank_hold: { unit: "sec", best_method: "highest" },
  custom: { unit: "", best_method: "highest" },
}

export function reduceTrials(values: number[], method: (typeof BEST_METHODS)[number]): number {
  if (values.length === 0) throw new Error("no trial values")
  switch (method) {
    case "highest":
      return Math.max(...values)
    case "lowest":
      return Math.min(...values)
    case "mean":
      return values.reduce((a, b) => a + b, 0) / values.length
    case "median": {
      const sorted = [...values].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
    }
  }
}

export const performanceTestFormSchema = z
  .object({
    test_type: z.enum(TEST_TYPES),
    custom_name: z.string().min(1).max(100).nullable(),
    result_value: z.number(),
    result_unit: z.string().min(1).max(20),
    trial_values: z.array(z.number()).max(20).nullable(),
    best_method: z.enum(BEST_METHODS),
    test_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    body_weight_kg: z.number().positive().max(500).nullable(),
    notes: z.string().max(2000).nullable(),
    video_url: z.string().url().nullable(),
  })
  .refine((d) => !(d.test_type === "custom" && !d.custom_name), {
    message: "custom_name required when test_type='custom'",
    path: ["custom_name"],
  })

export type PerformanceTestFormData = z.infer<typeof performanceTestFormSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run __tests__/lib/validators/performance-test.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/validators/performance-test.ts __tests__/lib/validators/performance-test.test.ts
git commit -m "feat(perf-db): performance-test validator + trial reducer"
```

---

### Task 3.3: DAL `lib/db/performance-tests.ts`

**Files:**
- Create: `lib/db/performance-tests.ts`
- Test: `__tests__/lib/db/performance-tests.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/db/performance-tests.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const supabaseMock = { from: vi.fn() }
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => supabaseMock }))

import { computeIsPr, computePctChange } from "@/lib/db/performance-tests"

beforeEach(() => vi.clearAllMocks())

describe("performance-tests helpers", () => {
  describe("computeIsPr", () => {
    it("highest: 40 beats prior max 38 → PR", () => {
      expect(computeIsPr(40, "highest", [38, 35, 30])).toBe(true)
    })
    it("highest: 38 ties prior max 38 → NOT PR (strictly greater)", () => {
      expect(computeIsPr(38, "highest", [38, 35])).toBe(false)
    })
    it("lowest: 4.10 beats prior min 4.15 → PR", () => {
      expect(computeIsPr(4.1, "lowest", [4.15, 4.2, 4.3])).toBe(true)
    })
    it("first ever test → PR", () => {
      expect(computeIsPr(10, "highest", [])).toBe(true)
    })
  })

  describe("computePctChange", () => {
    it("returns ((curr - prev) / prev) * 100", () => {
      expect(computePctChange(110, 100)).toBeCloseTo(10)
      expect(computePctChange(90, 100)).toBeCloseTo(-10)
    })
    it("returns null when prev is null/0", () => {
      expect(computePctChange(50, null)).toBeNull()
      expect(computePctChange(50, 0)).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run __tests__/lib/db/performance-tests.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the DAL**

```typescript
// lib/db/performance-tests.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { PerformanceTest, PerformanceTestPR, TestType, BestMethod } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export function computeIsPr(value: number, method: BestMethod, priorValues: number[]): boolean {
  if (priorValues.length === 0) return true
  if (method === "lowest") return value < Math.min(...priorValues)
  // highest, mean, median — treat as higher-is-better for PR semantics
  return value > Math.max(...priorValues)
}

export function computePctChange(current: number, prev: number | null): number | null {
  if (prev === null || prev === 0) return null
  return ((current - prev) / prev) * 100
}

export async function listByUser(
  clientUserId: string,
  opts: { testType?: TestType; from?: string; to?: string } = {},
) {
  const supabase = getClient()
  let q = supabase.from("performance_tests").select("*").eq("client_user_id", clientUserId)
  if (opts.testType) q = q.eq("test_type", opts.testType)
  if (opts.from) q = q.gte("test_date", opts.from)
  if (opts.to) q = q.lte("test_date", opts.to)
  const { data, error } = await q.order("test_date", { ascending: false })
  if (error) throw error
  return data as PerformanceTest[]
}

export async function getById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("performance_tests").select("*").eq("id", id).single()
  if (error) return null
  return data as PerformanceTest
}

async function priorTestsForType(clientUserId: string, testType: TestType, excludeId?: string) {
  const supabase = getClient()
  let q = supabase
    .from("performance_tests")
    .select("id, result_value, test_date")
    .eq("client_user_id", clientUserId)
    .eq("test_type", testType)
  if (excludeId) q = q.neq("id", excludeId)
  const { data, error } = await q.order("test_date", { ascending: false })
  if (error) throw error
  return data as { id: string; result_value: number; test_date: string }[]
}

export async function create(
  clientUserId: string,
  payload: Omit<PerformanceTest, "id" | "client_user_id" | "created_by" | "is_pr" | "pct_change_from_prev" | "created_at" | "updated_at">,
  createdBy: string,
) {
  const supabase = getClient()
  const prior = await priorTestsForType(clientUserId, payload.test_type)
  const priorValues = prior.map((p) => p.result_value)
  const prevValue = prior.length > 0 ? prior[0].result_value : null
  const is_pr = computeIsPr(payload.result_value, payload.best_method, priorValues)
  const pct_change_from_prev = computePctChange(payload.result_value, prevValue)

  const { data, error } = await supabase
    .from("performance_tests")
    .insert({
      client_user_id: clientUserId,
      created_by: createdBy,
      ...payload,
      is_pr,
      pct_change_from_prev,
    })
    .select()
    .single()
  if (error) throw error
  return data as PerformanceTest
}

export async function update(
  id: string,
  patch: Partial<Omit<PerformanceTest, "id" | "client_user_id" | "created_by" | "is_pr" | "pct_change_from_prev" | "created_at" | "updated_at">>,
) {
  const supabase = getClient()
  // Fetch current row to recompute PR + pct_change
  const existing = await getById(id)
  if (!existing) throw new Error("performance_test not found")
  const merged = { ...existing, ...patch }
  const prior = await priorTestsForType(existing.client_user_id, merged.test_type, id)
  // Only include rows from BEFORE this row's date for "prev" semantics
  const earlier = prior.filter((p) => p.test_date <= merged.test_date)
  const priorValues = earlier.map((p) => p.result_value)
  const prevValue = earlier.length > 0 ? earlier[0].result_value : null
  const is_pr = computeIsPr(merged.result_value, merged.best_method, priorValues)
  const pct_change_from_prev = computePctChange(merged.result_value, prevValue)

  const { data, error } = await supabase
    .from("performance_tests")
    .update({ ...patch, is_pr, pct_change_from_prev })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error

  // Recompute downstream rows of same test_type whose lineage may have changed
  await recomputeDownstream(existing.client_user_id, merged.test_type, merged.test_date)
  return data as PerformanceTest
}

export async function deleteTest(id: string) {
  const existing = await getById(id)
  if (!existing) return
  const supabase = getClient()
  const { error } = await supabase.from("performance_tests").delete().eq("id", id)
  if (error) throw error
  await recomputeDownstream(existing.client_user_id, existing.test_type, existing.test_date)
}

/** After insert/update/delete, rows DATED AFTER the affected row may have stale is_pr / pct_change. */
async function recomputeDownstream(clientUserId: string, testType: TestType, fromDate: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_tests")
    .select("id, result_value, test_date, best_method")
    .eq("client_user_id", clientUserId)
    .eq("test_type", testType)
    .gt("test_date", fromDate)
    .order("test_date", { ascending: true })
  if (error) throw error
  for (const row of data ?? []) {
    const earlier = (
      await priorTestsForType(clientUserId, testType, row.id)
    ).filter((p) => p.test_date <= row.test_date)
    const priorValues = earlier.map((p) => p.result_value)
    const prevValue = earlier.length > 0 ? earlier[0].result_value : null
    const is_pr = computeIsPr(row.result_value, row.best_method as BestMethod, priorValues)
    const pct_change_from_prev = computePctChange(row.result_value, prevValue)
    await supabase.from("performance_tests").update({ is_pr, pct_change_from_prev }).eq("id", row.id)
  }
}

export async function getPRsByUser(clientUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_test_pr_view")
    .select("*")
    .eq("client_user_id", clientUserId)
  if (error) throw error
  return data as PerformanceTestPR[]
}

export async function getTestHistory(clientUserId: string, testType: TestType) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("performance_tests")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("test_type", testType)
    .order("test_date", { ascending: true })
  if (error) throw error
  return data as PerformanceTest[]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run __tests__/lib/db/performance-tests.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/performance-tests.ts __tests__/lib/db/performance-tests.test.ts
git commit -m "feat(perf-db): performance-tests DAL with PR + pct-change logic"
```

---

### Task 3.4: API routes for performance tests

**Files:**
- Create: `app/api/performance-tests/route.ts`
- Create: `app/api/performance-tests/[id]/route.ts`

- [ ] **Step 1: Write `POST /api/performance-tests` and `GET`**

```typescript
// app/api/performance-tests/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { performanceTestFormSchema } from "@/lib/validators/performance-test"
import { create, listByUser } from "@/lib/db/performance-tests"
import type { TestType } from "@/types/database"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const url = new URL(req.url)
  const clientUserId =
    session.user.role === "admin" && url.searchParams.get("client_user_id")
      ? url.searchParams.get("client_user_id")!
      : session.user.id
  const testType = url.searchParams.get("test_type") as TestType | null
  const tests = await listByUser(clientUserId, testType ? { testType } : {})
  return NextResponse.json({ tests })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json()
  const parsed = performanceTestFormSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const clientUserId =
    session.user.role === "admin" && body.client_user_id ? (body.client_user_id as string) : session.user.id
  const test = await create(clientUserId, parsed.data, session.user.id)
  return NextResponse.json({ test })
}
```

- [ ] **Step 2: Write `PATCH` + `DELETE /api/performance-tests/[id]`**

```typescript
// app/api/performance-tests/[id]/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { performanceTestFormSchema } from "@/lib/validators/performance-test"
import { update, deleteTest, getById } from "@/lib/db/performance-tests"

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
  const parsed = performanceTestFormSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const test = await update(id, parsed.data)
  return NextResponse.json({ test })
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
  await deleteTest(id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/performance-tests/
git commit -m "feat(perf-db): performance-tests API routes"
```

---

### Task 3.5: Client performance pages

**Files:**
- Create: `components/client/performance/log-test-dialog.tsx`
- Create: `components/client/performance/my-performance-tests.tsx`
- Create: `app/(client)/client/performance/page.tsx`
- Create: `app/(client)/client/performance/[testType]/page.tsx`

- [ ] **Step 1: Write log-test dialog**

```typescript
// components/client/performance/log-test-dialog.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  TEST_TYPES, TEST_TYPE_LABELS, TEST_TYPE_DEFAULTS, reduceTrials,
  performanceTestFormSchema, type PerformanceTestFormData,
} from "@/lib/validators/performance-test"

export function LogTestDialog({
  clientUserId,
  defaultTestType,
  trigger,
}: {
  clientUserId?: string
  defaultTestType?: PerformanceTestFormData["test_type"]
  trigger: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const startType = defaultTestType ?? "drop_jump"

  const form = useForm<PerformanceTestFormData>({
    resolver: zodResolver(performanceTestFormSchema),
    defaultValues: {
      test_type: startType,
      custom_name: null,
      result_value: 0,
      result_unit: TEST_TYPE_DEFAULTS[startType].unit,
      trial_values: null,
      best_method: TEST_TYPE_DEFAULTS[startType].best_method,
      test_date: today,
      body_weight_kg: null,
      notes: null,
      video_url: null,
    },
  })

  // Auto-recompute result_value from trial_values
  const trials = form.watch("trial_values")
  const method = form.watch("best_method")
  const onChangeTestType = (next: PerformanceTestFormData["test_type"]) => {
    form.setValue("test_type", next)
    form.setValue("result_unit", TEST_TYPE_DEFAULTS[next].unit)
    form.setValue("best_method", TEST_TYPE_DEFAULTS[next].best_method)
  }
  const onTrialsChange = (raw: string) => {
    const arr = raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
    form.setValue("trial_values", arr.length > 0 ? arr : null)
    if (arr.length > 0) {
      form.setValue("result_value", Number(reduceTrials(arr, method).toFixed(3)))
    }
  }

  async function onSubmit(values: PerformanceTestFormData) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/performance-tests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(clientUserId ? { ...values, client_user_id: clientUserId } : values),
      })
      if (!res.ok) throw new Error("Save failed")
      const data = await res.json()
      toast.success(data.test.is_pr ? "New PR! 🎯" : "Test logged")
      setOpen(false)
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Log a test</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-2">
            <Label>Test type</Label>
            <Select value={form.watch("test_type")} onValueChange={onChangeTestType as (v: string) => void}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TEST_TYPES.map((t) => <SelectItem key={t} value={t}>{TEST_TYPE_LABELS[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {form.watch("test_type") === "custom" && (
            <div className="grid gap-2">
              <Label>Custom name</Label>
              <Input {...form.register("custom_name")} />
            </div>
          )}

          <div className="grid gap-2">
            <Label>Trial values (optional, comma-separated)</Label>
            <Input placeholder="e.g. 38.2, 38.5, 37.9" onChange={(e) => onTrialsChange(e.target.value)} />
            {trials && trials.length > 0 && (
              <p className="text-muted-foreground text-xs">
                Best ({method}) = {Number(reduceTrials(trials, method).toFixed(3))}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Result</Label>
              <Input
                type="number"
                step="0.001"
                {...form.register("result_value", { valueAsNumber: true })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Unit</Label>
              <Input {...form.register("result_unit")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Date</Label>
              <Input type="date" {...form.register("test_date")} />
            </div>
            <div className="grid gap-2">
              <Label>Body weight (kg, optional)</Label>
              <Input
                type="number"
                step="0.1"
                {...form.register("body_weight_kg", { setValueAs: (v) => (v === "" ? null : Number(v)) })}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Notes</Label>
            <Textarea
              rows={2}
              {...form.register("notes", { setValueAs: (v) => (v === "" ? null : v) })}
            />
          </div>

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Saving..." : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Write tests list component**

```typescript
// components/client/performance/my-performance-tests.tsx
"use client"

import Link from "next/link"
import type { PerformanceTest } from "@/types/database"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export function MyPerformanceTests({ tests }: { tests: PerformanceTest[] }) {
  if (tests.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No tests logged yet.
        </CardContent>
      </Card>
    )
  }
  // Group by test_type
  const byType = tests.reduce<Record<string, PerformanceTest[]>>((acc, t) => {
    const key = t.test_type === "custom" ? `custom:${t.custom_name}` : t.test_type
    acc[key] = acc[key] ?? []
    acc[key].push(t)
    return acc
  }, {})
  return (
    <div className="grid gap-4">
      {Object.entries(byType).map(([key, list]) => {
        const sample = list[0]
        const label = sample.test_type === "custom"
          ? sample.custom_name ?? "Custom"
          : TEST_TYPE_LABELS[sample.test_type]
        const linkType = sample.test_type
        return (
          <Card key={key}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                <Link href={`/client/performance/${linkType}`} className="hover:underline">{label}</Link>
              </CardTitle>
              <span className="text-muted-foreground text-sm">{list.length} sessions</span>
            </CardHeader>
            <CardContent>
              <p className="font-heading text-2xl font-bold">
                {sample.result_value} <span className="text-muted-foreground text-sm font-normal">{sample.result_unit}</span>{" "}
                {sample.is_pr && <Badge className="ml-2 bg-accent">PR</Badge>}
              </p>
              <p className="text-muted-foreground text-xs">latest: {sample.test_date}</p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Write list page**

```typescript
// app/(client)/client/performance/page.tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listByUser } from "@/lib/db/performance-tests"
import { Button } from "@/components/ui/button"
import { LogTestDialog } from "@/components/client/performance/log-test-dialog"
import { MyPerformanceTests } from "@/components/client/performance/my-performance-tests"

export default async function ClientPerformancePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/performance")
  const tests = await listByUser(session.user.id)

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-heading text-3xl font-bold">Performance</h1>
        <LogTestDialog trigger={<Button>+ Log test</Button>} />
      </div>
      <MyPerformanceTests tests={tests} />
    </div>
  )
}
```

- [ ] **Step 4: Write per-test-type history page**

```typescript
// app/(client)/client/performance/[testType]/page.tsx
import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import { getTestHistory } from "@/lib/db/performance-tests"
import { TEST_TYPES, TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import { PerformanceTestHistoryChart } from "@/components/admin/performance/performance-test-history-chart"

export default async function ClientPerformanceTestTypePage({ params }: { params: Promise<{ testType: string }> }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const { testType } = await params
  if (!(TEST_TYPES as readonly string[]).includes(testType)) notFound()
  const history = await getTestHistory(session.user.id, testType as (typeof TEST_TYPES)[number])

  return (
    <div className="container max-w-4xl py-8">
      <h1 className="font-heading mb-8 text-3xl font-bold">
        {TEST_TYPE_LABELS[testType as (typeof TEST_TYPES)[number]]}
      </h1>
      <PerformanceTestHistoryChart tests={history} />
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add components/client/performance/log-test-dialog.tsx components/client/performance/my-performance-tests.tsx app/(client)/client/performance/
git commit -m "feat(perf-db): client performance pages"
```

---

## Phase 4 — Admin Athlete Performance Hub

### Task 4.1: Summary API endpoint

**Files:**
- Create: `app/api/clients/[id]/performance/summary/route.ts`
- Create: `app/api/clients/[id]/readiness/trend/route.ts`
- Create: `app/api/clients/[id]/tests/[testType]/history/route.ts`

- [ ] **Step 1: Write summary endpoint**

```typescript
// app/api/clients/[id]/performance/summary/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getLatest } from "@/lib/db/daily-readiness"
import { getActive } from "@/lib/db/injuries"
import { getPRsByUser, listByUser } from "@/lib/db/performance-tests"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 })
  const { id } = await params

  const [latestReadiness, activeInjuries, prs, recentTests] = await Promise.all([
    getLatest(id),
    getActive(id),
    getPRsByUser(id),
    listByUser(id).then((t) => t.slice(0, 5)),
  ])

  return NextResponse.json({
    summary: {
      latestReadiness,
      activeInjuriesCount: activeInjuries.length,
      activeInjuries,
      prsCount: prs.length,
      recentPRs: prs.slice(0, 6),
      lastTest: recentTests[0] ?? null,
      recentTests,
    },
  })
}
```

- [ ] **Step 2: Write trend endpoint**

```typescript
// app/api/clients/[id]/readiness/trend/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getReadinessTrend } from "@/lib/db/daily-readiness"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (session.user.role !== "admin" && session.user.id !== (await params).id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const { id } = await params
  const url = new URL(req.url)
  const days = Math.min(Number(url.searchParams.get("days") ?? 30) || 30, 365)
  const trend = await getReadinessTrend(id, days)
  return NextResponse.json({ trend })
}
```

- [ ] **Step 3: Write test history endpoint**

```typescript
// app/api/clients/[id]/tests/[testType]/history/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getTestHistory } from "@/lib/db/performance-tests"
import { TEST_TYPES } from "@/lib/validators/performance-test"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; testType: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id, testType } = await params
  if (session.user.role !== "admin" && session.user.id !== id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  if (!(TEST_TYPES as readonly string[]).includes(testType)) {
    return NextResponse.json({ error: "bad_test_type" }, { status: 400 })
  }
  const history = await getTestHistory(id, testType as (typeof TEST_TYPES)[number])
  return NextResponse.json({ history })
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/clients/[id]/performance/ app/api/clients/[id]/readiness/ app/api/clients/[id]/tests/
git commit -m "feat(perf-db): admin summary + trend + test-history endpoints"
```

---

### Task 4.2: Shared `StatusPill` component

**Files:**
- Create: `components/shared/status-pill.tsx`

- [ ] **Step 1: Check for existing StatusPill**

Run: `npx grep -l "StatusPill\|status-pill" components/` or use the Grep tool with pattern `StatusPill` in `components/`. If a component already exists, reuse/extend it instead of creating a duplicate.

- [ ] **Step 2: Write the component (if none exists)**

```typescript
// components/shared/status-pill.tsx
import { cn } from "@/lib/utils"

type Variant = "active" | "recovering" | "resolved" | "pr" | "neutral"

const VARIANT_CLASSES: Record<Variant, string> = {
  active: "bg-error/10 text-error border-error/30",
  recovering: "bg-warning/10 text-warning border-warning/30",
  resolved: "bg-success/10 text-success border-success/30",
  pr: "bg-accent/15 text-accent-foreground border-accent/40",
  neutral: "bg-muted text-muted-foreground border-border",
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const variant = (
    ["active", "recovering", "resolved", "pr", "neutral"].includes(status) ? status : "neutral"
  ) as Variant
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide",
        VARIANT_CLASSES[variant],
      )}
    >
      {label ?? status}
    </span>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/shared/status-pill.tsx
git commit -m "feat(perf-db): shared StatusPill component"
```

---

### Task 4.3: Admin hub layout + tabs + nav link

**Files:**
- Create: `components/admin/performance/athlete-performance-hub.tsx`
- Create: `app/(admin)/admin/clients/[id]/performance/page.tsx`
- Modify: find the admin client-detail layout/nav and add a "Performance" link

- [ ] **Step 1: Locate admin client-detail nav**

Run: `Glob app/(admin)/admin/clients/[id]/**/*.tsx` and find the layout/page that hosts the per-client tabs or sidebar. If a `layout.tsx` exists at `app/(admin)/admin/clients/[id]/`, that's where to add the link.

- [ ] **Step 2: Write the hub page (Server Component)**

```typescript
// app/(admin)/admin/clients/[id]/performance/page.tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getLatest, getReadinessTrend } from "@/lib/db/daily-readiness"
import { listByUser, getActive } from "@/lib/db/injuries"
import { getPRsByUser, listByUser as listTests } from "@/lib/db/performance-tests"
import { AthletePerformanceHub } from "@/components/admin/performance/athlete-performance-hub"

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

  const [latestReadiness, trend, allInjuries, activeInjuries, prs, recentTests] = await Promise.all([
    getLatest(id),
    getReadinessTrend(id, 30),
    listByUser(id),
    getActive(id),
    getPRsByUser(id),
    listTests(id).then((t) => t.slice(0, 10)),
  ])

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
    />
  )
}
```

- [ ] **Step 3: Write the hub component**

```typescript
// components/admin/performance/athlete-performance-hub.tsx
"use client"

import Link from "next/link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import type { DailyReadiness, Injury, PerformanceTest, PerformanceTestPR } from "@/types/database"
import { ReadinessScoreGauge } from "./readiness-score-gauge"
import { ReadinessTrendChart } from "./readiness-trend-chart"
import { ActiveInjuriesCard } from "./active-injuries-card"
import { InjuryTimelineList } from "./injury-timeline-list"
import { PRsShelfCard } from "./prs-shelf-card"
import { PerformanceTestCard } from "./performance-test-card"

export function AthletePerformanceHub({
  clientUserId,
  tab,
  latestReadiness,
  readinessTrend,
  activeInjuries,
  allInjuries,
  prs,
  recentTests,
}: {
  clientUserId: string
  tab: string
  latestReadiness: DailyReadiness | null
  readinessTrend: { date: string; readiness_score: number }[]
  activeInjuries: Injury[]
  allInjuries: Injury[]
  prs: PerformanceTestPR[]
  recentTests: PerformanceTest[]
}) {
  return (
    <div className="container max-w-6xl py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-3xl font-bold">Performance</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/admin/clients/${clientUserId}/performance/injuries/new`}>+ Report injury</Link>
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
          <TabsTrigger value="injuries" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=injuries`}>Injuries</Link>
          </TabsTrigger>
          <TabsTrigger value="tests" asChild>
            <Link href={`/admin/clients/${clientUserId}/performance?tab=tests`}>Tests</Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 grid gap-6 md:grid-cols-2">
          <ReadinessScoreGauge readiness={latestReadiness} />
          <ActiveInjuriesCard injuries={activeInjuries} clientUserId={clientUserId} />
          <PRsShelfCard prs={prs} />
          {recentTests[0] && (
            <PerformanceTestCard
              latest={recentTests[0]}
              history={recentTests.filter((t) => t.test_type === recentTests[0].test_type).slice(0, 10)}
              clientUserId={clientUserId}
            />
          )}
        </TabsContent>

        <TabsContent value="readiness" className="mt-6">
          <ReadinessTrendChart data={readinessTrend} />
        </TabsContent>

        <TabsContent value="injuries" className="mt-6">
          <InjuryTimelineList injuries={allInjuries} clientUserId={clientUserId} />
        </TabsContent>

        <TabsContent value="tests" className="mt-6 grid gap-4 md:grid-cols-2">
          {Object.entries(
            recentTests.reduce<Record<string, PerformanceTest[]>>((acc, t) => {
              const key = t.test_type === "custom" ? `custom:${t.custom_name}` : t.test_type
              acc[key] = acc[key] ?? []
              acc[key].push(t)
              return acc
            }, {}),
          ).map(([key, list]) => (
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

- [ ] **Step 4: Add nav link to client-detail page/layout**

Once Step 1 located the file, add:

```tsx
<Link href={`/admin/clients/${clientId}/performance`}>Performance</Link>
```

Wire it into the existing nav structure following the same style as adjacent links (e.g. "Programs", "Assessments"). If you cannot determine the exact location, skip this step — the hub is still reachable via direct URL, and the user can wire it manually.

- [ ] **Step 5: Commit**

```bash
git add components/admin/performance/athlete-performance-hub.tsx app/(admin)/admin/clients/[id]/performance/page.tsx
# also stage the nav-link edit if performed
git commit -m "feat(perf-db): admin athlete performance hub page + tabs"
```

---

### Task 4.4: Admin cards — readiness + active injuries

**Files:**
- Create: `components/admin/performance/readiness-score-gauge.tsx`
- Create: `components/admin/performance/readiness-trend-chart.tsx`
- Create: `components/admin/performance/active-injuries-card.tsx`

- [ ] **Step 1: Write the readiness gauge**

```typescript
// components/admin/performance/readiness-score-gauge.tsx
"use client"

import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { DailyReadiness } from "@/types/database"

function scoreColor(score: number) {
  if (score >= 71) return "var(--success)"
  if (score >= 41) return "var(--warning)"
  return "var(--error)"
}

export function ReadinessScoreGauge({ readiness }: { readiness: DailyReadiness | null }) {
  if (!readiness) {
    return (
      <Card>
        <CardHeader><CardTitle>Readiness</CardTitle></CardHeader>
        <CardContent className="py-12 text-center text-muted-foreground">No check-in today</CardContent>
      </Card>
    )
  }
  const score = Number(readiness.readiness_score)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Readiness ({readiness.date})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative h-48">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ value: score, fill: scoreColor(score) }]}
              startAngle={210} endAngle={-30}>
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar dataKey="value" cornerRadius={6} background />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="font-heading text-4xl font-bold">{Math.round(score)}</p>
            <p className="text-muted-foreground text-xs">/ 100</p>
          </div>
        </div>
        <p className="text-muted-foreground mt-4 text-center text-xs">
          Sleep {readiness.sleep_quality}/5 · Sore {readiness.soreness_overall}/5 · Fatigue {readiness.fatigue}/5
        </p>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Write the trend chart**

```typescript
// components/admin/performance/readiness-trend-chart.tsx
"use client"

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function ReadinessTrendChart({ data }: { data: { date: string; readiness_score: number }[] }) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">No readiness data in this range.</CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader><CardTitle>Readiness — 30 day trend</CardTitle></CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <ReferenceLine y={70} stroke="var(--success)" strokeDasharray="3 3" />
              <ReferenceLine y={40} stroke="var(--error)" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="readiness_score" stroke="var(--primary)" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Write active injuries card**

```typescript
// components/admin/performance/active-injuries-card.tsx
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusPill } from "@/components/shared/status-pill"
import type { Injury } from "@/types/database"
import { BODY_REGION_LABELS } from "@/lib/validators/injury"

export function ActiveInjuriesCard({ injuries, clientUserId }: { injuries: Injury[]; clientUserId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active injuries ({injuries.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {injuries.length === 0 ? (
          <p className="text-muted-foreground">No active injuries.</p>
        ) : (
          <ul className="space-y-2">
            {injuries.map((i) => (
              <li key={i.id} className="flex items-center justify-between">
                <Link
                  href={`/admin/clients/${clientUserId}/injuries/${i.id}`}
                  className="hover:underline"
                >
                  {BODY_REGION_LABELS[i.body_region]} — {i.injury_type}
                  <span className="text-muted-foreground ml-2 text-xs">{i.days_lost}d</span>
                </Link>
                <StatusPill status={i.status} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add components/admin/performance/readiness-score-gauge.tsx components/admin/performance/readiness-trend-chart.tsx components/admin/performance/active-injuries-card.tsx
git commit -m "feat(perf-db): admin readiness + active injuries cards"
```

---

### Task 4.5: Admin cards — injury timeline, performance tests, PRs

**Files:**
- Create: `components/admin/performance/injury-timeline-list.tsx`
- Create: `components/admin/performance/injury-rehab-milestone-list.tsx`
- Create: `components/admin/performance/performance-test-card.tsx`
- Create: `components/admin/performance/performance-test-history-chart.tsx`
- Create: `components/admin/performance/prs-shelf-card.tsx`

- [ ] **Step 1: Write injury timeline list**

```typescript
// components/admin/performance/injury-timeline-list.tsx
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { StatusPill } from "@/components/shared/status-pill"
import type { Injury } from "@/types/database"
import { BODY_REGION_LABELS } from "@/lib/validators/injury"

export function InjuryTimelineList({ injuries, clientUserId }: { injuries: Injury[]; clientUserId: string }) {
  if (injuries.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">No injuries recorded.</CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardContent className="p-0">
        <ol className="divide-y">
          {injuries.map((i) => (
            <li key={i.id} className="flex items-center justify-between p-4">
              <div>
                <Link
                  href={`/admin/clients/${clientUserId}/injuries/${i.id}`}
                  className="font-medium hover:underline"
                >
                  {BODY_REGION_LABELS[i.body_region]} — {i.injury_type} ({i.side})
                </Link>
                <p className="text-muted-foreground text-sm">
                  {i.date_occurred} → {i.date_resolved ?? "ongoing"} · {i.days_lost} days lost · {i.severity}
                </p>
              </div>
              <StatusPill status={i.status} />
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Write rehab milestone list (used on detail page)**

```typescript
// components/admin/performance/injury-rehab-milestone-list.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import type { Injury } from "@/types/database"

export function InjuryRehabMilestoneList({ injury }: { injury: Injury }) {
  const router = useRouter()
  const [newName, setNewName] = useState("")
  const [newTarget, setNewTarget] = useState("")

  async function addMilestone() {
    if (!newName.trim()) return
    const res = await fetch(`/api/injuries/${injury.id}/milestones`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        target_date: newTarget || null,
        completed_date: null,
        notes: null,
      }),
    })
    if (!res.ok) toast.error("Failed to add milestone")
    else {
      setNewName("")
      setNewTarget("")
      router.refresh()
    }
  }

  async function completeMilestone(idx: number) {
    const today = new Date().toISOString().slice(0, 10)
    const res = await fetch(`/api/injuries/${injury.id}/milestones/${idx}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completed_date: today }),
    })
    if (!res.ok) toast.error("Failed")
    else router.refresh()
  }

  return (
    <div className="space-y-4">
      {injury.rehab_milestones.length === 0 && (
        <p className="text-muted-foreground text-sm">No milestones yet.</p>
      )}
      <ul className="space-y-2">
        {injury.rehab_milestones.map((m, idx) => (
          <li key={idx} className="flex items-center gap-3 rounded border p-3">
            <Checkbox
              checked={!!m.completed_date}
              onCheckedChange={() => !m.completed_date && completeMilestone(idx)}
            />
            <div className="flex-1">
              <p className={m.completed_date ? "line-through" : ""}>{m.name}</p>
              <p className="text-muted-foreground text-xs">
                target: {m.target_date ?? "—"} · completed: {m.completed_date ?? "—"}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex gap-2 border-t pt-4">
        <Input placeholder="Milestone name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Input type="date" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} className="max-w-[180px]" />
        <Button onClick={addMilestone}>Add</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write performance test card**

```typescript
// components/admin/performance/performance-test-card.tsx
"use client"

import Link from "next/link"
import { LineChart, Line, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import type { PerformanceTest } from "@/types/database"

export function PerformanceTestCard({
  latest, history, clientUserId,
}: {
  latest: PerformanceTest
  history: PerformanceTest[]
  clientUserId: string
}) {
  const label = latest.test_type === "custom" ? latest.custom_name ?? "Custom" : TEST_TYPE_LABELS[latest.test_type]
  const trendData = [...history].reverse().map((t) => ({ value: t.result_value }))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <Link href={`/admin/clients/${clientUserId}/performance/tests/${latest.test_type}`} className="hover:underline">
            {label}
          </Link>
          {latest.is_pr && <Badge className="bg-accent">PR</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-heading text-2xl font-bold">
          {latest.result_value} <span className="text-muted-foreground text-sm font-normal">{latest.result_unit}</span>
        </p>
        {latest.pct_change_from_prev !== null && (
          <p className={`text-xs ${latest.pct_change_from_prev > 0 ? "text-success" : "text-error"}`}>
            {latest.pct_change_from_prev > 0 ? "+" : ""}{latest.pct_change_from_prev.toFixed(1)}% vs prev
          </p>
        )}
        <p className="text-muted-foreground text-xs">{latest.test_date}</p>
        {trendData.length > 1 && (
          <div className="mt-3 h-12">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Write history chart**

```typescript
// components/admin/performance/performance-test-history-chart.tsx
"use client"

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceDot } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PerformanceTest } from "@/types/database"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"

export function PerformanceTestHistoryChart({ tests }: { tests: PerformanceTest[] }) {
  if (tests.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">No tests yet.</CardContent>
      </Card>
    )
  }
  const label = tests[0].test_type === "custom" ? tests[0].custom_name ?? "Custom" : TEST_TYPE_LABELS[tests[0].test_type]
  return (
    <Card>
      <CardHeader><CardTitle>{label} — history ({tests[0].result_unit})</CardTitle></CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={tests}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="test_date" tickFormatter={(d) => d.slice(5)} />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="result_value" stroke="var(--primary)" strokeWidth={2} dot />
              {tests.filter((t) => t.is_pr).map((t) => (
                <ReferenceDot key={t.id} x={t.test_date} y={t.result_value} r={6} fill="var(--accent)" stroke="none" />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: Write PRs shelf card**

```typescript
// components/admin/performance/prs-shelf-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PerformanceTestPR } from "@/types/database"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"

export function PRsShelfCard({ prs }: { prs: PerformanceTestPR[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Personal records</CardTitle></CardHeader>
      <CardContent>
        {prs.length === 0 ? (
          <p className="text-muted-foreground">No PRs yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {prs.map((p) => (
              <li key={`${p.test_type}-${p.test_id}`} className="rounded border p-2">
                <p className="text-muted-foreground text-xs">
                  {p.test_type === "custom" ? p.custom_name : TEST_TYPE_LABELS[p.test_type]}
                </p>
                <p className="font-heading text-lg font-bold">
                  {p.result_value} <span className="text-muted-foreground text-xs font-normal">{p.result_unit}</span>
                </p>
                <p className="text-muted-foreground text-xs">{p.test_date}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add components/admin/performance/injury-timeline-list.tsx components/admin/performance/injury-rehab-milestone-list.tsx components/admin/performance/performance-test-card.tsx components/admin/performance/performance-test-history-chart.tsx components/admin/performance/prs-shelf-card.tsx
git commit -m "feat(perf-db): admin injury timeline + test cards + PR shelf"
```

---

### Task 4.6: Admin log-test + report-injury pages

**Files:**
- Create: `app/(admin)/admin/clients/[id]/performance/log-test/page.tsx`
- Create: `app/(admin)/admin/clients/[id]/performance/injuries/new/page.tsx`

- [ ] **Step 1: Write log-test page**

```typescript
// app/(admin)/admin/clients/[id]/performance/log-test/page.tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { LogTestDialog } from "@/components/client/performance/log-test-dialog"

export default async function AdminLogTestPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const { id } = await params
  return (
    <div className="container max-w-xl py-8">
      <h1 className="font-heading mb-6 text-2xl font-bold">Log test for client</h1>
      <LogTestDialog clientUserId={id} trigger={<Button>Open log dialog</Button>} />
    </div>
  )
}
```

- [ ] **Step 2: Write report-injury page**

```typescript
// app/(admin)/admin/clients/[id]/performance/injuries/new/page.tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ReportInjuryForm } from "@/components/client/performance/report-injury-form"

export default async function AdminReportInjuryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const { id } = await params
  return (
    <div className="container max-w-2xl py-8">
      <h1 className="font-heading mb-6 text-2xl font-bold">Report injury</h1>
      <ReportInjuryForm clientUserId={id} />
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/(admin)/admin/clients/[id]/performance/log-test/ app/(admin)/admin/clients/[id]/performance/injuries/
git commit -m "feat(perf-db): admin log-test + report-injury flows"
```

---

## Phase 5 — E2E Tests + Final Verification

### Task 5.1: Playwright e2e

**Files:**
- Create: `__tests__/e2e/athlete-performance.spec.ts`

- [ ] **Step 1: Write the e2e spec**

```typescript
// __tests__/e2e/athlete-performance.spec.ts
import { test, expect } from "@playwright/test"

// These tests assume a seeded admin and a seeded client user exist in the database.
// Check existing e2e specs (under __tests__/e2e/) for the project's sign-in helper or fixtures.
// If a helper exists, import it. Otherwise inline the sign-in logic for the admin test client.

const CLIENT_EMAIL = process.env.E2E_CLIENT_EMAIL ?? "client-e2e@djpathlete.test"
const CLIENT_PASSWORD = process.env.E2E_CLIENT_PASSWORD ?? "Test1234!"
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin-e2e@djpathlete.test"
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Test1234!"

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login")
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole("button", { name: /sign in|log in/i }).click()
  await page.waitForURL(/\/(client|admin)/, { timeout: 10_000 })
}

test.describe("Athlete Performance", () => {
  test("athlete can log readiness", async ({ page }) => {
    await signIn(page, CLIENT_EMAIL, CLIENT_PASSWORD)
    await page.goto("/client/readiness")
    await page.getByRole("button", { name: /save readiness/i }).click()
    await expect(page.getByText(/readiness logged/i)).toBeVisible()
  })

  test("athlete can log a drop jump test and see PR badge on first entry", async ({ page }) => {
    await signIn(page, CLIENT_EMAIL, CLIENT_PASSWORD)
    await page.goto("/client/performance")
    await page.getByRole("button", { name: /log test/i }).click()
    await page.getByPlaceholder(/e\.g\. 38\.2/i).fill("38.5, 38.2, 37.9")
    await page.getByRole("button", { name: /^save$/i }).click()
    await expect(page.getByText(/new pr|test logged/i)).toBeVisible()
  })

  test("admin can view performance hub for client", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    // The e2e fixture should expose CLIENT_USER_ID via env; if not, navigate via the clients list
    const clientId = process.env.E2E_CLIENT_USER_ID
    test.skip(!clientId, "E2E_CLIENT_USER_ID not set")
    await page.goto(`/admin/clients/${clientId}/performance`)
    await expect(page.getByRole("heading", { name: /performance/i })).toBeVisible()
  })
})
```

- [ ] **Step 2: Run the e2e suite**

Run: `npm run test:e2e -- athlete-performance.spec.ts`
Expected: 2 passing (readiness, log test); admin test may skip if `E2E_CLIENT_USER_ID` isn't set — that's OK.

If tests fail because there's no seeded user, document in the test file that an admin should seed the test users manually, or skip the spec.

- [ ] **Step 3: Commit**

```bash
git add __tests__/e2e/athlete-performance.spec.ts
git commit -m "test(perf-db): e2e for athlete performance flows"
```

---

### Task 5.2: Final verification

**Files:** none modified — verification only.

- [ ] **Step 1: Run linter**

Run: `npm run lint`
Expected: 0 errors. If errors, fix them inline and commit `fix(perf-db): lint cleanup`.

- [ ] **Step 2: Run formatter check**

Run: `npm run format:check`
If failing, run `npm run format` and commit `style(perf-db): prettier`.

- [ ] **Step 3: Run unit tests**

Run: `npm run test:run`
Expected: all pass. Existing tests should still pass — investigate any regressions in adjacent files.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: build succeeds, no TS errors, no missing route exports.

- [ ] **Step 5: Manual smoke in dev**

Run: `npm run dev`

Walk through:
- Sign in as test client → log readiness → see toast → reload → form pre-populated.
- Navigate `/client/performance` → log drop jump → see "New PR!" toast.
- Sign in as admin → navigate to a client's `/admin/clients/[id]/performance` → see overview tab populated.
- Click the "Injuries" tab → see the timeline.

- [ ] **Step 6: Final commit (if any formatting fixups)**

```bash
git status
# if clean, nothing to do; otherwise:
git commit -am "chore(perf-db): final cleanup"
```

---

## Self-Review (completed inline)

**Spec coverage check:**

| Spec section | Covered by |
|---|---|
| §4.1 daily_readiness | Task 1.1 |
| §4.2 injuries | Task 2.1 |
| §4.3 performance_tests | Task 3.1 |
| §4.4 performance_test_pr_view | Task 3.1 step 3 |
| §4.5 readiness_score formula | Task 1.1 step 1 (GENERATED column) |
| §5 validators | Tasks 1.2, 2.2, 3.2 |
| §6 DAL (readiness/injuries/tests) | Tasks 1.3, 2.3, 3.3 |
| §7.1 client routes | Tasks 1.5, 1.6, 2.5, 3.5 |
| §7.2 admin routes (hub + log-test + report-injury) | Tasks 4.3, 4.6 |
| §8 API routes | Tasks 1.4, 2.4, 3.4, 4.1 |
| §9 components (gauge, trend, timeline, cards, dialogs) | Tasks 4.2, 4.4, 4.5 |
| §10 migrations applied via Supabase MCP | Tasks 1.1, 2.1, 3.1 |
| §11 testing (Vitest + Playwright) | Throughout + Task 5.1 |
| §12 component boundaries | Implicit in file structure |
| §15 Definition of Done | Task 5.2 |

No gaps detected.

**Placeholder check:** No "TBD" / "fill in later" / vague error-handling stubs. Every code block is complete or has explicit fallback guidance.

**Type consistency:** `client_user_id` used throughout. `BestMethod`, `TestType`, `BodyRegion` types referenced consistently. `getTestHistory`, `getById`, `create`, `update` signatures match across DAL/API/UI.

---

## Execution

The user has requested execution via the **ralph-loop** plugin (per spec §14 and conversation memory: solo dev, commits direct to `main`).

**Recommended ralph-loop cadence:** one iteration per task (~28 iterations total). Each iteration completes all checkbox steps within its task and commits. Ralph verifies tests/build between iterations.

**Alternative execution paths (if not using ralph-loop):**

1. **Subagent-Driven (recommended fallback)** — REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Fresh subagent per task with two-stage review.
2. **Inline Execution** — REQUIRED SUB-SKILL: `superpowers:executing-plans`. Batch execution with checkpoints.

After choosing the execution path, the implementer should mark each `- [ ]` step complete as work progresses.
