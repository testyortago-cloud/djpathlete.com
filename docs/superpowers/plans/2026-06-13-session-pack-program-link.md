# Session Packs ↔ Programs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Linking a program when selling a pack, so an in-person check-in completes the next incomplete workout day of that program (and Undo reopens it).

**Architecture:** Additive to the live Session Packs feature. Migration `00171` adds two nullable FKs. A pure program-progression core ("next incomplete day" + "recompute week from truth") is orchestrated from the existing `checkInClient`/`voidCheckinAndRestore`. Selling with a program resolves-or-creates a complimentary assignment via `assignProgram`.

**Spec:** docs/superpowers/specs/2026-06-13-session-pack-program-link-design.md

---

## Task 1: Migration + type/DAL field flow

**Files:** Create `supabase/migrations/00171_session_pack_program_link.sql`; modify `types/database.ts`, `lib/db/client-packages.ts`, `lib/db/session-checkins.ts`, `lib/services/session-credits.ts` (buildPackageInsert).

- [ ] Migration:
```sql
-- 00171_session_pack_program_link.sql — tie a pack to a program; a checkin to a workout day.
alter table public.client_packages
  add column if not exists assignment_id uuid references public.program_assignments(id) on delete set null;
alter table public.session_checkins
  add column if not exists workout_session_id uuid references public.workout_sessions(id) on delete set null;
create index if not exists idx_client_packages_assignment on public.client_packages(assignment_id);
```
- [ ] `types/database.ts`: add `assignment_id: string | null` to `ClientPackage`; `workout_session_id: string | null` to `SessionCheckin`.
- [ ] `buildPackageInsert` (session-credits.ts): accept optional `assignmentId` and set `assignment_id` on the returned row (default null).
- [ ] `createCheckin` callers already spread a full row — add `workout_session_id: null` default in `checkInClient`'s insert.
- [ ] `npx tsc --noEmit` clean. Commit.

## Task 2: Pure program-progression core

**Files:** Create `lib/services/program-progression.ts`; test `__tests__/lib/services/program-progression.test.ts`.

```ts
export interface DaySlot { week_number: number; day_of_week: number }
export const dayKey = (s: DaySlot) => `${s.week_number}-${s.day_of_week}`

/** First slot (ordered) not in completedKeys, or null when all done. */
export function nextIncompleteSlot(slots: DaySlot[], completedKeys: Set<string>): DaySlot | null {
  for (const s of slots) if (!completedKeys.has(dayKey(s))) return s
  return null
}

/** Lowest week with an incomplete slot, or null when the program is complete. */
export function recomputeWeek(slots: DaySlot[], completedKeys: Set<string>): number | null {
  const next = nextIncompleteSlot(slots, completedKeys)
  return next ? next.week_number : null
}
```
- [ ] Tests: first gap; all complete → null; empty slots → null; recomputeWeek rolls forward and (after removing a key) back; ordering respected. TDD to green. Commit.

## Task 3: DAL extensions

**Files:** modify `lib/db/program-exercises.ts`, `lib/db/workout-sessions.ts`, `lib/db/session-checkins.ts`.

- [ ] `program-exercises.ts` → `getProgramDaySlots(programId): Promise<DaySlot[]>` — distinct `(week_number, day_of_week)` ordered by week, day (select those columns, dedupe in JS).
- [ ] `workout-sessions.ts`:
  - `listCompletedDayKeys(userId, assignmentId): Promise<string[]>` — completed sessions → `"week-day"` keys.
  - `completeForCheckin(sessionId, note): Promise<void>` — set `status='completed'`, `completed_at=now`, `notes=note` (no metric requirement).
  - `reopenForVoid(sessionId): Promise<void>` — set `status='in_progress'`, `completed_at=null`, `session_rpe=null`, `volume_load_kg=null`.
- [ ] `session-checkins.ts` → `setWorkoutSession(checkinId, workoutSessionId)` update helper.
- [ ] tsc clean. Commit.

## Task 4: Progression orchestration

**Files:** modify `lib/services/program-progression.ts`; test `__tests__/lib/services/program-progression.orchestration.test.ts` (mock DALs).

