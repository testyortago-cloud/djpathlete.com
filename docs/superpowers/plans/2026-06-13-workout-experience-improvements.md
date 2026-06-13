# Workout Experience Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn 15 pieces of coach feedback on the client workout-logging experience into a cohesive, tested update built on a new `workout_sessions` record.

**Architecture:** Introduce a first-class `workout_sessions` row (one per client per program day) created when a client opens a day's session. Per-set logs (`exercise_progress`) attach to it via `session_id`. PRS is captured at session start, one session RPE at "Finish session," volume load (reps × weight × load-type multiplier) rolls up into it, and `status='completed'` drives streaks. Pure logic lives in small `lib/workout/*` helpers (unit-tested); the session is the home for everything that was previously homeless.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase Postgres (DAL in `lib/db/`, Zod validators in `lib/validators/`), Vitest + Testing Library, Tailwind v4.

**Spec:** [docs/superpowers/specs/2026-06-13-workout-experience-improvements-design.md](../specs/2026-06-13-workout-experience-improvements-design.md)

**Guardrails (autonomous run):** Commit locally on `main`; **do NOT push**. **Do NOT apply the migration to production** (write the file only). No deploys/emails. Never commit `JOURNAL.md`/`DEVLOG.md`.

---

## File Structure

**New files**
- `supabase/migrations/00153_workout_sessions.sql` — table + columns (additive).
- `lib/workout/load-type.ts` — `LOAD_TYPES`, `loadTypeMeta(loadType)` → `{ multiplier, clientLabel }`.
- `lib/workout/volume-load.ts` — `computeVolumeLoad(setDetails, loadType)`, `computeSessionVolumeLoad(...)`.
- `lib/workout/prs-scale.ts` — `PRS_SCALE` (single editable constant) + `PRS_MIN`/`PRS_MAX`.
- `lib/workout/deltas.ts` — `computeExerciseDelta(currentTopSetKg, history)` → `{ pct, direction }`.
- `lib/db/workout-sessions.ts` — DAL mirroring `lib/db/training-sessions.ts`.
- `lib/validators/workout-session.ts` — Zod schemas for ensure/finish/PRS.
- `app/api/client/workouts/session/route.ts` — POST ensure-session (create-on-open + PRS) / PATCH finish.
- `components/client/SessionPrsPrompt.tsx` — skippable PRS prompt.
- `components/client/FinishSessionButton.tsx` — finish + session RPE capture.
- `components/client/WeekBanner.tsx` — "You're on Week X of Y".
- Tests under `__tests__/workout/` for each pure helper + streak.

**Modified files**
- `app/api/client/workouts/log/route.ts` — attach `session_id`; ensure session exists.
- `lib/db/progress.ts` — `getWorkoutStreak` → count completed sessions; `logProgress` accepts `session_id`.
- `lib/validators/workout-log.ts` — add optional `session_id`, `week_number`, `day_of_week`.
- `components/client/WorkoutDay.tsx` — remove per-set RPE, volume load display, dumbbell label, smaller weight box, on-screen deltas, surface notes, rehydrate sets, video badge, harden inputs.
- `app/(client)/client/workouts/page.tsx` — session-based logged state (drop UTC check), pass rehydration + session data.
- `components/client/WorkoutTabs.tsx` — default to current week + render `WeekBanner`.
- `lib/weight-recommendation.ts` — delete "Start light, find your working weight".
- `types/database.ts` — `WorkoutSession` interface, `LoadType` type, `ExerciseProgress.session_id`, `Exercise.load_type`, `ProgramExercise.requires_video`.
- Admin exercise editor + program builder — `load_type` select + `requires_video` toggle (paths resolved in Task 5.x).

---

## Phase 0 — Session-record foundation

### Task 0.1: Migration file (additive, NOT applied)

**Files:**
- Create: `supabase/migrations/00153_workout_sessions.sql`

- [ ] **Step 1: Confirm next migration number**

Run: `ls supabase/migrations | sort | tail -3`
Expected: highest is `00152_*`. If not, rename file to next free number and update this plan.

- [ ] **Step 2: Write the migration**

