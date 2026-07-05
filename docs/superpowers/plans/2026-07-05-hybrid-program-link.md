# Hybrid Program Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marking an in-person session Attended advances the client's linked online program by one day; self check-ins also mark the day's scheduled session attended.

**Architecture:** Explicit `assignment_id` link on `recurring_sessions` (mirrors the pack link). `markAttended` calls a new `handleAttendanceProgramAdvance` guarded by a per-(assignment, date) completed-workout check that kills every double-advance path. The three self check-in routes gain the existing `bridgeCheckinToSchedule` call.

**Tech Stack:** Next.js 16 routes, Supabase (migration 00180 via MCP), Zod, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-hybrid-program-link-design.md`.
- A progression failure must NEVER fail attendance or a check-in (try/catch + log, mirroring `cancelSession`'s fee pattern).
- When a service gains a new import that reads DB/flags, every pre-existing test importing that service gets a `vi.mock` for the new import (recurring lesson).
- No flag — inert until a coach links a slot. Migration applied via `mcp__supabase__apply_migration` (never CLI).
- Commit per task; prod-source tsc stays clean.

---

### Task 1: Migration 00180 + types + validator

**Files:**
- Create: `supabase/migrations/00180_hybrid_program_link.sql`
- Modify: `types/database.ts` (RecurringSession + ScheduledSession), `lib/validators/sessions.ts` (`recurringSlotUpdateSchema`)
- Test: `__tests__/lib/validators/sessions.test.ts` (extend; create if absent)

**Interfaces:**
- Produces: `RecurringSession.assignment_id: string | null`, `ScheduledSession.workout_session_id: string | null`, `recurringSlotUpdateSchema` accepting `assignmentId?: string(uuid) | null`.

- [ ] Failing test: `recurringSlotUpdateSchema.safeParse({ assignmentId: "11111111-1111-1111-8111-111111111111" }).success === true`, `{ assignmentId: null }` ok, `{ assignmentId: "not-a-uuid" }` fails. Run → FAIL (unknown key is stripped: assert `parsed.data.assignmentId` defined).
- [ ] Migration SQL:

```sql
-- Hybrid link: a standing slot can advance an online program on attendance.
alter table recurring_sessions
  add column if not exists assignment_id uuid references program_assignments(id) on delete set null;
create index if not exists idx_recurring_sessions_assignment
  on recurring_sessions(assignment_id) where assignment_id is not null;
-- Which program day an attendance completed (traceability / future revert hook).
alter table scheduled_sessions
  add column if not exists workout_session_id uuid references workout_sessions(id) on delete set null;
```

- [ ] `types/database.ts`: add `assignment_id: string | null` to `RecurringSession`, `workout_session_id: string | null` to `ScheduledSession`.
- [ ] Validator: `assignmentId: z.string().uuid().nullable().optional()` on `recurringSlotUpdateSchema`.
- [ ] Tests green → commit `feat(hybrid): migration 00180 + types + slot validator accepts assignmentId`.

### Task 2: Day-guard DAL

**Files:**
- Modify: `lib/db/workout-sessions.ts`
- Test: `__tests__/lib/db/workout-sessions.hasCompletedOnDate.test.ts`

**Interfaces:**
- Produces: `hasCompletedOnDate(userId: string, assignmentId: string, sessionDate: string): Promise<boolean>`

- [ ] Failing test (mock `@/lib/supabase` chainable like sibling DAL tests): returns true when a row exists, false when empty, **false on error** (guard must fail OPEN=skip-advance? No — fail CLOSED for money? This is progression, not money: on a DB error return `true` (treat as already-completed → skip advance) so a flaky read can't double-advance; document in code).
- [ ] Implementation:

```ts
/** True when any completed workout session exists for (user, assignment, date).
 *  Errors return true so a flaky read can only SKIP an advance, never double it. */
