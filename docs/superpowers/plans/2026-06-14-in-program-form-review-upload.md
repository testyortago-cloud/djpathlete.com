# In-Program Form Review Video Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a client upload a form-check video directly from a `requires_video` exercise inside their workout, landing in the admin Form Reviews inbox tagged with Program · Exercise · Week · Client · Date, with a submission-status chip shown to both sides.

**Architecture:** Re-add nullable program/exercise/week link columns (+ snapshot names) to `form_reviews` (partial, safe reversal of migration 00043). The client workout exercise card gets a 🎥 upload button (reusing the existing Firebase upload via a shared hook); the create route derives program/exercise names server-side from the assignment (verifying ownership) and auto-generates the title. Per-exercise status rides inside each exercise item through the existing `WorkoutDay` prop chain. Admin list/detail render the new tags. No new endpoint, storage rule, notify, or email — the existing `POST /api/client/form-reviews` already audits, notifies admins, and emails the coach.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (service-role DAL), Firebase Storage (client resumable upload), Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-in-program-form-review-upload-design.md`

**Conventions:**
- Migrations are applied via `mcp__supabase__apply_migration` (CLI is not linked — do NOT `supabase db push`).
- Typecheck with `npx tsc --noEmit -p tsconfig.json` (the suite has ~155 known test/.next noise errors; filter to the file you touched). `npm run lint` is broken on Next 16 — don't use it.
- Tests run with `npm run test:run`. Test files live in `__tests__/`.

---

## Task 1: Migration — add program-link columns to `form_reviews`

**Files:**
- Create: `supabase/migrations/00172_form_review_program_link.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 00172_form_review_program_link.sql
-- Re-link form reviews to program context as NULLABLE columns (a deliberate,
-- safe partial reversal of 00043). Lets a client upload a form-check video from
-- inside a workout exercise and have it land in the admin Form Reviews inbox
-- tagged with program / exercise / week. Existing standalone reviews keep working
-- (all columns nullable). FK ON DELETE SET NULL preserves the review as a
-- historical record even if the program/exercise is later deleted; program_name
-- and exercise_name are denormalized snapshots captured at submission time.

