# In-Program Form Review Video Upload — Design

**Date:** 2026-06-14
**Status:** Approved (design); ready for implementation plan
**Author:** Claude (brainstormed with Darren)

## Problem

A coach can flag a program exercise with **"Client must record a video of this exercise"** (`program_exercises.requires_video`, set in the Add/Edit Exercise dialogs in the program builder). On the client side this currently renders **only a 🎥 "Record" badge** next to the exercise name in their workout ([components/client/WorkoutDay.tsx](../../../components/client/WorkoutDay.tsx) ~L474). It is a visual nudge with **no action attached**.

To actually submit a video, the client must leave the workout and go to the standalone **Form Reviews** flow (`/client/form-reviews/new`), pick a file, and type a free-text title. Migration `00043_remove_exercise_from_form_reviews.sql` deliberately stripped `exercise_id` + `assignment_id` from `form_reviews`, so a submitted video has **no structured link** back to the program/exercise/week — context lives only in the title the client types.

**Goal:** Let the client upload a recording **directly from the flagged exercise inside their workout**, and have it land in the **admin Form Reviews** inbox tagged with **Program · Exercise · Week · Client · Date** — with a submission status shown to both the client and the coach.

## Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| Enforcement | Required vs. nudge | **Optional nudge** — never blocks finishing the workout |
| Status | Per-exercise status both sides vs. fire-and-forget | **Show status both sides** (Submitted → In review → Reviewed) |
| Re-records | One vs. many per exercise | **Allow multiple** (each upload = new row; card shows latest) |
| Title | Auto vs. client types | **Auto-generated** `{Exercise} — {Program}, Week N`; optional one-line note only |
| Standalone page | Keep vs. fold in | **Keep** `/client/form-reviews/new` as an additional ad-hoc entry point |
| Capture | In-app camera vs. upload | **Upload** (file picker; on mobile this still lets them record) |
| Data model | Structured columns vs. JSONB | **Nullable FK columns + denormalized snapshot names** |

## Confirmed facts (verified against live DB + code, 2026-06-14)

- `form_reviews` columns today: `id, client_user_id, video_path, thumbnail_url, title, notes, status, created_at, updated_at`.
- `form_reviews.status` lifecycle: **`pending` → `in_progress` → `reviewed`** (DAL inserts `pending`; first admin message flips to `in_progress`; coach marks `reviewed`).
- Assignment table is **`program_assignments`** (PK `id`; has `program_id`, `user_id`, `current_week`, `total_weeks`).
- `program_exercises.requires_video` exists in prod (migration `00168`, applied).
- Next migration number is **`00172`** (highest existing is `00171`).
- Firebase upload path today: `form-reviews/{userId}/{timestamp}.{ext}`; `storage.rules` already allows `video/*` up to the configured cap; admin playback via `getSignedVideoUrl()` (1h TTL) in [lib/firebase-admin.ts](../../../lib/firebase-admin.ts).
- The create path `POST /api/client/form-reviews` already: records audit (`form_review.submitted`, category `support`), notifies all admins (`createNotification`), and emails the coach (`sendFormReviewRequestEmail`). **No new endpoint, notify, email, or storage rule is needed.**

## Architecture

Re-introduce the program/exercise link to `form_reviews` as **nullable** columns so nothing existing breaks, plus **denormalized snapshot text** (`program_name`, `exercise_name`) captured at submission so the admin tag stays accurate even if the program is edited later. The in-workout upload is a new client entry point that reuses the existing storage upload, create route, admin inbox, and feedback thread.

### A. Data model — migration `00172_form_review_program_link.sql`

Add to `form_reviews`, **all nullable**:

| Column | Type | Notes |
|--------|------|-------|
| `program_id` | `uuid` | `REFERENCES programs(id) ON DELETE SET NULL` |
| `assignment_id` | `uuid` | `REFERENCES program_assignments(id) ON DELETE SET NULL` |
| `program_exercise_id` | `uuid` | `REFERENCES program_exercises(id) ON DELETE SET NULL` — status read-back key |
| `exercise_id` | `uuid` | `REFERENCES exercises(id) ON DELETE SET NULL` — actual exercise (swap-aware) |
| `week_number` | `int` | week tag |
| `program_name` | `text` | snapshot at submission |
| `exercise_name` | `text` | snapshot at submission |

