import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const createAiJobMock = vi.fn()
const getVideoUploadByIdMock = vi.fn()
const getTranscriptForVideoMock = vi.fn()
const createDraftForVideoMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (x: unknown) => createAiJobMock(x) }))
vi.mock("@/lib/db/video-uploads", () => ({
  getVideoUploadById: (x: string) => getVideoUploadByIdMock(x),
}))
vi.mock("@/lib/db/video-transcripts", () => ({
  getTranscriptForVideo: (x: string) => getTranscriptForVideoMock(x),
}))
vi.mock("@/lib/db/blog-posts", () => ({
  createDraftForVideo: (x: unknown) => createDraftForVideoMock(x),
}))

import { POST } from "@/app/api/admin/blog-posts/generate-from-video/route"

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/blog-posts/generate-from-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/blog-posts/generate-from-video", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await POST(makeRequest({ video_upload_id: "v1" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when video_upload_id is missing", async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it("returns 404 when video does not exist", async () => {
    getVideoUploadByIdMock.mockResolvedValue(null)
    const res = await POST(makeRequest({ video_upload_id: "v1" }))
    expect(res.status).toBe(404)
  })

  it("returns 409 when transcript is missing", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", title: "t" })
    getTranscriptForVideoMock.mockResolvedValue(null)
    const res = await POST(makeRequest({ video_upload_id: "v1" }))
    expect(res.status).toBe(409)
  })

  it("creates draft + ai_job and returns 202", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", title: "t" })
    getTranscriptForVideoMock.mockResolvedValue({ transcript_text: "hello" })
    createDraftForVideoMock.mockResolvedValue({ id: "bp-99" })
    createAiJobMock.mockResolvedValue({ jobId: "job-1", status: "pending" })

    const res = await POST(
      makeRequest({ video_upload_id: "v1", tone: "professional", length: "medium" }),
    )
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.blog_post_id).toBe("bp-99")

    expect(createDraftForVideoMock).toHaveBeenCalledWith({
      authorId: "admin-1",
      videoUploadId: "v1",
    })
    expect(createAiJobMock).toHaveBeenCalledWith({
      type: "blog_from_video",
      userId: "admin-1",
      input: {
        video_upload_id: "v1",
        blog_post_id: "bp-99",
        tone: "professional",
        length: "medium",
      },
    })
  })
})