ALTER TABLE form_reviews
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES programs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES program_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS program_exercise_id uuid REFERENCES program_exercises(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exercise_id uuid REFERENCES exercises(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS week_number int,
  ADD COLUMN IF NOT EXISTS program_name text,
  ADD COLUMN IF NOT EXISTS exercise_name text;

CREATE INDEX IF NOT EXISTS idx_form_reviews_assignment_pe
  ON form_reviews (assignment_id, program_exercise_id);
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP tool `mcp__supabase__apply_migration` with name `form_review_program_link` and the SQL above.

- [ ] **Step 3: Verify the columns exist**

Run this SQL via `mcp__supabase__execute_sql`:

```sql
select column_name from information_schema.columns
where table_name = 'form_reviews'
  and column_name in ('program_id','assignment_id','program_exercise_id','exercise_id','week_number','program_name','exercise_name')
order by column_name;
```

Expected: 7 rows returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00172_form_review_program_link.sql
git commit -m "feat(form-reviews): add nullable program-link columns to form_reviews (00172)"
```

---

## Task 2: Extend the `FormReview` type

**Files:**
- Modify: `types/database.ts:837-847` (the `FormReview` interface)

- [ ] **Step 1: Add the new optional fields to the `FormReview` interface**

Replace the existing interface (lines 837-847):

```ts
export interface FormReview {
  id: string
  client_user_id: string
  video_path: string
  thumbnail_url: string | null
  title: string
  notes: string | null
  status: FormReviewStatus
  created_at: string
  updated_at: string
  // In-program context (nullable; set only for uploads made from a workout exercise — migration 00172).
  program_id?: string | null
  assignment_id?: string | null
  program_exercise_id?: string | null
  exercise_id?: string | null
  week_number?: number | null
  program_name?: string | null
  exercise_name?: string | null
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "database.ts\|form-reviews"`
Expected: no errors referencing these files. (The fields are optional, so existing `createFormReview` callers still compile.)

- [ ] **Step 3: Commit**

```bash
git add types/database.ts
git commit -m "feat(form-reviews): add program-link fields to FormReview type"
```

---

## Task 3: Pure helpers — title derivation + card state (TDD)

**Files:**
- Create: `lib/workout/form-review.ts`
- Test: `__tests__/lib/workout/form-review.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/workout/form-review.test.ts
import { describe, it, expect } from "vitest"
import { deriveFormReviewTitle, formReviewCardState } from "@/lib/workout/form-review"

describe("deriveFormReviewTitle", () => {
  it("includes exercise, program, and week when week is present", () => {
    expect(deriveFormReviewTitle("Back Squat", "Trial", 2)).toBe("Back Squat — Trial, Week 2")
  })

  it("omits the week clause when week is null/undefined", () => {
    expect(deriveFormReviewTitle("Back Squat", "Trial", null)).toBe("Back Squat — Trial")
    expect(deriveFormReviewTitle("Back Squat", "Trial", undefined)).toBe("Back Squat — Trial")
  })

  it("falls back to the exercise name alone when program name is empty", () => {
    expect(deriveFormReviewTitle("Back Squat", "", 1)).toBe("Back Squat")
  })
})

describe("formReviewCardState", () => {
  it("returns 'none' when there is no submission", () => {
    expect(formReviewCardState(null)).toEqual({ kind: "none" })
  })

  it("maps pending to submitted", () => {
    expect(formReviewCardState({ id: "r1", status: "pending" })).toEqual({
      kind: "submitted",
      reviewId: "r1",
    })
  })

  it("maps in_progress to in_review", () => {
    expect(formReviewCardState({ id: "r1", status: "in_progress" })).toEqual({
      kind: "in_review",
      reviewId: "r1",
    })
  })

  it("maps reviewed to reviewed", () => {
    expect(formReviewCardState({ id: "r1", status: "reviewed" })).toEqual({
      kind: "reviewed",
      reviewId: "r1",
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- __tests__/lib/workout/form-review.test.ts`
Expected: FAIL — module `@/lib/workout/form-review` not found.

- [ ] **Step 3: Implement the helpers**

```ts
// lib/workout/form-review.ts
import type { FormReviewStatus } from "@/types/database"

/** Auto-generated title for an in-program form-review upload. */
export function deriveFormReviewTitle(
  exerciseName: string,
  programName: string,
  weekNumber?: number | null,
): string {
  const base = programName ? `${exerciseName} — ${programName}` : exerciseName
  return weekNumber != null ? `${base}, Week ${weekNumber}` : base
}

export type FormReviewSubmission = { id: string; status: FormReviewStatus }

export type FormReviewCardState =
  | { kind: "none" }
  | { kind: "submitted"; reviewId: string }
  | { kind: "in_review"; reviewId: string }
  | { kind: "reviewed"; reviewId: string }

/** Map the latest form-review row (or null) for an exercise to its card display state. */
export function formReviewCardState(submission: FormReviewSubmission | null): FormReviewCardState {
  if (!submission) return { kind: "none" }
  switch (submission.status) {
    case "pending":
      return { kind: "submitted", reviewId: submission.id }
    case "in_progress":
      return { kind: "in_review", reviewId: submission.id }
    case "reviewed":
      return { kind: "reviewed", reviewId: submission.id }
    default:
      return { kind: "none" }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- __tests__/lib/workout/form-review.test.ts`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/workout/form-review.ts __tests__/lib/workout/form-review.test.ts
git commit -m "feat(form-reviews): add title-derivation + card-state helpers"
```

---

## Task 4: DAL — status read-back + server-side context resolver

**Files:**
- Modify: `lib/db/form-reviews.ts` (add two functions)

Note: `getAllFormReviews()` and `getFormReviewById()` already use `select("*, ...")`, so they return the new columns automatically — no change needed there. `createFormReview()` already inserts the whole object and its `Omit<FormReview, ...>` input type now includes the new optional fields, so it also needs no change.

- [ ] **Step 1: Add `getFormReviewStatusByAssignments` and `getFormReviewContext`**

Append to `lib/db/form-reviews.ts` (after `getFormReviewCounts`, before end of file):

```ts
// ---------------------------------------------------------------------------
// In-program upload helpers (migration 00172)
// ---------------------------------------------------------------------------

/**
 * Latest form-review status per program_exercise_id across the given assignments.
 * Used by the client workout page to show a per-exercise submission chip.
 */
export async function getFormReviewStatusByAssignments(
  assignmentIds: string[],
): Promise<Map<string, { id: string; status: FormReviewStatus }>> {
  const map = new Map<string, { id: string; status: FormReviewStatus }>()
  if (assignmentIds.length === 0) return map

  const supabase = getClient()
  const { data, error } = await supabase
    .from("form_reviews")
    .select("id, status, program_exercise_id, created_at")
    .in("assignment_id", assignmentIds)
    .not("program_exercise_id", "is", null)
    .order("created_at", { ascending: false })
  if (error) throw error

  for (const row of (data ?? []) as Array<{
    id: string
    status: FormReviewStatus
    program_exercise_id: string | null
  }>) {
    // Rows are newest-first, so the first one seen per exercise is the latest.
    if (row.program_exercise_id && !map.has(row.program_exercise_id)) {
      map.set(row.program_exercise_id, { id: row.id, status: row.status })
    }
  }
  return map
}

/**
 * Resolve + authorize program context for an in-program upload.
 * Returns null when the assignment does not belong to the requesting user
 * (so the route can reject a spoofed assignment_id). program_name and
 * exercise_name are snapshots captured at submission time.
 */
export async function getFormReviewContext(params: {
  assignmentId: string
  exerciseId: string
  userId: string
}): Promise<{ program_id: string; program_name: string; exercise_name: string } | null> {
  const supabase = getClient()

  const { data: assignment } = await supabase
    .from("program_assignments")
    .select("program_id, user_id, programs(name)")
    .eq("id", params.assignmentId)
    .single()

  if (!assignment || assignment.user_id !== params.userId) return null

  const { data: exercise } = await supabase
    .from("exercises")
    .select("name")
    .eq("id", params.exerciseId)
    .single()

  const programName =
    (assignment as { programs?: { name?: string } | null }).programs?.name ?? ""

  return {
    program_id: assignment.program_id as string,
    program_name: programName,
    exercise_name: (exercise as { name?: string } | null)?.name ?? "",
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "form-reviews.ts"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/form-reviews.ts
git commit -m "feat(form-reviews): add status read-back + server-side context resolver to DAL"
```

---

## Task 5: Client API — accept program context + derive title server-side

**Files:**
- Modify: `app/api/client/form-reviews/route.ts`

- [ ] **Step 1: Extend the create schema and imports**

Replace the imports block (lines 1-9) and `createSchema` (lines 11-15):

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import {
  getFormReviewsByClient,
  createFormReview,
  getFormReviewContext,
} from "@/lib/db/form-reviews"
import { createNotification } from "@/lib/db/notifications"
import { getUsers } from "@/lib/db/users"
import { getUserById } from "@/lib/db/users"
import { sendFormReviewRequestEmail } from "@/lib/email"
import { withAudit } from "@/lib/audit/with-audit"
import { deriveFormReviewTitle } from "@/lib/workout/form-review"

const createSchema = z
  .object({
    video_path: z.string().min(1),
    title: z.string().min(1).max(200).optional(),
    notes: z.string().max(2000).nullable().optional(),
    // In-program context — present only for uploads made from a workout exercise.
    assignment_id: z.string().uuid().optional(),
    program_exercise_id: z.string().uuid().optional(),
    exercise_id: z.string().uuid().optional(),
    week_number: z.number().int().positive().optional(),
  })
  .refine((d) => !!d.title || (!!d.assignment_id && !!d.exercise_id), {
    message: "Either a title or program context (assignment_id + exercise_id) is required",
  })
```

- [ ] **Step 2: Build the review payload with derived context**

Replace the `const review = await createFormReview({...})` block (lines 53-59) with:

```ts
      // Resolve + authorize in-program context (snapshot program/exercise names).
      let contextFields: {
        program_id?: string
        assignment_id?: string
        program_exercise_id?: string | null
        exercise_id?: string
        week_number?: number | null
        program_name?: string
        exercise_name?: string
      } = {}
      let title = parsed.data.title ?? ""

      if (parsed.data.assignment_id && parsed.data.exercise_id) {
        const ctx = await getFormReviewContext({
          assignmentId: parsed.data.assignment_id,
          exerciseId: parsed.data.exercise_id,
          userId: session.user.id,
        })
        if (!ctx) {
          return NextResponse.json({ error: "Assignment not found for this user" }, { status: 403 })
        }
        title = title || deriveFormReviewTitle(ctx.exercise_name, ctx.program_name, parsed.data.week_number)
        contextFields = {
          program_id: ctx.program_id,
          assignment_id: parsed.data.assignment_id,
          program_exercise_id: parsed.data.program_exercise_id ?? null,
          exercise_id: parsed.data.exercise_id,
          week_number: parsed.data.week_number ?? null,
          program_name: ctx.program_name,
          exercise_name: ctx.exercise_name,
        }
      }

      if (!title) {
        return NextResponse.json({ error: "A title is required" }, { status: 400 })
      }

      const review = await createFormReview({
        client_user_id: session.user.id,
        video_path: parsed.data.video_path,
        title,
        notes: parsed.data.notes ?? null,
        status: "pending",
        ...contextFields,
      })
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "form-reviews/route.ts"`
Expected: no errors.

- [ ] **Step 4: Manual sanity check of the schema logic**

Confirm by reading: a body with only `{ video_path, title }` (standalone page) still passes `.refine`; a body with `{ video_path, assignment_id, exercise_id, week_number }` (in-program) passes and derives the title.

- [ ] **Step 5: Commit**

```bash
git add app/api/client/form-reviews/route.ts
git commit -m "feat(form-reviews): accept program context + derive title in create route"
```

---

## Task 6: Shared upload hook (extract from `FormReviewUploadForm`)

**Files:**
- Create: `hooks/use-form-review-upload.ts`
- Modify: `components/client/FormReviewUploadForm.tsx` (use the hook)

- [ ] **Step 1: Create the hook**

```ts
// hooks/use-form-review-upload.ts
"use client"

import { useState } from "react"
import { ref, uploadBytesResumable } from "firebase/storage"
import { storage } from "@/lib/firebase"
import { toast } from "sonner"

export const FORM_REVIEW_MAX_SIZE_MB = 250
export const FORM_REVIEW_MAX_DURATION_SECONDS = 300 // 5 minutes
export const FORM_REVIEW_ACCEPTED_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"]

/**
 * Shared Firebase video upload + client-side validation for form reviews.
 * Used by the standalone upload page and the in-workout upload dialog.
 */
export function useFormReviewUpload(userId: string) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  /** Returns true if the file passes size/type/duration checks (toasts on failure). */
  async function validateVideo(file: File): Promise<boolean> {
    if (file.size > FORM_REVIEW_MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`Video must be under ${FORM_REVIEW_MAX_SIZE_MB}MB`)
      return false
    }
    if (!FORM_REVIEW_ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Unsupported video format. Use MP4, MOV, WebM, or AVI.")
      return false
    }
    return new Promise((resolve) => {
      const video = document.createElement("video")
      video.preload = "metadata"
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src)
        if (video.duration > FORM_REVIEW_MAX_DURATION_SECONDS) {
          toast.error("Video must be 5 minutes or less")
          resolve(false)
        } else {
          resolve(true)
        }
      }
      video.onerror = () => {
        URL.revokeObjectURL(video.src)
        resolve(true) // can't read duration — allow it
      }
      video.src = URL.createObjectURL(file)
    })
  }

  /** Uploads to form-reviews/{userId}/{timestamp}.{ext}; returns the storage path. */
  async function uploadVideo(file: File): Promise<string> {
    setUploading(true)
    setProgress(0)
    try {
      const ext = file.name.split(".").pop() ?? "mp4"
      const videoPath = `form-reviews/${userId}/${Date.now()}.${ext}`
      const storageRef = ref(storage, videoPath)
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, file)
        task.on(
          "state_changed",
          (snap) => setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
          (err) => reject(err),
          () => resolve(),
        )
      })
      return videoPath
    } finally {
      setUploading(false)
    }
  }

  return { uploading, progress, validateVideo, uploadVideo }
}
```

- [ ] **Step 2: Refactor `FormReviewUploadForm` to use the hook**

In `components/client/FormReviewUploadForm.tsx`:

Replace the imports (lines 3-14) — remove the now-shared Firebase imports and add the hook:

```ts
import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Upload, Video, X, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { summarizeApiError, type FieldErrors } from "@/lib/errors/humanize"
import {
  useFormReviewUpload,
  FORM_REVIEW_MAX_SIZE_MB,
  FORM_REVIEW_MAX_DURATION_SECONDS,
} from "@/hooks/use-form-review-upload"
```

Delete the local `MAX_SIZE_MB`, `MAX_DURATION_SECONDS`, `ACCEPTED_TYPES` consts (lines 20-22) and the entire local `validateVideo` function (lines 36-69).

Inside the component, replace the `uploading`/`progress` state (lines 30-31) with the hook, keeping the other state:

```ts
  const { uploading, progress, validateVideo, uploadVideo } = useFormReviewUpload(userId)
```

In `handleSubmit`, replace the Firebase upload block (lines 100-121, from `setUploading(true)` through the upload `await new Promise...`) with:

```ts
    try {
      // 1. Upload to Firebase Storage (shared hook)
      const videoPath = await uploadVideo(file)
```

(Keep the rest of `handleSubmit` — the `fetch("/api/client/form-reviews", ...)` POST, error handling, success toast, and redirect — unchanged. Remove the now-unused `setUploading`/`setProgress` calls in the `finally`/`catch` since the hook owns them.)

Update the dropzone help text (line 227) to use the exported consts. Change:

```tsx
                MP4, MOV, WebM, or AVI. Max {MAX_SIZE_MB}MB, {MAX_DURATION_SECONDS / 60} minutes.
```
to:

```tsx
                MP4, MOV, WebM, or AVI. Max {FORM_REVIEW_MAX_SIZE_MB}MB, {FORM_REVIEW_MAX_DURATION_SECONDS / 60} minutes.
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "FormReviewUploadForm\|use-form-review-upload"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add hooks/use-form-review-upload.ts components/client/FormReviewUploadForm.tsx
git commit -m "refactor(form-reviews): extract shared upload hook"
```

---

## Task 7: In-workout upload dialog component

**Files:**
- Create: `components/client/ExerciseVideoUpload.tsx`

- [ ] **Step 1: Create the dialog component**

```tsx
// components/client/ExerciseVideoUpload.tsx
"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Upload, Video, X, Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useFormReviewUpload, FORM_REVIEW_MAX_SIZE_MB } from "@/hooks/use-form-review-upload"

interface ExerciseVideoUploadProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  assignmentId: string
  programExerciseId: string
  exerciseId: string
  exerciseName: string
  weekNumber: number
  onUploaded?: () => void
}

export function ExerciseVideoUpload({
  open,
  onOpenChange,
  userId,
  assignmentId,
  programExerciseId,
  exerciseId,
  exerciseName,
  weekNumber,
  onUploaded,
}: ExerciseVideoUploadProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const { uploading, progress, validateVideo, uploadVideo } = useFormReviewUpload(userId)
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState("")

  async function handleFileSelect(selected: File | undefined) {
    if (!selected) return
    const valid = await validateVideo(selected)
    if (valid) setFile(selected)
  }

  async function handleSubmit() {
    if (!file) return
    try {
      const videoPath = await uploadVideo(file)
      const res = await fetch("/api/client/form-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_path: videoPath,
          assignment_id: assignmentId,
          program_exercise_id: programExerciseId,
          exercise_id: exerciseId,
          week_number: weekNumber,
          notes: note.trim() || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to submit recording")
      }
      toast.success("Recording submitted to your coach!")
      setFile(null)
      setNote("")
      onUploaded?.()
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload your video. Please try again.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (uploading ? null : onOpenChange(o))}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Upload recording</DialogTitle>
        <DialogDescription className="text-xs">
          {exerciseName} — Week {weekNumber}. Your coach will review it in Form Reviews.
        </DialogDescription>

        {/* Video picker */}
        <div
          className="relative border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer border-border hover:border-primary/40"
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files?.[0])}
          />
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <Video className="size-7 text-green-600" />
              <div className="text-left">
                <p className="text-sm font-medium text-foreground truncate max-w-[180px]">{file.name}</p>
                <p className="text-xs text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setFile(null)
                }}
                className="p-1 rounded-full hover:bg-muted"
              >
                <X className="size-4 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Upload className="size-7 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">Tap to record or choose a video</p>
              <p className="text-xs text-muted-foreground">MP4, MOV, WebM, or AVI. Max {FORM_REVIEW_MAX_SIZE_MB}MB, 5 min.</p>
            </div>
          )}
        </div>

        {uploading && (
          <div className="space-y-1">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-muted-foreground text-center">Uploading... {progress}%</p>
          </div>
        )}

        <Textarea
          placeholder="Optional note for your coach (e.g. felt my knee cave on rep 3)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
          className="resize-none"
        />

        <Button onClick={handleSubmit} disabled={uploading || !file} className="w-full">
          {uploading ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Uploading...
            </>
          ) : (
            "Submit recording"
          )}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "ExerciseVideoUpload"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/client/ExerciseVideoUpload.tsx