```sql
-- Workout Sessions: one row per client per program day (the program-flow session anchor)
-- =====================================================================
CREATE TABLE IF NOT EXISTS workout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES program_assignments(id) ON DELETE CASCADE,
  week_number INT NOT NULL,
  day_of_week INT NOT NULL,
  session_date DATE NOT NULL,
  prs INT CHECK (prs BETWEEN 0 AND 10),
  prs_recorded_at TIMESTAMPTZ,
  session_rpe INT CHECK (session_rpe BETWEEN 1 AND 10),
  volume_load_kg NUMERIC,
  duration_seconds INT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workout_sessions_user_assignment_week_day_unique
    UNIQUE (user_id, assignment_id, week_number, day_of_week)
);

CREATE INDEX idx_workout_sessions_user ON workout_sessions(user_id);
CREATE INDEX idx_workout_sessions_user_status ON workout_sessions(user_id, status);
CREATE INDEX idx_workout_sessions_assignment ON workout_sessions(assignment_id);

CREATE TRIGGER set_workout_sessions_updated_at
  BEFORE UPDATE ON workout_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage workout sessions"
  ON workout_sessions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Clients can view own workout sessions"
  ON workout_sessions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Clients can insert own workout sessions"
  ON workout_sessions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Clients can update own workout sessions"
  ON workout_sessions FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- Link per-set logs to a session
ALTER TABLE exercise_progress
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES workout_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_exercise_progress_session ON exercise_progress(session_id);

-- Coach-configurable weight entry convention per exercise
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS load_type TEXT NOT NULL DEFAULT 'total'
  CHECK (load_type IN ('total','per_dumbbell','per_side'));

-- Coach flag: this exercise must be video-recorded
ALTER TABLE program_exercises
  ADD COLUMN IF NOT EXISTS requires_video BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Commit** (do NOT apply to prod)

```bash
git add supabase/migrations/00153_workout_sessions.sql
git commit -m "feat(db): workout_sessions table + session_id/load_type/requires_video columns (migration only)"
```

### Task 0.2: Types

**Files:**
- Modify: `types/database.ts`

- [ ] **Step 1:** Add near the `TrainingSession` interface:

```ts
export type LoadType = "total" | "per_dumbbell" | "per_side"
export type WorkoutSessionStatus = "in_progress" | "completed"

export interface WorkoutSession {
  id: string
  user_id: string
  assignment_id: string
  week_number: number
  day_of_week: number
  session_date: string // YYYY-MM-DD
  prs: number | null
  prs_recorded_at: string | null
  session_rpe: number | null
  volume_load_kg: number | null
  duration_seconds: number | null
  status: WorkoutSessionStatus
  started_at: string
  completed_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 2:** Add `session_id: string | null` to the `ExerciseProgress` interface; `load_type: LoadType` to `Exercise`; `requires_video: boolean` to `ProgramExercise`.

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no new type errors from these additions; fix any consumers that build `ExerciseProgress`/`Exercise`/`ProgramExercise` literals).

- [ ] **Step 4: Commit** `git commit -am "feat(types): WorkoutSession + load_type/requires_video/session_id"`

### Task 0.3: `lib/workout/load-type.ts` (pure, TDD)

**Files:**
- Create: `lib/workout/load-type.ts`
- Test: `__tests__/workout/load-type.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest"
import { loadTypeMeta } from "@/lib/workout/load-type"

describe("loadTypeMeta", () => {
  it("total: ×1, no client label", () => {
    expect(loadTypeMeta("total")).toEqual({ multiplier: 1, clientLabel: null })
  })
  it("per_dumbbell: ×2, 'per dumbbell' label", () => {
    const m = loadTypeMeta("per_dumbbell")
    expect(m.multiplier).toBe(2)
    expect(m.clientLabel).toMatch(/per dumbbell/i)
  })
  it("per_side: ×2, 'per side' label", () => {
    const m = loadTypeMeta("per_side")
    expect(m.multiplier).toBe(2)
    expect(m.clientLabel).toMatch(/per side/i)
  })
  it("defaults unknown to total", () => {
    expect(loadTypeMeta(undefined as unknown as "total").multiplier).toBe(1)
  })
})
```

