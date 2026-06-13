# Workout Experience Improvements — Design Spec

**Date:** 2026-06-13
**Status:** Drafted autonomously (coach asleep — proceeding under standing "do what's best, proceed to the end" authorization). Awaiting coach review; defaults are documented and easily reversible.
**Author:** Claude (Opus 4.8)

## Context

Darren (the coach) reviewed the **client-facing workout-logging experience** and gave 15 pieces of feedback — a mix of bugs, UX tweaks, and new features. This spec turns that feedback into a single, cohesive update to the workout experience. Everything is grounded in the actual codebase and live schema (verified read-only via Supabase MCP on 2026-06-13).

The hub of this work is [components/client/WorkoutDay.tsx](../../../components/client/WorkoutDay.tsx) (the `ExerciseCard` set-logging UI) plus the workouts page [app/(client)/client/workouts/page.tsx](../../../app/\(client\)/client/workouts/page.tsx), the streak helper in [lib/db/progress.ts](../../../lib/db/progress.ts), and week navigation in [components/client/WorkoutTabs.tsx](../../../components/client/WorkoutTabs.tsx).

## Goals

1. Simplify effort tracking: **one session RPE**, not per-set; show **volume load = reps × weight**.
2. Remove ambiguity about **dumbbell weights** (per-hand vs total).
3. Let the coach mark exercises that must be **video-recorded** (visible 🎥 indicator).
4. Add a **Perceived Recovery Status (PRS)** check at the start of each session.
5. Fix the **"saved then gone"** bug — clients should see what they logged.
6. Fix the **reps-tap navigation** complaint.
7. Stop clients from **accidentally repeating a week** — open on their current week, clearly labelled.
8. Make **streaks count real workouts** (completed sessions), not exercise/day counts.
9. Surface **green/red "vs last time"** deltas on the workout screen.
10. Confirm/clean up small items: delete a stale tip, shrink the weight box, surface coach notes.

## Decisions (confirmed by the coach) + documented defaults

| Topic | Decision |
|---|---|
| RPE & load | One **session RPE** (drop per-set RPE column). Show **volume load** (reps × weight) per exercise + session total. |
| Weeks | App **opens on the client's current week** with a **"You're on Week X"** banner. Manual Complete-Week button stays. |
| Streak | Counts **completed sessions**, not days-with-any-exercise. |
| Dumbbells | Coach sets a **load type per exercise** (`total` / `per_dumbbell` / `per_side`); client sees a plain label; volume math respects it. |
| On-screen deltas | **Compact ↑/↓ % per exercise** vs the client's last log of that exercise. |
| PRS behaviour | **Once at session start, skippable**, saved with the session. |
| Video indicator (default) | Per-program-exercise `requires_video` flag the coach ticks → 🎥 on the client's exercise card. |
| Saved-then-gone fix (default) | On reopening a session, **reload the exact sets the client entered** (editable); also fix the UTC "today" check. |
| PRS scale (default) | Standard published **0–10 PRS scale** (Laurent et al., 2011), with the label text isolated in one constant so the coach's exact wording drops in trivially. |
| Reps-tap bug (default) | No navigation exists on the field in code — **harden defensively** (stop event propagation, ensure proper hit areas / numeric input) and document; coach's repro will confirm. |

## Architecture: the workout-session record

**Problem it solves.** Today the app only persists loose per-exercise rows in `exercise_progress`, which carry **no `week_number`/`day_of_week`** (verified). So the app literally cannot tell which program day a set belongs to — this is the root of the "saved then gone" bug and the reason PRS, one-session-RPE, volume load, and "completed session" streaks have nowhere to live.

**Solution.** Introduce a first-class **`workout_sessions`** record: one row per client per program day. The row is **created (or ensured) when the client opens that day's session** — so PRS can be captured at the start — set to `status='in_progress'`. Per-set logs attach to it. Volume load rolls up into it. It is **finalized via an explicit "Finish session" action** that captures the single session RPE and sets `status='completed'` — driving streaks and the save-fix. The Finish-session action is **auto-prompted once all prescribed exercises for the day are logged**, but stays explicit so a client who legitimately skips an exercise (injury, equipment) is never stuck with a session that can't complete.

