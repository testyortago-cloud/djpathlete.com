import type { FormReviewStatus } from "@/types/database"

/** Auto-generated title for an in-program form-review upload. */
export function deriveFormReviewTitle(
  exerciseName: string,
  programName: string,
  weekNumber?: number | null,
): string {
  if (!programName) return exerciseName
  const base = `${exerciseName} — ${programName}`
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