- [ ] **Step 2: Run → fails.** `npm run test:run -- load-type`

- [ ] **Step 3: Implement**

```ts
import type { LoadType } from "@/types/database"

export const LOAD_TYPES: LoadType[] = ["total", "per_dumbbell", "per_side"]

export const LOAD_TYPE_ADMIN_LABELS: Record<LoadType, string> = {
  total: "Total weight (one number)",
  per_dumbbell: "Per dumbbell (client holds two)",
  per_side: "Per side (one limb at a time)",
}

/** multiplier = how many times the entered weight is actually moved per rep (for volume load).
 *  clientLabel = short hint shown next to the weight box; null = no hint. */
export function loadTypeMeta(loadType: LoadType | null | undefined): {
  multiplier: number
  clientLabel: string | null
} {
  switch (loadType) {
    case "per_dumbbell":
      return { multiplier: 2, clientLabel: "per dumbbell — enter one" }
    case "per_side":
      return { multiplier: 2, clientLabel: "per side" }
    case "total":
    default:
      return { multiplier: 1, clientLabel: null }
  }
}
```

- [ ] **Step 4: Run → passes.** `npm run test:run -- load-type`
- [ ] **Step 5: Commit** `git commit -am "feat(workout): load-type meta helper"`

### Task 0.4: `lib/workout/volume-load.ts` (pure, TDD)

**Files:**
- Create: `lib/workout/volume-load.ts`
- Test: `__tests__/workout/volume-load.test.ts`

`set_details` shape (from `WorkoutDay.tsx`): array of `{ weight_kg: number | null; reps: number | null; rpe?: number | null }`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest"
import { computeVolumeLoad } from "@/lib/workout/volume-load"

const sets = [
  { weight_kg: 40, reps: 10 },
  { weight_kg: 40, reps: 8 },
]

describe("computeVolumeLoad", () => {
  it("total: sum(reps*weight)", () => {
    expect(computeVolumeLoad(sets, "total")).toBe(40 * 10 + 40 * 8) // 720
  })
  it("per_dumbbell: ×2", () => {
    expect(computeVolumeLoad(sets, "per_dumbbell")).toBe(720 * 2) // 1440
  })
  it("ignores null/empty weight or reps", () => {
    expect(computeVolumeLoad([{ weight_kg: null, reps: 10 }, { weight_kg: 30, reps: null }], "total")).toBe(0)
  })
  it("empty → 0", () => {
    expect(computeVolumeLoad([], "total")).toBe(0)
  })
})
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement**

```ts
import type { LoadType } from "@/types/database"
import { loadTypeMeta } from "@/lib/workout/load-type"

export interface VolumeSet {
  weight_kg: number | null
  reps: number | null
}

export function computeVolumeLoad(sets: VolumeSet[] | null | undefined, loadType: LoadType | null | undefined): number {
  if (!sets || sets.length === 0) return 0
  const { multiplier } = loadTypeMeta(loadType)
  let total = 0
  for (const s of sets) {
    const w = typeof s.weight_kg === "number" ? s.weight_kg : 0
    const r = typeof s.reps === "number" ? s.reps : 0
    if (w > 0 && r > 0) total += w * r * multiplier
  }
  return total
}

/** Sum volume load over a list of per-exercise (sets, loadType) entries. */
export function computeSessionVolumeLoad(entries: Array<{ sets: VolumeSet[]; loadType: LoadType | null }>): number {
  return entries.reduce((sum, e) => sum + computeVolumeLoad(e.sets, e.loadType), 0)
}
```

- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** `git commit -am "feat(workout): volume-load computation"`

### Task 0.5: `lib/workout/prs-scale.ts`

**Files:**
- Create: `lib/workout/prs-scale.ts`

