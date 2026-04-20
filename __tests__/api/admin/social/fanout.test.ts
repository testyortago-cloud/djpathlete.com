// __tests__/api/admin/social/fanout.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const createAiJobMock = vi.fn()
const getVideoUploadByIdMock = vi.fn()
const getTranscriptForVideoMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (x: unknown) => createAiJobMock(x) }))
vi.mock("@/lib/db/video-uploads", () => ({ getVideoUploadById: (x: string) => getVideoUploadByIdMock(x) }))
vi.mock("@/lib/db/video-transcripts", () => ({
  getTranscriptForVideo: (x: string) => getTranscriptForVideoMock(x),
}))

import { POST } from "@/app/api/admin/social/fanout/route"

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/social/fanout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/social/fanout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("returns 401 when not admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "c", role: "client" } })
    const res = await POST(makeRequest({ videoUploadId: "v1" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when videoUploadId missing", async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it("returns 404 when the video doesn't exist", async () => {
    getVideoUploadByIdMock.mockResolvedValue(null)
    const res = await POST(makeRequest({ videoUploadId: "v1" }))
    expect(res.status).toBe(404)
  })

  it("returns 409 when no transcript is available", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", status: "uploaded" })
    getTranscriptForVideoMock.mockResolvedValue(null)
    const res = await POST(makeRequest({ videoUploadId: "v1" }))
    expect(res.status).toBe(409)
    expect(await res.text()).toContain("transcript")
  })

  it("creates a social_fanout ai_job when video + transcript are ready", async () => {
    getVideoUploadByIdMock.mockResolvedValue({ id: "v1", status: "transcribed" })
    getTranscriptForVideoMock.mockResolvedValue({ id: "t1", transcript_text: "hello" })
    createAiJobMock.mockResolvedValue({ jobId: "job-1", status: "pending" })

    const res = await POST(makeRequest({ videoUploadId: "v1" }))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("job-1")

    expect(createAiJobMock).toHaveBeenCalledWith({
      type: "social_fanout",
      userId: "admin-1",
      input: { videoUploadId: "v1" },
    })
  })
})
