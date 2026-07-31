import type { TeamVideoSubmissionKind, TeamVideoSubmissionStatus } from "@/types/database"

/**
 * Who may upload a new cut, and what each side should be told about why.
 *
 * Pure — no DB, no session. Both the editor UI, the admin review surface and
 * the two upload routes derive their copy and their gates from here so the
 * button, the banner and the 409 can never drift apart.
 *
 * Policy (decided 2026-07-31): an editor can deliver a new version at ANY
 * point until the submission is signed off. The old rule only opened the
 * dropzone on `revision_requested`, which silently stranded editors whenever
 * Darren left a note without also clicking "Request revision" — they had no
 * upload zone, no error, and no way to tell they were blocked.
 */

/** Signed-off states. A new cut must not quietly replace an approved video. */
const CLOSED_TO_UPLOADS: readonly TeamVideoSubmissionStatus[] = ["approved", "locked"]

/** States where Darren holds the ball and hasn't formally sent feedback yet. */
const AWAITING_REVIEW: readonly TeamVideoSubmissionStatus[] = ["submitted", "in_review"]

export function canEditorUpload(status: TeamVideoSubmissionStatus): boolean {
  return !CLOSED_TO_UPLOADS.includes(status)
}

/**
 * Why an upload is refused, in words the editor can act on. `null` when the
 * upload is allowed. Used verbatim as the API's 409 body so a client that
 * somehow posts anyway gets the same sentence the UI would have shown.
 */
export function uploadBlockedReason(status: TeamVideoSubmissionStatus): string | null {
  if (status === "approved") {
    return "Darren has approved this cut. Ask him to reopen it before uploading a new version."
  }
  if (status === "locked") {
    return "This submission is locked and can no longer be changed."
  }
  return null
}

export type EditorStateTone = "action" | "waiting" | "done"

export interface EditorWorkflowState {
  canUpload: boolean
  tone: EditorStateTone
  /** Short line — what state this is in. */
  headline: string
  /** One sentence — what it means / what to do next. */
  detail: string
  /** Copy for the ribbon above the dropzone. `null` when upload is blocked. */
  uploadPrompt: string | null
}

/**
 * The editor's plain-language read on where a submission stands. Every status
 * returns something — the old UI rendered nothing at all unless a revision was
 * pending, which is exactly how an editor ends up staring at a page with no
 * upload zone and no explanation.
 */
export function editorWorkflowState(input: {
  status: TeamVideoSubmissionStatus
  /** Open notes on the version the editor is being asked to fix. */
  openCommentCount: number
  /** False before any cut has been delivered. */
  hasVersion: boolean
  /** Drives the noun in the copy — "cut" vs "photo set". Defaults to video. */
  kind?: TeamVideoSubmissionKind
}): EditorWorkflowState {
  const { status, openCommentCount, hasVersion, kind = "video" } = input
  const notes = noteCount(openCommentCount)
  const noun = kind === "image_set" ? "photo set" : "cut"

  switch (status) {
    case "draft":
      return {
        canUpload: true,
        tone: "action",
        headline: hasVersion ? "Draft — not sent yet" : "Draft — nothing uploaded yet",
        detail: hasVersion
          ? `Darren can't see this yet. Upload the ${noun} you want reviewed.`
          : `Upload your first ${noun} to send it to Darren for review.`,
        uploadPrompt: `Upload the ${noun} you want Darren to review.`,
      }

    case "submitted":
    case "in_review":
      return {
        canUpload: true,
        tone: openCommentCount > 0 ? "action" : "waiting",
        headline:
          openCommentCount > 0
            ? `${notes} on your latest ${noun}`
            : "With Darren for review",
        detail:
          openCommentCount > 0
            ? `Darren has left notes on this version. You can upload a revised ${noun} whenever you're ready — you don't need to wait for him to formally request one.`
            : `Darren hasn't left notes on this version yet. You can still upload a newer ${noun} if you have one.`,
        uploadPrompt:
          openCommentCount > 0
            ? `Uploading a new ${noun} will address ${notes.toLowerCase()} and put it back in front of Darren.`
            : `Uploading a new ${noun} replaces the one Darren is reviewing.`,
      }

    case "revision_requested":
      return {
        canUpload: true,
        tone: "action",
        headline: "Darren requested a revision",
        detail:
          openCommentCount > 0
            ? `Upload a new version to address ${notes.toLowerCase()}.`
            : "Upload a new version when you're ready.",
        uploadPrompt:
          openCommentCount > 0
            ? `Darren requested a revision — ${notes.toLowerCase()} to address.`
            : "Darren requested a revision. Upload a new version to address it.",
      }

    case "approved":
      return {
        canUpload: false,
        tone: "done",
        headline: "Approved",
        detail: `Darren approved this ${noun} — nothing more is needed from you. If it needs another change, ask him to reopen it.`,
        uploadPrompt: null,
      }

    case "locked":
      return {
        canUpload: false,
        tone: "done",
        headline: "Locked",
        detail: "This submission is closed and can no longer be changed.",
        uploadPrompt: null,
      }
  }
}

export interface UnsentFeedback {
  /** True when Darren has open notes the editor was never pinged about. */
  unsent: boolean
  /** Banner copy for the admin review surface. `null` when nothing to nag about. */
  message: string | null
}

/**
 * Has Darren written notes he never actually sent?
 *
 * Commenting deliberately does NOT notify (he drafts several notes per cut and
 * shouldn't fire an email each time) — "Request revision" is the send action.
 * The gap that stranded the Liam submission was that nothing on screen said so.
 *
 * Scoped to open notes on the CURRENT version on purpose: once the editor
 * delivers a newer cut, stale notes on the old one aren't unsent feedback —
 * they've already been seen and acted on.
 */
export function unsentFeedback(input: {
  status: TeamVideoSubmissionStatus
  openCommentsOnCurrentVersion: number
}): UnsentFeedback {
  const { status, openCommentsOnCurrentVersion: open } = input
  if (open <= 0 || !AWAITING_REVIEW.includes(status)) {
    return { unsent: false, message: null }
  }
  return {
    unsent: true,
    message: `${noteCount(open)} on this cut — your editor hasn't been notified yet.`,
  }
}

function noteCount(n: number): string {
  return n === 1 ? "1 open note" : `${n} open notes`
}