- [ ] **Step 1: Implement** (single editable constant — swap to coach's wording later)

```ts
export const PRS_MIN = 0
export const PRS_MAX = 10

/** Standard Perceived Recovery Status scale (Laurent et al., 2011).
 *  EDIT THIS to drop in the coach's exact wording — nothing else needs to change. */
export const PRS_SCALE: Array<{ value: number; label: string }> = [
  { value: 0, label: "Very poorly recovered — extremely tired" },
  { value: 2, label: "Poorly recovered — very tired" },
  { value: 4, label: "Somewhat recovered" },
  { value: 6, label: "Adequately recovered" },
  { value: 8, label: "Well recovered — somewhat energetic" },
  { value: 10, label: "Very well recovered — highly energetic" },
]

export const PRS_TITLE = "How recovered do you feel today?"
export const PRS_HELP = "Quick gut check before you start. You can skip it."
```

- [ ] **Step 2: Commit** `git commit -am "feat(workout): PRS scale constant"`

### Task 0.6: `lib/validators/workout-session.ts`

**Files:**
- Create: `lib/validators/workout-session.ts`

- [ ] **Step 1: Implement**

```ts
import { z } from "zod"

export const ensureSessionSchema = z.object({
  assignment_id: z.string().uuid(),
  week_number: z.number().int().min(1),
  day_of_week: z.number().int().min(0).max(7),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  prs: z.number().int().min(0).max(10).nullable().optional(),
})

export const finishSessionSchema = z.object({
  session_id: z.string().uuid(),
  session_rpe: z.number().int().min(1).max(10),
  duration_seconds: z.number().int().min(0).max(86400).nullable().optional(),
})

export type EnsureSessionInput = z.infer<typeof ensureSessionSchema>
export type FinishSessionInput = z.infer<typeof finishSessionSchema>
```

- [ ] **Step 2: Commit** `git commit -am "feat(validators): workout-session schemas"`

### Task 0.7: `lib/db/workout-sessions.ts` DAL

**Files:**
- Create: `lib/db/workout-sessions.ts`

Mirror `lib/db/training-sessions.ts` (service-role client). Implement:

- [ ] **Step 1: Implement**

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { WorkoutSession } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

/** Find-or-create the session for a (user, assignment, week, day). */
export async function ensureSession(input: {
  user_id: string
  assignment_id: string
  week_number: number
  day_of_week: number
  session_date: string
}): Promise<WorkoutSession> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("workout_sessions")
    .upsert(
      { ...input, status: "in_progress" },
      { onConflict: "user_id,assignment_id,week_number,day_of_week", ignoreDuplicates: false },
    )
    .select()
    .single()
  if (error) throw error
  return data as WorkoutSession
}

export async function getSession(
  userId: string,
  assignmentId: string,
  weekNumber: number,
  dayOfWeek: number,
): Promise<WorkoutSession | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("workout_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("assignment_id", assignmentId)
    .eq("week_number", weekNumber)
    .eq("day_of_week", dayOfWeek)
    .maybeSingle()
  if (error) return null
  return (data as WorkoutSession) ?? null
}

export async function setPrs(sessionId: string, prs: number | null): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("workout_sessions")
    .update({ prs, prs_recorded_at: prs == null ? null : new Date().toISOString() })
    .eq("id", sessionId)
  if (error) throw error
}

export async function finishSession(
  sessionId: string,
  patch: { session_rpe: number; volume_load_kg: number | null; duration_seconds: number | null },
): Promise<WorkoutSession> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("workout_sessions")
    .update({ ...patch, status: "completed", completed_at: new Date().toISOString() })
    .eq("id", sessionId)
    .select()
    .single()
  if (error) throw error
  return data as WorkoutSession
}

/** Completed sessions (newest first) — used for streaks. */
export async function listCompletedSessionDates(userId: string): Promise<string[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("workout_sessions")
    .select("session_date, completed_at")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
  if (error || !data) return []
  return data.map((r) => r.session_date as string)
}