**Bonus reconciliation.** When a session completes with a session RPE + duration, we upsert a row into the existing **`training_sessions`** table (the coach-intel/readiness subsystem, whose load = RPE×duration). That subsystem currently relies on manual self-reports; this makes its data fill in automatically. We do **not** overload `training_sessions` itself (different key, different load semantics) — we keep `workout_sessions` as the program-flow anchor and feed `training_sessions` as a downstream side effect.

### Data model changes (one migration, additive & non-destructive)

New table **`workout_sessions`**:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid not null → users(id) | client |
| `assignment_id` | uuid not null → program_assignments(id) on delete cascade | |
| `week_number` | int not null | |
| `day_of_week` | int not null | |
| `session_date` | date not null | client-local date when started |
| `prs` | int null, check 0–10 | perceived recovery at start |
| `prs_recorded_at` | timestamptz null | |
| `session_rpe` | int null, check 1–10 | at end |
| `volume_load_kg` | numeric null | Σ over sets of reps × entered-weight × load-type multiplier |
| `duration_seconds` | int null | |
| `status` | text not null default `'in_progress'`, check in (`in_progress`,`completed`) | |
| `started_at` | timestamptz not null default now() | |
| `completed_at` | timestamptz null | set when status→completed |
| `notes` | text null | |
| `created_at`/`updated_at` | timestamptz | `updated_at` trigger |
| **unique** | (`user_id`,`assignment_id`,`week_number`,`day_of_week`) | one session per program day; re-logging updates it |

RLS mirrors `training_sessions` (clients manage own rows; admins manage all).

Column additions:
- `exercise_progress.session_id uuid null` → references `workout_sessions(id)` on delete set null. New logs attach; historical rows stay null.
- `exercises.load_type text not null default 'total'`, check in (`total`,`per_dumbbell`,`per_side`).
- `program_exercises.requires_video boolean not null default false`.

Migration file: `supabase/migrations/00153_workout_sessions.sql` (00152 is the latest applied; confirm next free number at implementation). **Written but NOT applied to production while the coach is away** — applied on go-ahead, alongside deploy.

## Feature specs