git commit -m "feat(form-reviews): add in-workout ExerciseVideoUpload dialog"
```

---

## Task 8: Wire the upload button + status chip into `ExerciseCard`

**Files:**
- Modify: `components/client/WorkoutDay.tsx`

- [ ] **Step 1: Add the `videoSubmission` field to the exercise item type**

In the `ExerciseWithRecommendation` interface (lines 53-61), add the field and import the type. Add to the imports near line 38:

```ts
import type { Exercise, ExerciseCategory, ProgramExercise, SetDetail, TrainingTechnique, FormReviewStatus } from "@/types/database"
```

Add to `ExerciseWithRecommendation`:

```ts
export interface ExerciseWithRecommendation {
  programExercise: ProgramExercise
  exercise: Exercise
  recommendation: WeightRecommendation
  loggedToday: boolean
  savedSetDetails?: SetDetail[] | null
  /** Latest form-review submission for this program-exercise slot (null = none yet). */
  videoSubmission?: { id: string; status: FormReviewStatus } | null
}
```

- [ ] **Step 2: Import the dialog, helper, and an icon; pass `userId` down**

Add imports near the other component imports (around line 36):

```ts
import { ExerciseVideoUpload } from "@/components/client/ExerciseVideoUpload"
import { formReviewCardState } from "@/lib/workout/form-review"
```

Add `Upload` and `Clock` to the lucide-react import list at the top (lines 7-24). `CheckCircle2` and `Video` are already imported.

`ExerciseCard` and `WorkoutDay` need the client `userId`. Add `userId: string` to `WorkoutDayProps` (lines 73-80):

```ts
export interface WorkoutDayProps {
  day: number
  dayLabel: string
  exercises: ExerciseWithRecommendation[]
  assignmentId: string
  userId: string
  onExerciseLogged?: (exerciseId: string) => void
  programContext?: ProgramContextData | null
}
```

Add `userId` to the `ExerciseCard` props type + destructure (lines 187-204):

```ts
function ExerciseCard({
  programExercise: pe,
  exercise,
  recommendation: rec,
  loggedToday: initialLogged,
  savedSetDetails,
  videoSubmission,
  assignmentId,
  userId,
  index,
  onLogged,
  hideNotes,
  programContext,
}: ExerciseWithRecommendation & {
  assignmentId: string
  userId: string
  index: number
  onLogged?: () => void
  hideNotes?: boolean
  programContext?: ProgramContextData | null
}) {
```

- [ ] **Step 3: Add upload-dialog state**

After the existing `showVideo` state (line 219), add:

```ts
  const [showUpload, setShowUpload] = useState(false)
```

- [ ] **Step 4: Render the upload control / status chip in the quick-action row**

In the quick-action row (lines 546-570), after the Swap button block and before the closing `</div>` of that row, add a `requires_video` control:

```tsx
                  {pe.requires_video &&
                    (() => {
                      const state = formReviewCardState(videoSubmission ?? null)
                      if (state.kind === "none") {
                        return (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-1 text-accent border-accent/40 hover:text-accent h-7 text-xs"
                            onClick={() => setShowUpload(true)}
                          >
                            <Upload className="size-3" />
                            Upload recording
                          </Button>
                        )
                      }
                      if (state.kind === "reviewed") {
                        return (
                          <a
                            href={`/client/form-reviews/${state.reviewId}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-success hover:underline"
                          >
                            <CheckCircle2 className="size-3" />
                            Reviewed — view feedback
                          </a>
                        )
                      }
                      return (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                          <Clock className="size-3" />
                          {state.kind === "submitted" ? "Submitted — awaiting review" : "In review"}
                        </span>
                      )
                    })()}
```

- [ ] **Step 5: Render the dialog**

Next to the other dialogs at the end of the card (after the Video dialog block, around line 986, before `<CelebrationOverlay .../>`), add:

```tsx
      {pe.requires_video && (
        <ExerciseVideoUpload
          open={showUpload}
          onOpenChange={setShowUpload}
          userId={userId}
          assignmentId={assignmentId}
          programExerciseId={pe.id}
          exerciseId={swappedExercise ? swappedExercise.id : exercise.id}
          exerciseName={displayExercise.name}
          weekNumber={pe.week_number}
          onUploaded={() => router.refresh()}
        />
      )}
```

- [ ] **Step 6: Thread `userId` through `WorkoutDay` to `ExerciseCard`**

In the `WorkoutDay` function signature (lines 995-1002), add `userId`:

```ts
export function WorkoutDay({
  day,
  dayLabel,
  exercises,
  assignmentId,
  userId,
  onExerciseLogged,
  programContext,
}: WorkoutDayProps) {
```

In BOTH `<ExerciseCard ... />` usages (the grouped block ~line 1051 and the standalone block ~line 1085), add `userId={userId}`:

```tsx
                  <ExerciseCard
                    index={idx}
                    {...item}
                    assignmentId={assignmentId}
                    userId={userId}
                    onLogged={() => handleExerciseLogged(item.exercise.id)}
                    hideNotes={!!sharedNote}
                    programContext={programContext}
                  />
```

(and the standalone one likewise, keeping its existing props.)

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "WorkoutDay.tsx"`
Expected: errors only about `WorkoutDay` callers missing `userId` (fixed in Task 9), none inside `WorkoutDay.tsx` itself. If `WorkoutTabs.tsx` reports the missing `userId` prop, that is expected and fixed next.

- [ ] **Step 8: Commit**

```bash
git add components/client/WorkoutDay.tsx
git commit -m "feat(form-reviews): upload button + status chip on requires_video exercise"
```

---

## Task 9: Load status + thread `userId` through the page and tabs

**Files:**
- Modify: `app/(client)/client/workouts/page.tsx`
- Modify: `components/client/WorkoutTabs.tsx`

- [ ] **Step 1: Load the status map in the workouts page**

In `app/(client)/client/workouts/page.tsx`, add the import (near line 7):

```ts
import { getFormReviewStatusByAssignments } from "@/lib/db/form-reviews"
import type { FormReviewStatus } from "@/types/database"
```

After the `weekAccessByAssignment` block (after line 119), add:

```ts
  // Latest form-review submission per program-exercise (for the 🎥 status chip)
  let formReviewStatusByPe: Map<string, { id: string; status: FormReviewStatus }> = new Map()
  try {
    const assignmentIds = activeAssignments.map((a) => a.id)
    if (assignmentIds.length > 0) {
      formReviewStatusByPe = await getFormReviewStatusByAssignments(assignmentIds)
    }
  } catch {
    // Table/columns may not exist yet — render without status chips
  }
```

- [ ] **Step 2: Attach `videoSubmission` in `buildExerciseData`**

In `buildExerciseData` (lines 234-250), add the field to the returned object:

```ts
        return {
          programExercise: pe as ProgramExercise,
          exercise,
          recommendation,
          loggedToday: isCurrentWeek && wasLoggedToday(exercise.id),
          savedSetDetails: history[0]?.set_details ?? null,
          videoSubmission: formReviewStatusByPe.get(pe.id) ?? null,
        }
```

- [ ] **Step 3: Add `userId` to each program's tab data**

In the `tabPrograms` returned object (lines 220-231), add `userId`:

```ts
      return {
        programName: program.name,
        category: program.category,
        difficulty: program.difficulty,
        periodization: program.periodization ?? null,
        splitType: program.split_type ?? null,
        assignmentId: assignment.id,
        userId,
        currentWeek,
        totalWeeks,
        weeks,
        lockedWeeks,
      }
```

- [ ] **Step 4: Thread `userId` through `WorkoutTabs`**

In `components/client/WorkoutTabs.tsx`, add `userId` to the `ProgramWorkout` interface (lines 18-29):

```ts
interface ProgramWorkout {
  programName: string
  category: string | string[]
  difficulty: string
  periodization: string | null
  splitType: string | null
  assignmentId: string
  userId: string
  currentWeek: number
  totalWeeks: number
  weeks: Record<number, WorkoutDayProps[]>
  lockedWeeks?: Record<number, { priceCents: number }>
}
```

In the `<WorkoutDay ... />` usage inside `ProgramDetail` (lines 457-472), add `userId={program.userId}`:

```tsx
              <WorkoutDay
                day={dayData.day}
                dayLabel={dayData.dayLabel}
                exercises={dayData.exercises}
                assignmentId={program.assignmentId}
                userId={program.userId}
                onExerciseLogged={handleExerciseLogged}
                programContext={{
                  programName: program.programName,
                  difficulty: program.difficulty,
                  category: program.category,
                  periodization: program.periodization,
                  splitType: program.splitType,
                  currentWeek: effectiveCurrentWeek,
                  totalWeeks: program.totalWeeks,
                }}
              />
```

Note: `dayData.exercises` items now carry `videoSubmission`, so it rides through to `ExerciseCard` via `{...item}` — no other change needed in `WorkoutTabs`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "workouts/page.tsx\|WorkoutTabs.tsx\|WorkoutDay.tsx"`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "app/(client)/client/workouts/page.tsx" components/client/WorkoutTabs.tsx
git commit -m "feat(form-reviews): load + thread per-exercise submission status to workout cards"
```

---

## Task 10: Optional finish-session nudge

**Files:**
- Modify: `components/client/FinishSessionButton.tsx`
- Modify: `components/client/WorkoutTabs.tsx`

- [ ] **Step 1: Add a `missingVideoCount` prop + reminder to `FinishSessionButton`**

In `components/client/FinishSessionButton.tsx`, extend the props (lines 20-32):

```ts
export function FinishSessionButton({
  assignmentId,
  weekNumber,
  dayOfWeek,
  volumeLoadKg,
  allLogged,
  missingVideoCount = 0,
}: {
  assignmentId: string
  weekNumber: number
  dayOfWeek: number
  volumeLoadKg: number | null
  allLogged: boolean
  missingVideoCount?: number
}) {
```

In the collapsed-state return (lines 78-96), add a dismissible reminder above the existing helper text. Replace the collapsed block with:

```tsx
  if (!open) {
    return (
      <div className="mt-6">
        <Button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full gap-2"
          variant={allLogged ? "default" : "outline"}
        >
          <CheckCircle2 className="size-4" />
          Finish session
        </Button>
        {missingVideoCount > 0 && (
          <p className="mt-1 text-center text-[11px] text-accent">
            {missingVideoCount} exercise{missingVideoCount > 1 ? "s" : ""} still need a recording — you can finish anyway.
          </p>
        )}
        {!allLogged && (
          <p className="mt-1 text-center text-[11px] text-muted-foreground">
            You can finish early — or log the rest first.
          </p>
        )}
      </div>
    )
  }
```

- [ ] **Step 2: Compute + pass `missingVideoCount` from `ProgramDetail`**

In `components/client/WorkoutTabs.tsx` `ProgramDetail`, after `dayExercises` is defined (line 245), add:

```ts
  const missingVideoCount = dayExercises.filter(
    (e) => e.programExercise.requires_video && !e.videoSubmission,
  ).length
```

In the `<FinishSessionButton ... />` usage (lines 494-500), add the prop:

```tsx
        <FinishSessionButton
          assignmentId={program.assignmentId}
          weekNumber={selectedWeek}
          dayOfWeek={selectedDay}
          volumeLoadKg={sessionVolumeKg > 0 ? sessionVolumeKg : null}
          allLogged={totalCount > 0 && loggedCount === totalCount}
          missingVideoCount={missingVideoCount}
        />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "FinishSessionButton\|WorkoutTabs.tsx"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/client/FinishSessionButton.tsx components/client/WorkoutTabs.tsx
git commit -m "feat(form-reviews): nudge for unrecorded requires_video exercises at finish"
```

---

## Task 11: Admin list — render the program/exercise/week tags

**Files:**
- Modify: `components/admin/FormReviewList.tsx`

- [ ] **Step 1: Extend the `ReviewItem` interface**

Replace lines 9-15:

```ts
interface ReviewItem {
  id: string
  title: string
  status: string
  created_at: string
  program_name?: string | null
  exercise_name?: string | null
  week_number?: number | null
  users?: { first_name: string; last_name: string; email: string } | null
}
```

- [ ] **Step 2: Include program/exercise in the search filter**

In the search filter (lines 50-55), extend the matched fields:

```ts
      if (q) {
        const clientName = r.users ? `${r.users.first_name} ${r.users.last_name}`.toLowerCase() : ""
        const email = r.users?.email?.toLowerCase() ?? ""
        const title = r.title.toLowerCase()
        const program = r.program_name?.toLowerCase() ?? ""
        const exercise = r.exercise_name?.toLowerCase() ?? ""
        if (
          !clientName.includes(q) &&
          !email.includes(q) &&
          !title.includes(q) &&
          !program.includes(q) &&
          !exercise.includes(q)
        )
          return false
      }
```

- [ ] **Step 3: Render the metadata line in the card**

In the card body, after the client-name `<p>` (line 184), add a metadata line:

```tsx
                  <p className="text-xs text-muted-foreground">{clientName}</p>
                  {review.program_name && (
                    <p className="text-[11px] text-muted-foreground/80 truncate">
                      {review.program_name}
                      {review.exercise_name ? ` • ${review.exercise_name}` : ""}
                      {review.week_number != null ? ` • Wk ${review.week_number}` : ""}
                    </p>
                  )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "FormReviewList"`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/admin/FormReviewList.tsx
git commit -m "feat(form-reviews): show program/exercise/week tags in admin list"
```

---

## Task 12: Admin detail — render the metadata block

**Files:**
- Modify: `components/admin/FormReviewDetail.tsx`

- [ ] **Step 1: Extend the review prop interface**

In `FormReviewDetailProps.review` (lines 14-22), add the fields:

```ts
  review: {
    id: string
    title: string
    notes: string | null
    status: string
    created_at: string
    video_path: string
    program_name?: string | null
    exercise_name?: string | null
    week_number?: number | null
    users?: { first_name: string; last_name: string; email: string; avatar_url?: string | null } | null
  }
```

- [ ] **Step 2: Render a metadata block under the header**

Immediately after the header `</div>` that closes the title/status row (after line 107, before the Video block at line 109), add:

```tsx
      {/* Program context (in-program uploads) */}
      {review.program_name && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{review.program_name}</span>
          {review.exercise_name && (
            <>
              <span className="text-border">•</span>
              <span>{review.exercise_name}</span>
            </>
          )}
          {review.week_number != null && (
            <>
              <span className="text-border">•</span>
              <span>Week {review.week_number}</span>
            </>
          )}
        </div>
      )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "FormReviewDetail"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/admin/FormReviewDetail.tsx
git commit -m "feat(form-reviews): show program/exercise/week metadata in admin detail"
```

---

## Task 13: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full typecheck and confirm no NEW errors**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: only the pre-existing ~155 test/.next noise errors. Specifically confirm zero errors in: `lib/workout/form-review.ts`, `lib/db/form-reviews.ts`, `app/api/client/form-reviews/route.ts`, `hooks/use-form-review-upload.ts`, `components/client/ExerciseVideoUpload.tsx`, `components/client/WorkoutDay.tsx`, `components/client/WorkoutTabs.tsx`, `components/client/FinishSessionButton.tsx`, `app/(client)/client/workouts/page.tsx`, `components/admin/FormReviewList.tsx`, `components/admin/FormReviewDetail.tsx`.

- [ ] **Step 2: Run the test suite**

Run: `npm run test:run`
Expected: green; the new `__tests__/lib/workout/form-review.test.ts` passes. (See `[[test-baseline-not-green]]` — baseline is green as of 2026-06-13.)

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke test (dev server)**

Run: `npm run dev` (port 3050) and verify, as an admin + a test client:
1. In the program builder, add an exercise with **"Client must record a video of this exercise"** checked.
2. As the client, open that workout day → the flagged exercise shows **Upload recording**.
3. Upload a short video → toast success; chip flips to **Submitted — awaiting review**.
4. As admin, **Form Reviews** list shows the entry tagged **Program • Exercise • Wk N** with the client name + date; detail page shows the metadata block + plays the video.
5. Reply in the thread → client exercise chip moves to **In review**; **Mark as Reviewed** → chip shows **Reviewed — view feedback** linking to the thread.
6. Finish a session with an unrecorded flagged exercise → the dismissible "still need a recording" nudge appears and does NOT block finishing.
7. The standalone `/client/form-reviews/new` page still uploads correctly (regression check on the shared hook).

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "test(form-reviews): verify in-program upload end to end"
```

---

## Self-review notes (coverage map spec → tasks)

- Spec §A data model → Task 1
- Spec §B client upload UI + shared hook → Tasks 6, 7, 8
- Spec §C status loop (read-back + chip) → Tasks 3, 4, 8, 9
- Spec §D finish nudge → Task 10
- Spec §E admin tags → Tasks 11, 12
- Spec §F client API + title derivation → Tasks 3, 5
- Spec testing → Task 3 (helpers) + Task 13 (tsc/tests/build/manual)

**Refinement vs. spec §F:** the spec listed `program_name`/`exercise_name` as client-sent fields. This plan resolves them **server-side** in the create route (via `getFormReviewContext`, which also authorizes the assignment against the requesting user) — strictly more robust (accurate snapshots, no spoofing, less client threading). `week_number` is still client-sent (it's the slot's own `program_exercises.week_number`, already in scope). `program_id` is derived server-side, so it never needs threading into the workout component chain.
