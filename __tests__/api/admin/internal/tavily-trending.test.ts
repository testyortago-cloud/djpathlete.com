import { describe, it, expect, vi, beforeEach } from "vitest"

const createAiJobMock = vi.fn()

vi.mock("@/lib/ai-jobs", () => ({ createAiJob: (x: unknown) => createAiJobMock(x) }))

// Set INTERNAL_CRON_TOKEN before importing the route
process.env.INTERNAL_CRON_TOKEN = "test-token-xyz"

import { POST } from "@/app/api/admin/internal/tavily-trending/route"

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/admin/internal/tavily-trending", {
    method: "POST",
    headers,
  })
}

describe("POST /api/admin/internal/tavily-trending", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createAiJobMock.mockResolvedValue({ jobId: "job-1", status: "pending" })
  })

  it("returns 401 when Authorization header missing", async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    expect(createAiJobMock).not.toHaveBeenCalled()
  })

  it("returns 401 when bearer token is wrong", async () => {
    const res = await POST(makeRequest({ Authorization: "Bearer wrong-token" }))
    expect(res.status).toBe(401)
    expect(createAiJobMock).not.toHaveBeenCalled()
  })

  it("returns 202 and creates ai_job when bearer token matches", async () => {
    const res = await POST(makeRequest({ Authorization: "Bearer test-token-xyz" }))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("job-1")

    expect(createAiJobMock).toHaveBeenCalledWith({
      type: "tavily_trending_scan",
      userId: "__cron__",
      input: {},
    })
  })
})
