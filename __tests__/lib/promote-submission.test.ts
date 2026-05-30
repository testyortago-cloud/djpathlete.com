// __tests__/lib/promote-submission.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadBySubmission: vi.fn(),
  createVideoUpload: vi.fn(),
}))
vi.mock("@/lib/db/team-video-submissions", () => ({
  getSubmissionById: vi.fn(),
  lockSubmission: vi.fn(),
}))
vi.mock("@/lib/db/team-video-versions", () => ({ getCurrentVersion: vi.fn() }))
vi.mock("@/lib/db/video-transcripts", () => ({ getSpeechTranscriptForVideo: vi.fn() }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: vi.fn() }))

import { resolveVideoUploadForSubmission } from "@/lib/content-studio/promote-submission"
import { getVideoUploadBySubmission, createVideoUpload } from "@/lib/db/video-uploads"
import { getSubmissionById, lockSubmission } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { getSpeechTranscriptForVideo } from "@/lib/db/video-transcripts"
import { createAiJob } from "@/lib/ai-jobs"

const SUB = "sub-1"
beforeEach(() => vi.clearAllMocks())

describe("resolveVideoUploadForSubmission", () => {
  it("reuses an existing video_uploads row and reports transcribed=true", async () => {
    ;(getVideoUploadBySubmission as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "vu-1" })
    ;(getSpeechTranscriptForVideo as ReturnType<typeof vi.fn>).mockResolvedValue({ assemblyai_job_id: "aa" })
    const out = await resolveVideoUploadForSubmission(SUB, "admin-1")
    expect(out).toEqual({ videoUploadId: "vu-1", transcribed: true })
    expect(createVideoUpload).not.toHaveBeenCalled()
    expect(createAiJob).not.toHaveBeenCalled()
  })

  it("reuses an existing row and reports transcribed=false when no speech transcript yet", async () => {
    ;(getVideoUploadBySubmission as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "vu-2" })
    ;(getSpeechTranscriptForVideo as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const out = await resolveVideoUploadForSubmission(SUB, "admin-1")
    expect(out).toEqual({ videoUploadId: "vu-2", transcribed: false })
    expect(createVideoUpload).not.toHaveBeenCalled()
  })

  it("throws when the submission does not exist", async () => {
    ;(getVideoUploadBySubmission as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await expect(resolveVideoUploadForSubmission(SUB, "admin-1")).rejects.toThrow(/not found/i)
  })

  it("rejects a non-approved/locked submission", async () => {
    ;(getVideoUploadBySubmission as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: SUB, status: "submitted" })
    await expect(resolveVideoUploadForSubmission(SUB, "admin-1")).rejects.toThrow(/approved/i)
  })

  it("throws when the current version has no uploaded file", async () => {
    ;(getVideoUploadBySubmission as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: SUB, status: "approved", title: "X" })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ storage_path: null, original_filename: null })
    await expect(resolveVideoUploadForSubmission(SUB, "admin-1")).rejects.toThrow(/no uploaded video/i)
  })

  it("creates the row, locks, queues transcription, reports transcribed=false", async () => {
    ;(getVideoUploadBySubmission as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(getSubmissionById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: SUB, status: "approved", title: "Lift",
    })
    ;(getCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({
      storage_path: "team-videos/x.mp4", original_filename: "x.mp4",
      duration_seconds: 20, size_bytes: 100, mime_type: "video/mp4",
    })
    ;(createVideoUpload as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "vu-new" })

    const out = await resolveVideoUploadForSubmission(SUB, "admin-1")

    expect(out).toEqual({ videoUploadId: "vu-new", transcribed: false })
    expect(createVideoUpload).toHaveBeenCalledWith(
      expect.objectContaining({ source_submission_id: SUB, status: "uploaded", storage_path: "team-videos/x.mp4" }),
    )
    expect(lockSubmission).toHaveBeenCalledWith(SUB)
    expect(createAiJob).toHaveBeenCalledWith({
      type: "video_transcription",
      userId: "admin-1",
      input: { videoUploadId: "vu-new" },
    })
  })
})
