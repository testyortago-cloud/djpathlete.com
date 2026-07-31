import { describe, it, expect } from "vitest"
import {
  canEditorUpload,
  uploadBlockedReason,
  editorWorkflowState,
  unsentFeedback,
} from "@/lib/team-videos/workflow"
import type { TeamVideoSubmissionStatus } from "@/types/database"

const ALL_STATUSES: TeamVideoSubmissionStatus[] = [
  "draft",
  "submitted",
  "in_review",
  "revision_requested",
  "approved",
  "locked",
]

describe("canEditorUpload", () => {
  it("allows every state except approved and locked", () => {
    const allowed = ALL_STATUSES.filter(canEditorUpload)
    // Exact set — a regression that re-narrows the gate to revision_requested
    // only (the bug this replaced) fails here rather than silently passing.
    expect(allowed).toEqual(["draft", "submitted", "in_review", "revision_requested"])
  })

  it("blocks signed-off work", () => {
    expect(canEditorUpload("approved")).toBe(false)
    expect(canEditorUpload("locked")).toBe(false)
  })

  it("allows an upload while Darren is still reviewing", () => {
    // The exact case that stranded the Liam submission: notes left, but no
    // formal revision request, so the editor had nowhere to upload.
    expect(canEditorUpload("submitted")).toBe(true)
    expect(canEditorUpload("in_review")).toBe(true)
  })
})

describe("uploadBlockedReason", () => {
  it("returns null exactly when the upload is allowed", () => {
    for (const s of ALL_STATUSES) {
      expect(uploadBlockedReason(s) === null).toBe(canEditorUpload(s))
    }
  })

  it("names the way out of each blocked state", () => {
    expect(uploadBlockedReason("approved")).toContain("reopen")
    expect(uploadBlockedReason("locked")).toContain("locked")
  })
})

describe("editorWorkflowState", () => {
  it("explains every status — never renders an empty state", () => {
    for (const status of ALL_STATUSES) {
      const s = editorWorkflowState({ status, openCommentCount: 0, hasVersion: true })
      expect(s.headline.length).toBeGreaterThan(0)
      expect(s.detail.length).toBeGreaterThan(0)
    }
  })

  it("tells a submitted-with-notes editor they may upload without waiting", () => {
    const s = editorWorkflowState({
      status: "submitted",
      openCommentCount: 1,
      hasVersion: true,
    })
    expect(s.canUpload).toBe(true)
    expect(s.tone).toBe("action")
    expect(s.headline).toBe("1 open note on your latest cut")
    expect(s.detail).toContain("don't need to wait")
  })

  it("pluralises note counts", () => {
    const one = editorWorkflowState({
      status: "revision_requested",
      openCommentCount: 1,
      hasVersion: true,
    })
    const three = editorWorkflowState({
      status: "revision_requested",
      openCommentCount: 3,
      hasVersion: true,
    })
    expect(one.uploadPrompt).toContain("1 open note")
    expect(three.uploadPrompt).toContain("3 open notes")
  })

  it("waits rather than nags when a submitted cut has no notes", () => {
    const s = editorWorkflowState({
      status: "submitted",
      openCommentCount: 0,
      hasVersion: true,
    })
    expect(s.tone).toBe("waiting")
    expect(s.canUpload).toBe(true)
  })

  it("distinguishes an empty draft from a draft with an unsent cut", () => {
    const empty = editorWorkflowState({
      status: "draft",
      openCommentCount: 0,
      hasVersion: false,
    })
    const unsent = editorWorkflowState({
      status: "draft",
      openCommentCount: 0,
      hasVersion: true,
    })
    expect(empty.headline).not.toBe(unsent.headline)
    expect(empty.detail).toContain("first cut")
    expect(unsent.detail).toContain("can't see this yet")
  })

  it("says 'photo set' for image submissions and 'cut' for video", () => {
    const video = editorWorkflowState({
      status: "submitted",
      openCommentCount: 0,
      hasVersion: true,
      kind: "video",
    })
    const photos = editorWorkflowState({
      status: "submitted",
      openCommentCount: 0,
      hasVersion: true,
      kind: "image_set",
    })
    expect(video.uploadPrompt).toContain("cut")
    expect(video.uploadPrompt).not.toContain("photo set")
    expect(photos.uploadPrompt).toContain("photo set")
    expect(photos.detail).toContain("photo set")
  })

  it("defaults to video wording when kind is omitted", () => {
    const s = editorWorkflowState({
      status: "draft",
      openCommentCount: 0,
      hasVersion: false,
    })
    expect(s.detail).toContain("cut")
  })

  it("closes the door on approved and locked, with no upload prompt", () => {
    for (const status of ["approved", "locked"] as const) {
      const s = editorWorkflowState({ status, openCommentCount: 2, hasVersion: true })
      expect(s.canUpload).toBe(false)
      expect(s.uploadPrompt).toBeNull()
      expect(s.tone).toBe("done")
    }
  })
})

describe("unsentFeedback", () => {
  it("flags open notes while the cut is still awaiting review", () => {
    const r = unsentFeedback({ status: "submitted", openCommentsOnCurrentVersion: 1 })
    expect(r.unsent).toBe(true)
    expect(r.message).toContain("1 open note")
    expect(r.message).toContain("hasn't been notified")
  })

  it("stays quiet once the revision has actually been requested", () => {
    // Status is the "sent" signal — nagging here would be a false alarm.
    expect(
      unsentFeedback({ status: "revision_requested", openCommentsOnCurrentVersion: 4 }).unsent,
    ).toBe(false)
  })

  it("stays quiet when there are no open notes on the current cut", () => {
    // The live Liam case: the open note sits on v1, the current version is v2.
    // The editor already saw and acted on it, so this must not nag.
    expect(
      unsentFeedback({ status: "submitted", openCommentsOnCurrentVersion: 0 }).unsent,
    ).toBe(false)
  })

  it("stays quiet on approved and locked submissions", () => {
    for (const status of ["approved", "locked", "draft"] as const) {
      expect(unsentFeedback({ status, openCommentsOnCurrentVersion: 3 }).unsent).toBe(false)
    }
  })

  it("pluralises", () => {
    expect(
      unsentFeedback({ status: "in_review", openCommentsOnCurrentVersion: 2 }).message,
    ).toContain("2 open notes")
  })
})