export async function getCompletedSessionCount(userId: string): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("workout_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "completed")
  if (error) return 0
  return count ?? 0
}
```

- [ ] **Step 2: Typecheck + commit** `npx tsc --noEmit` then `git commit -am "feat(db): workout-sessions DAL"`

### Task 0.8: ensure/finish API route

**Files:**
- Create: `app/api/client/workouts/session/route.ts`

- [ ] **Step 1: Implement** (auth + payment guard like the log route)

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { ensureSessionSchema, finishSessionSchema } from "@/lib/validators/workout-session"
import { ensureSession, setPrs, finishSession } from "@/lib/db/workout-sessions"
import { assertAssignmentPayable } from "@/lib/services/access-guard"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const parsed = ensureSessionSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 })
    const { assignment_id, week_number, day_of_week, session_date, prs } = parsed.data
    const { ok } = await assertAssignmentPayable(assignment_id)
    if (!ok) return NextResponse.json({ error: "Payment required" }, { status: 402 })
    const ws = await ensureSession({ user_id: session.user.id, assignment_id, week_number, day_of_week, session_date })
    if (prs !== undefined) await setPrs(ws.id, prs)
    return NextResponse.json({ session: ws }, { status: 200 })
  } catch (e) {
    console.error("ensure-session error:", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const parsed = finishSessionSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 })
    const { session_id, session_rpe, duration_seconds } = parsed.data
    // volume_load_kg is recomputed server-side in a later task; pass null for now if absent
    const ws = await finishSession(session_id, { session_rpe, volume_load_kg: null, duration_seconds: duration_seconds ?? null })
    return NextResponse.json({ session: ws }, { status: 200 })
  } catch (e) {
    console.error("finish-session error:", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit** `git commit -am "feat(api): ensure/finish workout session route"`

### Task 0.9: Attach `session_id` in the log path

**Files:**
- Modify: `lib/validators/workout-log.ts` (add optional `session_id: z.string().uuid().nullable().optional()`, `week_number`, `day_of_week` optional ints)
- Modify: `lib/db/progress.ts` `logProgress` — already spreads the object; ensure `session_id` is included in the insert (it is, since it inserts the passed object — just make sure the type allows it).
- Modify: `app/api/client/workouts/log/route.ts` — if `session_id` absent but `week_number`/`day_of_week`/`assignment_id` present, call `ensureSession` to get one, then pass `session_id` to `logProgress`.

- [ ] **Step 1:** Update validator + route to thread `session_id` (ensure-on-log fallback).
- [ ] **Step 2: Typecheck** `npx tsc --noEmit`
- [ ] **Step 3: Commit** `git commit -am "feat(api): attach session_id to logged sets"`

---

## Phase 1 — Logging-screen changes (`WorkoutDay.tsx`)

> All tasks modify `components/client/WorkoutDay.tsx` unless noted. Review each visually. Reference anchors are approximate — locate by the described markup.

### Task 1.1: Delete the stale tip

**Files:** Modify `lib/weight-recommendation.ts` (lines ~195, ~260)

- [ ] **Step 1:** Replace `reasoning: "Start light, find your working weight"` (both occurrences) with `reasoning: null` and ensure the recommendation card hides an empty reasoning line.
- [ ] **Step 2:** Verify the card (`WorkoutDay.tsx` ~618-635) renders nothing when reasoning is null/empty.
- [ ] **Step 3: Commit** `git commit -am "fix(workout): remove 'start light' tip"`

### Task 1.2: Remove per-set RPE column

**Files:** Modify `components/client/WorkoutDay.tsx` (RPE header ~656-660; RPE `<Select>` ~698-718; `SetRow.rpe`; the RPE gate ~350-355).

- [ ] **Step 1:** Remove the RPE column header + per-set RPE select cell. Keep `SetRow` shape but stop requiring/collecting per-set RPE in the UI (leave `rpe` optional internally; it is no longer rendered).
- [ ] **Step 2:** Remove the "RPE required" submit gate (`~350-355`). Submit no longer depends on per-set RPE.
- [ ] **Step 3:** The log payload's `rpe` field: send `null` (session RPE is captured at Finish session instead).
- [ ] **Step 4: Typecheck + visual check + commit** `git commit -am "feat(workout): drop per-set RPE in favour of session RPE"`

### Task 1.3: Smaller weight box + dumbbell label

**Files:** Modify `components/client/WorkoutDay.tsx` (weight input ~672-683; unit header ~651).

- [ ] **Step 1:** Change the weight `<input>` from `w-full` to a fixed compact width (`w-16 sm:w-20`), keep `h-8 text-xs`.
- [ ] **Step 2:** Compute `const { clientLabel } = loadTypeMeta(displayExercise.load_type)` and, when non-null, render it as a small muted line under the unit header / beside the weight box (e.g. `<span className="text-[10px] text-muted-foreground">{clientLabel}</span>`).
- [ ] **Step 3: Commit** `git commit -am "feat(workout): compact weight box + dumbbell load-type label"`

### Task 1.4: Volume load display

**Files:** Modify `components/client/WorkoutDay.tsx`.

- [ ] **Step 1:** From current `setRows` (convert entered display weight → kg with `toKg`), compute live `computeVolumeLoad(...)` for the exercise; show `Load {displayWeight(load)} {unitLabel()}` near the sets table footer.
- [ ] **Step 2:** Surface a per-day session total in `WorkoutDay` (parent) by summing children — pass a callback or lift the computed per-exercise load up; render in the day header / WeekBanner area. (If lifting state is heavy, compute the session total in the page from saved logs and show on completion; inline live-total is best-effort.)
- [ ] **Step 3: Commit** `git commit -am "feat(workout): show volume load per exercise + session total"`

### Task 1.5: On-screen green/red delta

**Files:** Create `lib/workout/deltas.ts` + test `__tests__/workout/deltas.test.ts`; modify `WorkoutDay.tsx`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest"
import { computeExerciseDelta } from "@/lib/workout/deltas"

describe("computeExerciseDelta", () => {
  it("up when current top set beats last", () => {
    expect(computeExerciseDelta(50, [{ weight_kg: 40 }])).toEqual({ pct: 25, direction: "up" })
  })
  it("down when lower", () => {
    expect(computeExerciseDelta(36, [{ weight_kg: 40 }]).direction).toBe("down")
  })
  it("neutral with no history", () => {
    expect(computeExerciseDelta(40, [])).toEqual({ pct: null, direction: "neutral" })
  })
})
```