export async function hasCompletedOnDate(userId: string, assignmentId: string, sessionDate: string): Promise<boolean> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("workout_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("assignment_id", assignmentId)
    .eq("session_date", sessionDate)
    .eq("status", "completed")
    .limit(1)
  if (error) return true
  return (data ?? []).length > 0
}
```

- [ ] Green → commit `feat(hybrid): hasCompletedOnDate day guard`.

### Task 3: handleAttendanceProgramAdvance

**Files:**
- Modify: `lib/services/program-progression.ts`
- Test: `__tests__/lib/services/attendance-program-advance.test.ts`

**Interfaces:**
- Consumes: `getRecurringSessionById`, `getAssignmentById`, `hasCompletedOnDate`, `advanceProgramForCheckin`, `updateScheduledSession`.
- Produces: `handleAttendanceProgramAdvance(session: Pick<ScheduledSession, "id" | "client_user_id" | "recurring_session_id" | "session_date">): Promise<{ advanced: boolean }>`

- [ ] Failing tests (mock all DALs): no-ops for ad-hoc (null recurring_session_id), unlinked slot, missing/inactive assignment, **reassigned occurrence** (assignment.user_id ≠ session.client_user_id), day-guard true. Advances + stamps `workout_session_id` + updates week otherwise; fires completion notifications when program finishes (assert via mocked email/notification like existing progression tests — or assert `updateAssignment` completed).
- [ ] Implementation (in program-progression.ts, below the check-in twin):

```ts
/**
 * Advance the standing slot's linked program when an occurrence is marked
 * attended. Inert unless the slot links an assignment. The (assignment, date)
 * completed-day guard kills every double-advance path: pack check-in + bridge
 * on the same day, re-marking attended, a client who already logged today's
 * workout online, twice-daily slots.
 */
export async function handleAttendanceProgramAdvance(
  session: Pick<ScheduledSession, "id" | "client_user_id" | "recurring_session_id" | "session_date">,
): Promise<{ advanced: boolean }> {
  if (!session.recurring_session_id) return { advanced: false }
  const slot = await getRecurringSessionById(session.recurring_session_id)
  if (!slot?.assignment_id) return { advanced: false }
  const assignment = await getAssignmentById(slot.assignment_id)
  if (!assignment || assignment.status !== "active") return { advanced: false }
  // A reassigned occurrence must not advance the ORIGINAL client's program.
  if (assignment.user_id !== session.client_user_id) return { advanced: false }
  if (await hasCompletedOnDate(assignment.user_id, assignment.id, session.session_date)) return { advanced: false }

  const { workoutSessionId, programCompleted } = await advanceProgramForCheckin({
    assignment,
    sessionDate: session.session_date,
  })
  if (workoutSessionId) await updateScheduledSession(session.id, { workout_session_id: workoutSessionId })
  if (programCompleted) await notifyProgramCompleted(assignment.user_id, assignment.program_id)
  return { advanced: workoutSessionId != null }
}
```

(Imports added: `getRecurringSessionById` from `@/lib/db/recurring-sessions`, `updateScheduledSession` from `@/lib/db/scheduled-sessions`, `hasCompletedOnDate` from `@/lib/db/workout-sessions`; `ScheduledSession` type. No import of session-schedule → no cycle.)

- [ ] Green → commit `feat(hybrid): attendance advances the slot-linked program (day-guarded)`.

### Task 4: markAttended wiring

**Files:**
- Modify: `lib/services/session-schedule.ts` (markAttended)
- Test: extend `__tests__/lib/services/session-schedule.orchestration.test.ts`; add mock to `__tests__/lib/services/checkin-schedule-bridge.test.ts`

**Interfaces:**
- Consumes: `handleAttendanceProgramAdvance` (Task 3). `markAttended` signature unchanged.

- [ ] Failing test: markAttended calls `handleAttendanceProgramAdvance` with the updated row; a thrown advance is swallowed (markAttended still resolves).
- [ ] Implementation:

```ts
export async function markAttended(id: string, opts: { by: string | null; checkinId?: string | null }) {
  const updated = await updateScheduledSession(id, {
    status: "attended",
    attended_at: new Date().toISOString(),
    checkin_id: opts.checkinId ?? null,
  })
  // Hybrid link: advance the slot's linked program (fully guarded + swallowed —
  // progression must never fail attendance).
  try {
    await handleAttendanceProgramAdvance(updated)
  } catch (err) {
    console.error("[markAttended] program advance failed:", err)
  }
  return updated
}
```

- [ ] Add `vi.mock("@/lib/services/program-progression", () => ({ handleAttendanceProgramAdvance: vi.fn(async () => ({ advanced: false })) }))` to BOTH pre-existing session-schedule test files (recurring lesson).
- [ ] Green (all session-schedule tests) → commit `feat(hybrid): markAttended advances the linked program`.

### Task 5: bridge the three self check-in routes

**Files:**
- Modify: `app/api/checkin/route.ts`, `app/api/checkin/self/route.ts`, `app/api/checkin/personal/route.ts`
- Test: extend the existing route tests under `__tests__/api/checkin/` (mock `@/lib/services/session-schedule` like `coach-checkin.test.ts`)

**Interfaces:**
- Consumes: `bridgeCheckinToSchedule(clientUserId, checkinId | null, now)` — already flag-gated + swallowed.

- [ ] Failing tests: each route, on a successful check-in, calls `bridgeCheckinToSchedule(clientUserId, checkin.id, expect.any(Date))`; NOT called on failure (`no_credits`).
- [ ] In each route, directly after a successful `checkInClient` result (mirror the coach route):

```ts
void bridgeCheckinToSchedule(clientUserId, result.checkin?.id ?? null, new Date())
```

- [ ] Green → commit `fix(checkin): self check-ins mark the day's scheduled session attended (no-show/fee gap)`.

