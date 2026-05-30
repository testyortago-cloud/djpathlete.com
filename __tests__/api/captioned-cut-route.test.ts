import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn() }))
vi.mock("@/lib/db/video-uploads", () => ({ getVideoUploadById: vi.fn() }))
vi.mock("@/lib/db/video-transcripts", () => ({ getSpeechTranscriptForVideo: vi.fn() }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: vi.fn(), findInFlightCaptionRender: vi.fn() }))
vi.mock("@/lib/content-studio/promote-submission", () => ({
  resolveVideoUploadForSubmission: vi.fn(),
}))

import { POST } from "@/app/api/admin/content-studio/captioned-cut/route"
import { auth } from "@/lib/auth"
import { getSetting } from "@/lib/db/system-settings"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getSpeechTranscriptForVideo } from "@/lib/db/video-transcripts"
import { createAiJob, findInFlightCaptionRender } from "@/lib/ai-jobs"
import { resolveVideoUploadForSubmission } from "@/lib/content-studio/promote-submission"

const UUID = "11111111-1111-1111-1111-111111111111"
const admin = { user: { id: "admin-1", role: "admin" } }

function req(body: unknown) {
  return new Request("http://test/api/admin/content-studio/captioned-cut", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin)
  ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(true) // flag on
  ;(getVideoUploadById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: UUID })
  ;(getSpeechTranscriptForVideo as ReturnType<typeof vi.fn>).mockResolvedValue({
    assemblyai_job_id: "aa_1",
    source: "speech",
  })
  ;(findInFlightCaptionRender as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(createAiJob as ReturnType<typeof vi.fn>).mockResolvedValue({ jobId: "job-1", status: "pending" })
})

describe("POST /api/admin/content-studio/captioned-cut", () => {
  it("401 for non-admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(req({ videoUploadId: UUID }))).status).toBe(401)
  })

  it("403 when the feature flag is off", async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    expect((await POST(req({ videoUploadId: UUID }))).status).toBe(403)
  })

  it("400 on an invalid payload (both ids)", async () => {
    expect((await POST(req({ videoUploadId: UUID, submissionId: UUID }))).status).toBe(400)
  })

  it("404 when the video is missing", async () => {
    ;(getVideoUploadById as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(req({ videoUploadId: UUID }))).status).toBe(404)
  })

  it("422 when there is no speech transcript", async () => {
    ;(getSpeechTranscriptForVideo as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(req({ videoUploadId: UUID }))).status).toBe(422)
  })

  it("200 + existing jobId when a render is already in flight", async () => {
    ;(findInFlightCaptionRender as ReturnType<typeof vi.fn>).mockResolvedValue("inflight-9")
    const res = await POST(req({ videoUploadId: UUID }))
    expect(res.status).toBe(200)
    expect((await res.json()).jobId).toBe("inflight-9")
    expect(createAiJob).not.toHaveBeenCalled()
  })

  it("202 + new jobId on the happy path", async () => {
    const res = await POST(req({ videoUploadId: UUID }))
    expect(res.status).toBe(202)
    expect((await res.json()).jobId).toBe("job-1")
    expect(createAiJob).toHaveBeenCalledWith({
      type: "video_caption_render",
      userId: "admin-1",
      input: { videoUploadId: UUID },
    })
  })
})

describe("POST /api/admin/content-studio/captioned-cut — submission branch", () => {
  it("409 when the promoted submission is not transcribed yet", async () => {
    ;(resolveVideoUploadForSubmission as ReturnType<typeof vi.fn>).mockResolvedValue({
      videoUploadId: UUID,
      transcribed: false,
    })
    const res = await POST(req({ submissionId: UUID }))
    expect(res.status).toBe(409)
    expect(createAiJob).not.toHaveBeenCalled()
  })

  it("409 when promote-or-reuse throws (e.g. not approved)", async () => {
    ;(resolveVideoUploadForSubmission as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Only approved submissions can be sent to Content Studio"),
    )
    const res = await POST(req({ submissionId: UUID }))
    expect(res.status).toBe(409)
  })

  it("202 + jobId when the submission already has a transcript", async () => {
    ;(resolveVideoUploadForSubmission as ReturnType<typeof vi.fn>).mockResolvedValue({
      videoUploadId: UUID,
      transcribed: true,
    })
    const res = await POST(req({ submissionId: UUID }))
    expect(res.status).toBe(202)
    expect(createAiJob).toHaveBeenCalledWith({
      type: "video_caption_render",
      userId: "admin-1",
      input: { videoUploadId: UUID },
    })
  })
})