- [ ] **Step 2: Implement**

```ts
export function computeExerciseDelta(
  currentTopSetKg: number | null,
  history: Array<{ weight_kg: number | null }>,
): { pct: number | null; direction: "up" | "down" | "neutral" } {
  const last = history.find((h) => typeof h.weight_kg === "number" && (h.weight_kg ?? 0) > 0)?.weight_kg ?? null
  if (currentTopSetKg == null || last == null || last <= 0) return { pct: null, direction: "neutral" }
  const pct = Math.round(((currentTopSetKg - last) / last) * 100)
  return { pct: Math.abs(pct), direction: pct > 0 ? "up" : pct < 0 ? "down" : "neutral" }
}
```

- [ ] **Step 3:** In `WorkoutDay.tsx`, compute the delta from the exercise's `rec.last_weight_kg`/history (already available) vs the current top set; render a small chip: green `↑{pct}%` / red `↓{pct}%` / nothing when neutral. Place it on the exercise header.
- [ ] **Step 4: Test + commit** `git commit -am "feat(workout): on-screen green/red delta vs last time"`

### Task 1.6: Surface coach notes

**Files:** Modify `components/client/WorkoutDay.tsx` (notes ~569-575 inside the collapsed `<details>`).

- [ ] **Step 1:** Render `pe.notes` (the amber coach-cue) as an **always-visible** line on the card (outside the collapsed dropdown), keeping the fuller `instructions` text inside the expandable section. Preserve `whitespace-pre-line`.
- [ ] **Step 2: Commit** `git commit -am "feat(workout): surface coach notes outside the dropdown"`

---

## Phase 2 — "Saved then gone" fix

### Task 2.1: Session-based logged state (drop UTC check)

**Files:** Modify `app/(client)/client/workouts/page.tsx` (~148-154, ~234-247), `components/client/WorkoutDay.tsx`.

- [ ] **Step 1:** Fetch the current week/day `workout_session` + its attached `exercise_progress` rows for the open program (via `getSession` + a query on `exercise_progress.session_id`). Build `loggedExerciseIds` from rows that have a session log.
- [ ] **Step 2:** Replace `wasLoggedToday(...)` usage with session-membership (`loggedExerciseIds.has(exercise.id)`). Remove the `todayStr`/UTC comparison entirely.
- [ ] **Step 3: Commit** `git commit -am "fix(workout): logged state from session, not UTC date"`

