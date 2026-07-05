# Hybrid / online-client linking — design

**Date:** 2026-07-05 · **Status:** approved (autonomous build authorized: "do the backlog")

## Problem

The last unbuilt item from Darren's list: tie **in-person attendance** to a client's **online program**. Today only one narrow path does this: a coach check-in against a **pack** whose `client_packages.assignment_id` is set advances the linked program (`handleCheckinProgramAdvance`). Everything else is disconnected:

1. Marking a session **Attended** on `/admin/schedule` (agenda or the new calendar) never advances any program — but for hybrid clients the in-person session IS their program workout.
2. **Latent money-path gap (found during exploration):** only the coach one-tap check-in route calls `bridgeCheckinToSchedule`. The three self check-in routes (`/api/checkin`, `/api/checkin/self`, `/api/checkin/personal`) never mark the day's `scheduled_sessions` row attended — so a 5:45am regular who self checks in is later flagged **no-show** by the hourly cron and would be **fee-charged** once fee amounts are configured.

## Approaches considered

- **A (chosen) — explicit link on the standing slot.** `recurring_sessions.assignment_id` (nullable). Marking an occurrence Attended advances that assignment by one program day, guarded by a per-(assignment, date) idempotency check. Mirrors the proven pack pattern (explicit, coach-controlled, inert until linked, no flag).
- **B — auto-advance the client's single active assignment on any attendance.** Rejected: no coach control; surprises clients with a separate online-only program (e.g. in-person strength + online mobility); large blast radius with zero configuration signal.
- **C — per-occurrence link on `scheduled_sessions`.** Rejected: linking is a standing behavior ("this M/W/F slot works through their program"), not a per-occurrence decision; per-occurrence ceremony would never be used.

## Design

### Data (migration 00180, additive)

- `recurring_sessions.assignment_id uuid null references program_assignments(id) on delete set null` + partial index.
- `scheduled_sessions.workout_session_id uuid null references workout_sessions(id) on delete set null` — records which program day an attendance completed (traceability now, revert hook later).

### Advancement service

`handleAttendanceProgramAdvance(session)` in `lib/services/program-progression.ts` (beside its check-in twin):

1. No `recurring_session_id` (ad-hoc session) → no-op.
2. Slot has no `assignment_id` → no-op (the inert default).
3. Assignment missing, not `active`, or `assignment.user_id !== session.client_user_id` (occurrence was **reassigned** to another client — must not advance the original client's program) → no-op.
4. **Day guard:** any completed `workout_session` already exists for (user, assignment, `session_date`) → no-op. New DAL fn `hasCompletedOnDate` in `lib/db/workout-sessions.ts`. This single guard kills every double-advance path: pack check-in + bridge on the same day, re-marking Attended, client already logged today's workout online (attendance then must not burn a second program day), and twice-daily slots on one assignment.
5. Otherwise `advanceProgramForCheckin({assignment, sessionDate})` (existing: completes next incomplete day, recomputes week, fires completion notifications via the same `notifyProgramCompleted`), then stamp `workout_sessions.id` onto `scheduled_sessions.workout_session_id`.

`markAttended` in `lib/services/session-schedule.ts` calls it awaited in try/catch (the `cancelSession`/fee pattern): a progression failure must never fail attendance. Every existing test of modules that gain this import gets the new import mocked (recurring lesson).

### Check-in bridge completeness (the gap fix)

The three self check-in routes call `void bridgeCheckinToSchedule(clientUserId, checkin.id, new Date())` on success, exactly like the coach route. The bridge is already flag-gated and fully swallowed. Ordering note: `checkInClient` awaits the pack advance before returning, and the bridge runs after — so when a pack and a slot link to the same assignment, the day guard sees the pack's completed workout session and skips (no double-advance).

### API + UI

- `recurringSlotUpdateSchema` gains `assignmentId: uuid | null` (optional). The slot PATCH route validates server-side that the assignment belongs to the slot's client (mirror the billing-payer non-client rejection), then persists; audited via the existing `session.slot_updated`.
- `StandingSlotsPanel` gains a per-slot "Advances program" select (None + the client's active assignments, labeled by program name), PATCHing the slot. The admin client page passes the client's active assignments down (it already loads them for ProgramsSection). A linked slot shows the program name inline.

### Non-goals (documented)

- No revert on a mis-tapped Attended (the UI offers no un-attend; fix via the client's workout log; `workout_session_id` stamp keeps the future hook). No links on ad-hoc sessions. No flag (inert-until-configured, like billing payer). No client-side UI change (the completed day simply appears in their program, note "In-person session (checked in)").

### Testing

TDD per unit: day-guard DAL fn; `handleAttendanceProgramAdvance` no-op ladder + advance + stamp; `markAttended` calls it swallowed; slot PATCH validates ownership; the three self check-in routes call the bridge; panel renders/updates the link select. Existing session-schedule orchestration tests gain a mock for the new progression import.