- Index: `create index on form_reviews (assignment_id, program_exercise_id);` for the card status lookup.
- `program_id IS NOT NULL` distinguishes in-workout uploads from standalone ones.
- This is a deliberate, **nullable** partial reversal of `00043`; the title-only model still works for the standalone page and historical rows.

### B. Client — upload from inside the workout

In [components/client/WorkoutDay.tsx](../../../components/client/WorkoutDay.tsx) `ExerciseCard`:

- When `pe.requires_video === true`, render a **🎥 Upload recording** button in the existing quick-action row (alongside "Watch video" / "Swap", ~L545–570). Add `uploadDialogOpen` to the existing state block (~L213–223).
- Tapping opens an upload dialog that **reuses the existing Firebase upload + client-side validation** (250 MB / 5 min / `mp4·mov·webm·avi`, resumable upload with progress bar). Extract that logic out of [components/client/FormReviewUploadForm.tsx](../../../components/client/FormReviewUploadForm.tsx) into a **shared hook** (e.g. `hooks/use-form-review-upload.ts`) so both the standalone page and the in-workout dialog share one implementation.
- **Title auto-generated** server-side or client-side: `{exercise_name} — {program_name}, Week {week_number}`. Client sees no title field — only an optional one-line note (stored in `notes`).
- All context is already in scope in `ExerciseCard` / its parents: `assignmentId`, program name + current week (from `tabPrograms`), `pe.id` (→ `program_exercise_id`), `pe.week_number`, `exercise.id` + `exercise.name`.
- **Swap-aware:** if the client swapped the exercise, set `exercise_id` = swapped exercise's id and `exercise_name` = swapped name, but keep `program_exercise_id` + `assignment_id` anchored to the original slot.
- The client does **not** send `userId`; the server route resolves it from `auth()`, and the storage path is built client-side from the session user id as today.

### C. Status loop (both sides)

**Read-back (client):** [app/(client)/client/workouts/page.tsx](../../../app/%28client%29/client/workouts/page.tsx) server-loads the latest `form_review` per `program_exercise_id` for the active assignments (new DAL `getFormReviewStatusByAssignments(assignmentIds)` → `Map<program_exercise_id, { id, status }>`, latest by `created_at`), parallel to the existing `getWeekAccessByAssignments` call. Thread the per-exercise submission into `buildExerciseData` and pass it through the existing chain: **page → `WorkoutViewToggle` → workout tabs → `WorkoutDay` → `ExerciseCard`**.

**Card display:**

| Latest row state | Client card |
|------------------|-------------|
| none | **🎥 Upload recording** (button) |
| `pending` | **Submitted ✓ — awaiting review** |
| `in_progress` | **In review** |
| `reviewed` | **Reviewed ✓ — view feedback** → links to `/client/form-reviews/{id}` thread |

Add a pure helper `formReviewCardState(row | null)` (e.g. in `lib/workout/`) with unit tests. Multiple uploads allowed — card always reflects the latest.

**Coach side:** already lifecycle-aware in the Form Reviews inbox; no change beyond the new tags (section E).

### D. Optional nudge at finish

When the client finishes the session, if any `requires_video` exercise in the current day has no submission, show a **dismissible** reminder ("N exercises still need a recording — finish anyway?"). It never blocks completion. (Hook into the existing finish-session UI in the workout flow.)

### E. Admin — render the 5 tags

- [lib/db/form-reviews.ts](../../../lib/db/form-reviews.ts): extend the selects in `getAllFormReviews()` and `getFormReviewById()` to include the new columns. Client name + `created_at` already flow through.
- [components/admin/FormReviewList.tsx](../../../components/admin/FormReviewList.tsx): add `program_name`, `exercise_name`, `week_number` to the `ReviewItem` interface; render a compact metadata line under the title — **Program • Exercise • Wk N**. Extend the search filter to match program/exercise names.
- [components/admin/FormReviewDetail.tsx](../../../components/admin/FormReviewDetail.tsx): add the fields to the review interface; render a metadata block at the top — **Program · Exercise · Week N · Client · Date** — before the client notes/video.
- [types/database.ts](../../../types/database.ts): add the new fields to the `FormReview` interface.

### F. Client API