### Task 2.2: Rehydrate entered sets

**Files:** Modify `components/client/WorkoutDay.tsx` (`createInitialSetRows` usage ~231), page passes `savedSetDetails` per exercise.

- [ ] **Step 1:** Pass each exercise's saved `set_details` (from the session's log, fallback to latest log) into `ExerciseCard` as `savedSetDetails`.
- [ ] **Step 2:** Initialise `setRows` from `savedSetDetails` when present (map `{weight_kg,reps}` → display weight strings), else `createInitialSetRows(...)`. Mark such cards as already-logged but editable.
- [ ] **Step 3: Visual check (manual on go-ahead) + commit** `git commit -am "fix(workout): rehydrate entered sets on reopen"`

---

## Phase 3 — Session lifecycle (PRS start, RPE end)

### Task 3.1: PRS prompt at session start

**Files:** Create `components/client/SessionPrsPrompt.tsx`; wire into the day view (`WorkoutDay`/`WorkoutTabs`).

- [ ] **Step 1:** Build a skippable prompt from `PRS_SCALE` (buttons 0–10 or the 6 anchors). On open of a day with no `prs` recorded, show it once; on choose/skip, POST `/api/client/workouts/session` with `{assignment_id, week_number, day_of_week, session_date, prs}` (or `prs:null` on skip) — this also creates the session row.
- [ ] **Step 2:** `session_date` = client-local `YYYY-MM-DD` (compute from `new Date()` in the browser, not UTC).
- [ ] **Step 3: Commit** `git commit -am "feat(workout): PRS check at session start"`

### Task 3.2: Finish session + session RPE

**Files:** Create `components/client/FinishSessionButton.tsx`; wire into the day footer.

- [ ] **Step 1:** Button appears once ≥1 exercise is logged in the day; auto-highlights when all prescribed exercises are logged. On tap, ask one RPE (1–10), compute the day's `volume_load_kg` from logged sets, PATCH `/api/client/workouts/session` with `{session_id, session_rpe, duration_seconds}`.
- [ ] **Step 2:** On success, mark the day complete in the UI, show a short "session done" state (and the volume-load total + any green/red summary), `router.refresh()`.
- [ ] **Step 3: Commit** `git commit -am "feat(workout): finish session + single session RPE"`

### Task 3.3: Feed `training_sessions` downstream

**Files:** Modify `lib/db/workout-sessions.ts` `finishSession` (or the PATCH route) to upsert a `training_sessions` row.

- [ ] **Step 1:** On finish, upsert `training_sessions` via its existing DAL: `{date: session_date, session_type: 'gym', rpe: session_rpe, duration_min: round(duration_seconds/60) || 1, program_assignment_id: assignment_id}`. Wrap in try/catch — must not block finishing.
- [ ] **Step 2: Commit** `git commit -am "feat(workout): feed readiness training_sessions on finish"`

---

## Phase 4 — Streak + week banner

### Task 4.1: Streak = completed sessions (TDD)

**Files:** Modify `lib/db/progress.ts` `getWorkoutStreak`; test `__tests__/workout/streak.test.ts` (extract a pure `streakFromDates(dates, todayStr)` helper to make it testable).

- [ ] **Step 1:** Extract pure `streakFromDates(uniqueDates: string[], todayStr: string, yesterdayStr: string): number` into `lib/workout/streak.ts`.

- [ ] **Step 2: Failing test**

```ts
import { describe, it, expect } from "vitest"
import { streakFromDates } from "@/lib/workout/streak"
it("counts consecutive days ending today", () => {
  expect(streakFromDates(["2026-06-13","2026-06-12","2026-06-11"], "2026-06-13", "2026-06-12")).toBe(3)
})
it("breaks on gap", () => {
  expect(streakFromDates(["2026-06-13","2026-06-11"], "2026-06-13", "2026-06-12")).toBe(1)
})
it("zero when latest older than yesterday", () => {
  expect(streakFromDates(["2026-06-01"], "2026-06-13", "2026-06-12")).toBe(0)
})
```