### Task 6: slot PATCH accepts assignmentId (ownership-validated)

**Files:**
- Modify: `app/api/admin/sessions/[id]/route.ts`
- Test: extend the slot route test (`__tests__/api/admin/sessions/` — find the existing file; create `slot-link.test.ts` if none covers PATCH)

**Interfaces:**
- Consumes: `getAssignmentById` (`@/lib/db/assignments`), `getRecurringSessionById`.
- Produces: PATCH body may include `assignmentId: string | null`; 400 `{ error: "Assignment does not belong to this client" }` on mismatch.

- [ ] Failing tests: PATCH `{assignmentId: uuid}` where assignment.user_id === slot.client_user_id → 200, `updateRecurringSession` called with `{ assignment_id: uuid }`; mismatched owner → 400 and no update; `{assignmentId: null}` → unlink (update with null); missing assignment → 400.
- [ ] Implementation (inside PATCH, after parse):

```ts
if (p.assignmentId !== undefined) {
  if (p.assignmentId === null) {
    patch.assignment_id = null
  } else {
    const [slotRow, assignment] = await Promise.all([getRecurringSessionById(id), getAssignmentById(p.assignmentId)])
    if (!slotRow || !assignment || assignment.user_id !== slotRow.client_user_id) {
      return NextResponse.json({ error: "Assignment does not belong to this client" }, { status: 400 })
    }
    patch.assignment_id = p.assignmentId
  }
}
```

- [ ] Green → commit `feat(hybrid): slot PATCH links/unlinks a program assignment`.

### Task 7: StandingSlotsPanel link select + page threading

**Files:**
- Modify: `components/admin/schedule/StandingSlotsPanel.tsx`, `components/admin/clients/ClientSessionsPanel.tsx`, `app/(admin)/admin/clients/[id]/page.tsx`
- Test: `__tests__/components/admin/schedule/StandingSlotsPanel.link.test.tsx`

**Interfaces:**
- Produces: `StandingSlotsPanel` new optional prop `assignments?: { id: string; label: string }[]`; `ClientSessionsPanel` threads the same prop.

- [ ] Failing test: renders a per-slot select (accessible name `/advances program/i`) with "None" + assignment labels; changing it PATCHes `/api/admin/sessions/<slotId>` with `{assignmentId}` (and null for None); when `assignments` is empty/undefined no select renders.
- [ ] Panel: each slot `<li>` gains (when `assignments?.length`):

```tsx
<select
  aria-label="Advances program"
  value={s.assignment_id ?? ""}
  onChange={(e) => link(s.id, e.target.value || null)}
  className="h-8 rounded-md border border-border bg-white px-2 text-xs"
>
  <option value="">None</option>
  {s.assignment_id && !assignments.some((a) => a.id === s.assignment_id) && (
    <option value={s.assignment_id}>Linked program</option>
  )}
  {assignments.map((a) => (
    <option key={a.id} value={a.id}>{a.label}</option>
  ))}
</select>
```

with `link()` PATCHing `{ assignmentId }`, optimistic `setSlots`, `toast.error` on failure, `router.refresh()` on success.
- [ ] Page: `const activeAssignments = (assignments as AssignmentWithProgram[]).filter(a => a.status === "active").map(a => ({ id: a.id, label: a.programs?.name ?? "Program" }))` → pass to `ClientSessionsPanel` → `StandingSlotsPanel`.
- [ ] Green → commit `feat(hybrid): link a standing slot to a program from the client page`.

### Task 8: Ship

- [ ] Apply migration 00180 via `mcp__supabase__apply_migration` (additive, inert).
- [ ] Full `vitest run` → only documented baseline reds; `tsc` zero errors in touched files; `next build` green.
- [ ] Push to main (pre-authorized). Update JOURNAL.md + memory (`recurring_sessions_and_billing` hybrid deferral closed).