[app/api/client/form-reviews/route.ts](../../../app/api/client/form-reviews/route.ts):

- Extend `createSchema` with optional fields: `program_id`, `assignment_id`, `program_exercise_id`, `exercise_id`, `week_number`, `program_name`, `exercise_name`. `title` becomes optional **when** program context is supplied (server derives it); the standalone page still requires its title.
- Pass the new fields into the `createFormReview()` call.
- Optionally enrich the audit metadata with `{ program_id, exercise_id, week_number }`.
- Audit / notify / email path unchanged.
- `createFormReview()` in the DAL accepts + inserts the new optional fields.

## Components / units (with boundaries)

- **`hooks/use-form-review-upload.ts`** (new) — encapsulates file validation + Firebase resumable upload + progress. Inputs: file, userId. Output: `{ videoPath, progress, uploading, error }`. Consumed by both the standalone form and the in-workout dialog.
- **`ExerciseVideoUpload` dialog** (new, in/near `WorkoutDay.tsx`) — given exercise/program/assignment context, runs the hook + POSTs the create. Self-contained; depends only on the hook + the create route.
- **`formReviewCardState(row)`** (new, `lib/workout/`) — pure mapping from a form-review row to the card display state. Independently testable.
- **`getFormReviewStatusByAssignments(ids)`** (new DAL) — returns latest status per `program_exercise_id`.

## Error handling

- Upload failures surface the existing toast + `FormErrorBanner` pattern; the resumable upload reports progress and a clear retry message on network failure (mirror `FormReviewUploadForm`).
- The status read-back is wrapped in try/catch like the other workout-page loaders (DB-missing → render gracefully without status chips).
- Validation errors from the create route reuse `summarizeApiError`.

## Testing

- **Validator:** new optional context fields accepted; title optional only when context present.
- **DAL:** `createFormReview` round-trips the new fields; `getAllFormReviews` / `getFormReviewById` selects return them; `getFormReviewStatusByAssignments` returns latest-per-exercise.
- **Pure helper:** `formReviewCardState` for each row state (none/pending/in_progress/reviewed).
- **Title derivation:** `{Exercise} — {Program}, Week N`.
- **Swap-aware mapping:** swapped exercise → `exercise_id` = swapped, `program_exercise_id` = original.
- **Component:** upload button renders only when `requires_video`; status chip renders correct state; admin list/detail render the tags.

## Out of scope (v1 / YAGNI)

- In-app camera capture (file upload covers it; mobile file picker still allows recording).
- Required-to-finish enforcement (we chose nudge).
- Coupling the upload to set-logging / `workout_sessions` / `exercise_progress`.
- Any unique constraint forcing one video per exercise (we allow many).
- Coach-initiated "request a (re-)recording" action (could be a later iteration).

## Integration points (exact files/symbols)

- `supabase/migrations/00172_form_review_program_link.sql` — **new**
- `types/database.ts` → `FormReview`
- `lib/db/form-reviews.ts` → `createFormReview`, `getAllFormReviews` (select), `getFormReviewById` (select), **new** `getFormReviewStatusByAssignments`
- `app/api/client/form-reviews/route.ts` → `createSchema` (the create Zod schema lives **inline in this route**, not in `lib/validators`), the `createFormReview(...)` call, audit metadata
- `hooks/use-form-review-upload.ts` — **new** shared hook
- `components/client/FormReviewUploadForm.tsx` → refactor onto the shared hook
- `components/client/WorkoutDay.tsx` → `ExerciseCard` upload button + dialog + status chip
- `app/(client)/client/workouts/page.tsx` → load status map, thread through
- `components/client/WorkoutViewToggle.tsx` + workout tabs + `WorkoutDay` → pass the status map down
- `lib/workout/` → **new** `formReviewCardState` helper + title derivation
- `components/admin/FormReviewList.tsx` → `ReviewItem`, card render, search filter
- `components/admin/FormReviewDetail.tsx` → review interface, metadata block
- (Unchanged, reuse) `storage.rules`, `lib/firebase-admin.ts:getSignedVideoUrl`, `components/shared/FormReviewThread.tsx`, `app/api/admin/form-reviews/[id]/messages/route.ts`, `lib/email.ts:sendFormReviewRequestEmail`, `lib/db/notifications.ts:createNotification`