- [ ] **Step 3:** Implement `streakFromDates` (port the existing backward-count loop). Rewrite `getWorkoutStreak` to source dates from `listCompletedSessionDates(userId)` (completed `workout_sessions`) instead of `exercise_progress`, then `streakFromDates(...)`.
- [ ] **Step 4: Test + commit** `git commit -am "feat(workout): streak counts completed sessions"`

### Task 4.2: Week banner + default to current week

**Files:** Create `components/client/WeekBanner.tsx`; modify `components/client/WorkoutTabs.tsx` (~199-202).

- [ ] **Step 1:** Ensure `selectedWeek` initialises to `safeCurrentWeek` (current week). Verify `currentWeek` is honoured.
- [ ] **Step 2:** Render `WeekBanner` ("You're on Week {currentWeek} of {totalWeeks}") prominently above the day pills; style other weeks as clearly secondary when browsed.
- [ ] **Step 3: Commit** `git commit -am "feat(workout): current-week banner + default selection"`

---

## Phase 5 — Video star + admin toggles

### Task 5.1: Client video indicator

**Files:** Modify `components/client/WorkoutDay.tsx`.

- [ ] **Step 1:** When `pe.requires_video`, render a 🎥 badge (Lucide `Video`) + "Record this one" hint on the exercise header, and a small marker in the day summary list.
- [ ] **Step 2: Commit** `git commit -am "feat(workout): client video-required indicator"`

### Task 5.2: Admin toggles (locate + wire)

**Files:** Resolve via `grep`: the exercise editor form (for `load_type`) and the program builder exercise row (for `requires_video`).

- [ ] **Step 1:** `grep -rl "instructions" components/admin | head` and locate the exercise create/edit form; add a `load_type` `<Select>` using `LOAD_TYPE_ADMIN_LABELS`. Persist via the exercises DAL/validator (add `load_type` to the exercise Zod schema + update mapping).
- [ ] **Step 2:** Locate the program-builder per-exercise editor; add a `requires_video` checkbox. Persist via the program-exercises DAL/validator.
- [ ] **Step 3:** Update relevant Zod validators (`lib/validators/exercise.ts`, program-exercise validator) to include the new fields.
- [ ] **Step 4: Typecheck + commit** `git commit -am "feat(admin): load_type + requires_video editors"`

---

## Phase 6 — Reps-tap hardening

### Task 6.1: Defensive input hardening

**Files:** Modify `components/client/WorkoutDay.tsx` (reps/weight inputs; Coach DJP button ~830-845).

- [ ] **Step 1:** Add `inputMode="numeric"` to reps/weight inputs; add `onClick={(e)=>e.stopPropagation()}` and `onFocus={(e)=>e.stopPropagation()}` so no ancestor handler can hijack the tap.
- [ ] **Step 2:** Ensure the "Coach DJP" button is visually separated from the sets table (margin / distinct row) so an accidental tap can't land on it; confirm it's a `<button type="button">` (not a submit/link).
- [ ] **Step 3:** Add a `data-testid` and a comment noting this is defensive pending repro.
- [ ] **Step 4: Commit** `git commit -am "fix(workout): harden set inputs against accidental navigation"`

---

## Final verification (after all phases)

- [ ] `npm run lint` → no new errors
- [ ] `npx tsc --noEmit` → clean
- [ ] `npm run test:run` → all green (new helper tests included)
- [ ] `npm run build` → succeeds
- [ ] Holistic review via superpowers:requesting-code-review
- [ ] Update `JOURNAL.md` (local only, never commit)
- [ ] Final report to coach: defaults taken, what's done/verified, what needs go-ahead (apply migration + push + manual click-through + PRS wording + reps-tap repro)

## Spec-coverage check
1✓(1.2,3.2) 2/13✓(0.3,1.3,5.2) 3/11✓(0.1,5.1,5.2) 4✓(0.5,3.1) 5✓(6.1) 6✓(1.1) 7✓(1.5) 8✓(2.1,2.2) 9/10✓(4.2) 12✓(1.3) 14✓(4.1) 15✓(1.6) — volume load✓(0.4,1.4), training_sessions feed✓(3.3).