```ts
// advanceProgramForCheckin({ assignment, sessionDate, now }):
//   slots = getProgramDaySlots(assignment.program_id)
//   completed = new Set(await listCompletedDayKeys(user, assignment.id))
//   slot = nextIncompleteSlot(slots, completed); if !slot → { workoutSessionId: null, programCompleted: false }
//   ws = ensureSession(user, assignment.id, slot.week, slot.day, sessionDate)
//   completeForCheckin(ws.id, "In-person session (checked in)")
//   completed.add(dayKey(slot)); week = recomputeWeek(slots, completed)
//   if week === null → updateAssignment(status:'completed', current_week:lastWeek); programCompleted = true
//   else updateAssignment(current_week: week)
//   return { workoutSessionId: ws.id, programCompleted }
//
// revertProgramForCheckin({ workoutSessionId, assignment }):
//   reopenForVoid(workoutSessionId)
//   recompute week from truth; updateAssignment(current_week, status:'active' if was completed)
```
- [ ] Tests: completes first incomplete day + stamps ws id + sets week; final day → programCompleted true + status completed; no incomplete → null/no-op; revert reopens + reactivates. TDD to green. Commit.

## Task 5: Wire into check-in / void

**Files:** modify `lib/services/session-credits.ts`; update `__tests__/lib/services/session-credits.orchestration.test.ts`.

- [ ] In `checkInClient`, after the successful CAS + `createCheckin`: if `pkg.assignment_id`, load the assignment; if active, `try { const { workoutSessionId, programCompleted } = await advanceProgramForCheckin(...) ; if (workoutSessionId) await setWorkoutSession(checkin.id, workoutSessionId) } catch (e) { console.error } `. Return `programCompleted` in the result (optional field). Program failure never fails the check-in.
- [ ] In `voidCheckinAndRestore`: if `checkin.workout_session_id`, load the pack→assignment and `revertProgramForCheckin` before restoring the credit (best-effort try/catch).
- [ ] Fire the existing program-completion notifications (coach + client) when `programCompleted` — reuse `sendCoachProgramCompletedNotification` + `createNotification` (mirror `complete-week/route.ts`), best-effort.
- [ ] Update orchestration tests: a linked pack advances the program (mock advanceProgramForCheckin); no-program pack unchanged. TDD to green. Commit.

## Task 6: Sell with a program

**Files:** modify `app/api/admin/session-packs/checkout/route.ts`, `lib/validators/session-packs.ts`; test `__tests__/api/session-packs/checkout-program.test.ts`.

- [ ] `sellPackSchema`: add optional `programId: z.string().uuid().optional()`.
- [ ] In the route, after resolving pack shape and BEFORE creating the client_packages row: if `programId`, `await assignProgram({ programId, userId: clientUserId, startDate: today, complimentary: true, assignedBy: coachId })`; if `skipped`, fetch `getAssignmentByUserAndProgram`; capture `assignmentId`. Pass `assignmentId` into `buildPackageInsert`.
- [ ] Test: sell with `programId` → assignProgram called complimentary → pack row carries `assignment_id`. TDD to green. Commit.

## Task 7: UI — program selector + panel display

**Files:** modify `components/admin/packs/SellPackDialog.tsx`, `components/admin/packs/ClientPackagesPanel.tsx`; the panel GET already returns packages — extend the route response to include linked program name.

- [ ] SellPackDialog: optional **Program** `<Select>` ("None" + active programs fetched from a lightweight list). Include `programId` in the POST body when chosen. (Fetch programs via existing `/api/admin/programs` list or a minimal endpoint; if none exists, add `GET /api/admin/session-packs/programs` returning `{id,name}` for active programs.)
- [ ] ClientPackagesPanel: if a pack has `assignment_id`, show the linked program name + "advances on check-in" hint. (Extend `GET /api/admin/session-packs` to join program name via assignment.)
- [ ] `npm run test:run` + `npx tsc --noEmit` + `npm run build` clean. Commit.

## Task 8: Verify

- [ ] Full `npm run test:run` green (modulo the pre-existing `shop` sharp-timeout flakiness).
- [ ] `npx tsc --noEmit` no new errors; `npm run build` succeeds.
- [ ] Commit any fixes.

## Self-review

- Spec coverage: link@sell→T1/6; next-incomplete-day→T2/4; check-in advance→T5; undo revert→T4/5; complimentary→T6; no-program safe→T5; completion notify→T5; display→T7. ✅
- Types: `DaySlot`/`dayKey`/`nextIncompleteSlot`/`recomputeWeek`/`advanceProgramForCheckin`/`revertProgramForCheckin`/`assignment_id`/`workout_session_id` consistent across tasks. ✅
- No placeholders; pure core has full code; orchestration/route/UI specify exact behavior + the existing pattern to mirror. ✅