### 1. Session RPE + volume load (replaces per-set RPE)
- Remove the per-set RPE `<Select>` column from the sets table in `WorkoutDay.tsx`.
- **Volume load** per exercise = `Σ_sets (reps × weightKg × loadMultiplier)`, displayed in the client's unit (e.g. "Load 2,400 lb"). A **session total** shows in the session header / banner.
- **Session RPE** is asked **once**, when the client taps **Finish session** (auto-prompted once all prescribed exercises are logged) — a single 1–10 prompt stored on `workout_sessions.session_rpe`. Finishing sets `status='completed'`, `completed_at`, and `duration_seconds`.
- Pure helper `computeVolumeLoad(setDetails, loadType)` in a new `lib/workout/volume-load.ts`, unit-tested. The AI weight-recommendation logic that previously consumed per-set RPE now reads `session_rpe` of the prior session (last set's entered weight still drives weight suggestions); behaviour preserved as closely as possible.

### 2/13. Dumbbell load-type clarity
- `loadType` mapping → `{ multiplier, clientLabel }`: `total → (×1, no label)`, `per_dumbbell → (×2, "per dumbbell — enter one")`, `per_side → (×2, "per side")`. Helper in `lib/workout/load-type.ts`, unit-tested.
- Client weight cell shows the label inline; coach sets `load_type` in the exercise editor (admin). `weight_kg` continues to store the **entered** value (keeps last-time comparisons consistent); only volume load applies the multiplier.

### 3/11. Video-record indicator
- `program_exercises.requires_video` toggle in the admin program builder.
- Client `ExerciseCard` header shows a 🎥 badge + short "Record this one" hint when true. Also surfaced in the day summary so clients can see at a glance which exercises need recording.

### 4. PRS at session start
- On entering a session (first exercise opened / session screen mount) with no `prs` yet, show a **skippable** PRS prompt (0–10 standard scale). Store `prs` + `prs_recorded_at` on the session.
- Scale text isolated in `lib/workout/prs-scale.ts` (single constant) for instant swap to the coach's wording.

### 5. Reps-tap → coach (bug, defensive)
- Confirmed: the reps `<input>` has no link/router/onClick navigation; nearest interactive element is the separate "Coach DJP" button.
- Hardening: add `onClick`/`onFocus` `stopPropagation` on set inputs; ensure inputs use `inputMode="numeric"`; verify the Coach DJP button has adequate spacing/hit-area away from the sets table so a fat-finger tap can't hit it. Documented as defensive pending the coach's repro.

### 6. Delete "Start light, find your working weight"
- Remove the string (2 occurrences) in [lib/weight-recommendation.ts](../../../lib/weight-recommendation.ts); fall back to no reasoning line when there's no history.

### 7. On-screen green/red deltas
- Compact ↑/↓ % chip next to each exercise comparing this session's top set / volume to the client's **last logged** session of that exercise. Reuses existing `progressByExercise` history already fetched on the page (no extra query). Green for improvement, red for regression, neutral when no history.

### 8. "Saved then gone" (bug)
- Rehydrate: when a session exists for the current week/day, initialise each `ExerciseCard`'s `setRows` from that exercise's saved `set_details` so the client sees exactly what they entered (editable; re-saving updates the session's logs).
- Replace the UTC `wasLoggedToday` date comparison with **session-based** logged state (an exercise is "logged" if it has a row in the current session) — removes timezone fragility entirely.
- Fallback when no session row exists yet (historical data): seed from the latest log for that exercise so something always shows.

### 9/10. Week navigation
- The page already computes `currentWeek`; ensure `WorkoutTabs` **defaults the selected week to `currentWeek`** and renders a prominent **"You're on Week X of Y"** banner with subtle styling that de-emphasises (but still allows) browsing other weeks.
- Keep the manual Complete-Week button. No auto-advance (per decision), but opening on the right week + the banner addresses the repeat-Week-1 problem.

### 12. Smaller weight box
- Constrain the weight `<input>` width in the sets table (e.g. fixed `w-16`/`w-20`) instead of `w-full`.

### 14. Streak = completed sessions
- Rewrite `getWorkoutStreak` to count **consecutive calendar days on which the client completed a `workout_session`** (status='completed'), instead of days with any logged exercise. Raises the bar from "logged one exercise" to "finished a workout," matching the coach's intent.
- **Documented default / open for review:** "consecutive days with a completed session." Alternative ("total completed sessions") noted for the coach to choose at review.

### 15. Instructions visibility
- Confirmed present in data (100% exercise instructions, 92% coach notes). Surface the coach `notes` more prominently — render them **outside** the collapsed dropdown (e.g. an always-visible amber cue line on the card) so clients actually read them; keep the fuller instructions in the expandable section.

## Testing strategy
- **Unit (Vitest):** `computeVolumeLoad`, load-type mapping, PRS storage shaping, session-complete detection, streak-from-sessions, week-current selection, delta computation. Pure functions, no DB.
- **DAL:** thin wrappers for `workout_sessions` mirror existing `training-sessions.ts` patterns; covered by integration-style tests where existing patterns exist, otherwise type-checked + reviewed.
- **Build/lint/typecheck:** `npm run lint`, `tsc`, `npm run build`, `npm run test:run` all green before commit.
- **E2E (Playwright) of brand-new flows** requires the migration applied to a DB — **deferred** to the coach's go-ahead (migration apply + manual click-through). The existing suite runs to confirm no regressions.

## Sequencing (implementation phases)
0. **Session record** — migration file + `lib/db/workout-sessions.ts` DAL + validators + an `ensure-session` path (create-on-open for PRS) and wiring the log API to attach each set to the day's session. (Foundation.)
1. **Logging-screen changes** — remove per-set RPE, volume load display, dumbbell label, smaller weight box, delete stale tip, on-screen deltas, surface notes.
2. **Save-fix** — session-based rehydration + timezone fix.
3. **Session lifecycle** — PRS at start, session RPE at end, auto-complete detection, `training_sessions` downstream feed.
4. **Streak + week banner.**
5. **Video star + admin toggles + load-type editor.**
6. **Reps-tap hardening.**

## Out of scope / explicitly deferred
- Applying the migration to production (held for coach go-ahead).
- Any deploy / push / outward-facing action.
- Playwright e2e of the new flows (needs schema applied).
- Per-program-exercise override of `load_type` (kept on `exercises` only for now; can add later).
- Auto-advance of weeks (coach chose manual + banner).

## Open items needing the coach
1. **PRS scale wording** — building against the standard 0–10 scale until provided; swap is a one-line constant change.
2. **Reps-tap repro** — phone/desktop + whether it fires on the number field (or "harden blind" — already done defensively).
3. **Streak definition** — confirm "consecutive days with a completed session" vs "total completed sessions."
