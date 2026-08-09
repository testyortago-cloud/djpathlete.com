import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createAiJob: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: mocks.createAiJob }))

import { POST } from "@/app/api/admin/topic-suggestions/research/route"

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/topic-suggestions/research", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/topic-suggestions/research", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createAiJob.mockResolvedValue({ jobId: "job-1", status: "pending" })
  })

  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValueOnce(null)
    const res = await POST(jsonRequest({ topic: "blood flow restriction training" }))
    expect(res.status).toBe(401)
    expect(mocks.createAiJob).not.toHaveBeenCalled()
  })

  it("returns 401 for a non-admin session", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "client" } })
    const res = await POST(jsonRequest({ topic: "blood flow restriction training" }))
    expect(res.status).toBe(401)
    expect(mocks.createAiJob).not.toHaveBeenCalled()
  })

  it("returns 400 for a too-short topic", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    const res = await POST(jsonRequest({ topic: "hi" }))
    expect(res.status).toBe(400)
    expect(mocks.createAiJob).not.toHaveBeenCalled()
  })

  it("creates a topic_research_scan job and returns 202 for an admin", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    const res = await POST(jsonRequest({ topic: "blood flow restriction training" }))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("job-1")
    expect(mocks.createAiJob).toHaveBeenCalledWith({
      type: "topic_research_scan",
      userId: "u1",
      input: { topic: "blood flow restriction training" },
    })
  })
})
