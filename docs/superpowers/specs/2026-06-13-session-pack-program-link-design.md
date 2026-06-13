# Session Packs ↔ Programs — Check-in Advances the Program

**Date:** 2026-06-13
**Status:** Design (autonomous — user answered Q1 then slept; Q2/Q3/edge calls made with strong defaults, documented below for review)
**Builds on:** [2026-06-13-session-packs-design.md](2026-06-13-session-packs-design.md) (Phase 1, live in prod, flags off)

## Problem

A **session pack** tracks prepaid in-person sessions (credits + attendance). A **program**
is the training content (weeks × days of exercises) the client follows. Today they're
unconnected. Darren wants: when he checks an in-person client in, it should also **advance
that client's program** — so attendance and training progress stay in sync instead of being
tracked twice.

## Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Which program does a check-in advance? | **Link a program when selling the pack** (user-chosen). The pack stores the assignment; every check-in advances that program. |
| 2 | What unit does one check-in advance? | **The next incomplete workout DAY** of the program (rolling into the next week when a week's days are all complete). One in-person session = one program day. |
| 3 | How much is logged at check-in? | **Completion only** — mark the day `completed` (attendance = done), metrics left null, noted as an in-person session. Keeps it one-tap; the coach can still log detail in the program later. |
| 4 | Reversibility | The completed `workout_session` id is stored on the check-in. **Undo** reopens that day (and recomputes week position) as well as restoring the credit. |
| 5 | Linked-program payment | The pack **is** the payment, so the linked assignment is created **complimentary** (`payment_status = not_required`) — no separate program charge, and the payment guard never blocks it. |
| 6 | No-program packs | Unchanged: a pack with no linked program just deducts a credit on check-in (drop-ins, standalone packs keep working). |

### Why "next incomplete day" (Q2)

Programs are stored as `program_exercises` rows keyed by `(week_number, day_of_week)`; the
client app completes one day at a time into `workout_sessions`, and `advanceWeek()` rolls
`current_week` when a week is done. Mapping a check-in to **one day** reuses that exact
machinery (same `workout_sessions` rows, same streak feed, same completion notifications),
so in-person and online progress are identical data. Mapping to a whole *week* would
over-advance multi-day weeks; picking the day manually each time breaks "one-tap."

## Scope

**In:** link a program when selling a pack (resolve-or-create a complimentary assignment);
on check-in, complete the next incomplete program day for the linked assignment; on void,
reopen that day; show the linked program (+ progress) on the Packages panel; fire the
existing program-completion notifications when the last day is checked in.

**Out (YAGNI):** logging per-exercise sets/weights at check-in (use the existing program UI);
choosing a non-sequential day; auto-creating program *content*; calendar (still Phase 2 of
the base feature).

## Architecture

Additive to the live Session Packs feature. New migration **`00171`** adds two nullable FKs;
no existing column changes. A small **program-progression service** holds the
"next incomplete day / recompute week" logic (pure core + thin DB orchestration), called
from the existing `checkInClient` / `voidCheckinAndRestore` paths.

```
supabase/migrations/00171_session_pack_program_link.sql
  - client_packages.assignment_id   uuid null → program_assignments(id) on delete set null
  - session_checkins.workout_session_id uuid null → workout_sessions(id) on delete set null

lib/db/
  program-exercises.ts   (EXTEND) getProgramDaySlots(programId) → ordered [{week_number, day_of_week}]
  workout-sessions.ts    (EXTEND) completeForCheckin(sessionId, note) / reopenForVoid(sessionId)
                                   + listCompletedDayKeys(userId, assignmentId)
  client-packages.ts     (EXTEND) assignment_id flows through createClientPackage/types
  session-checkins.ts    (EXTEND) workout_session_id on create; setWorkoutSession(id, wsId)

lib/services/
  program-progression.ts (NEW)  pure: nextIncompleteSlot(slots, completedKeys) + recomputeWeek;
                                 orchestration: advanceProgramForCheckin(assignmentId, sessionDate),
                                 revertProgramForCheckin(workoutSessionId)
  session-credits.ts     (EXTEND) checkInClient → after credit reserved, if pack.assignment_id,
                                 advanceProgramForCheckin and stamp workout_session_id on the checkin;
                                 voidCheckinAndRestore → revertProgramForCheckin

app/api/admin/session-packs/checkout/route.ts (EXTEND) accept programId; resolve-or-create a
                                 complimentary assignment via assignProgram; store assignment_id
components/admin/packs/SellPackDialog.tsx (EXTEND) optional "Program" selector
components/admin/packs/ClientPackagesPanel.tsx (EXTEND) show linked program + progress
```

## Core mechanic

### Next incomplete day (pure)
1. `slots` = distinct `(week_number, day_of_week)` for the program, ordered by week then day.
2. `completedKeys` = set of `"week-day"` for the assignment's `completed` workout_sessions.
3. `nextIncompleteSlot` = first slot whose key ∉ completedKeys (or `null` if all done).
4. `recomputeWeek` = the lowest `week_number` among still-incomplete slots, or "complete".

This is **recompute-from-truth** — week position is always derived from completed sessions,
so advancing and reverting can never drift.

### On check-in (when `pack.assignment_id` is set and the assignment is active)
- Compute `nextIncompleteSlot`.
  - If found: `ensureSession` then `completeForCheckin` (status `completed`, `completed_at = now`,
    metrics null, `notes = "In-person session (checked in)"`); stamp `workout_session_id` on the
    check-in. Recompute `current_week`; if no incomplete slots remain, set the assignment
    `completed` and fire the existing coach + client completion notifications.
  - If none (program already finished): no-op — the credit still deducts (attendance only).
- The credit deduction itself is unchanged (atomic CAS from Phase 1). Program advance runs
  **after** a successful credit reservation, wrapped so a program-side failure logs but does
  not fail the check-in (attendance is the primary record; the coach can re-sync).

### On void
- If the check-in has `workout_session_id`: `reopenForVoid` (status `in_progress`,
  `completed_at` null, metrics null); recompute `current_week`; if the assignment had been
  `completed`, set it back to `active`. Then restore the credit (Phase 1 behavior).

### Selling with a program
`checkout` route accepts an optional `programId`. If present: call `assignProgram({ programId,
userId, startDate: today, complimentary: true })` (the single canonical assignment path);
if it skips (active assignment already exists), fetch that assignment. Store its id as
`client_packages.assignment_id`. Cash/comp and Stripe paths both carry the link.

## Error handling & edge cases

| Case | Handling |
|------|----------|
| Pack has no linked program | Check-in deducts credit only (today's behavior). |
| Program already complete | Check-in deducts credit; no day to advance; no error. |
| Program has empty/missing weeks (no slots) | No slot to complete → credit only. |
| Program advance throws (bad data) | Logged; check-in still succeeds (credit + attendance). Decouples money/attendance from program sync. |
| Void a check-in that completed the final day | Reopens the day **and** flips the assignment `completed → active`. |
| Multiple packs for one client | Each pack carries its own `assignment_id`; check-in deducts from the oldest active pack and advances *that* pack's linked program (documented; coach should keep one in-person program per client). |
| Assignment cancelled/deleted after linking | FK `on delete set null`; check-in falls back to credit-only. |
| Payment guard | Bypassed for in-person completion (coach-driven, complimentary assignment). |

## Testing

- **Unit (pure):** `nextIncompleteSlot` (first gap, all-complete→null, empty slots), `recomputeWeek`
  (rolls forward/back, complete state), day-key helpers.
- **Integration (mocked DAL):** check-in with linked assignment completes the right day + stamps
  `workout_session_id` + recomputes week; final-day check-in marks program complete; void reopens
  the day + reactivates; no-program pack unchanged; program-advance failure doesn't fail check-in.
- **Route:** sell with `programId` creates/links a complimentary assignment and stores
  `assignment_id`.

## Go-live ordering (critical)

The base Session Packs feature is **already live in prod** (schema applied, flags off). The new
check-in/sell code reads `client_packages.assignment_id` / `session_checkins.workout_session_id`,
which don't exist in prod until `00171` is applied. **Therefore: apply `00171` to prod BEFORE
pushing this code.** (Same "migrate before the reader deploys" lesson from the journal.) This
work is committed locally on `main`, **not pushed**, migration **not applied**, until Darren
gives the go-ahead.
