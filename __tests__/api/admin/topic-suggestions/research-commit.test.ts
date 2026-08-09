import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createResearchedTopicSuggestions: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/db/content-calendar", () => ({
  createResearchedTopicSuggestions: mocks.createResearchedTopicSuggestions,
}))

import { POST } from "@/app/api/admin/topic-suggestions/research/commit/route"

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/topic-suggestions/research/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const sampleTopic = {
  title: "BFR training accelerates return-to-play hypertrophy",
  summary: "Low-load BFR preserves cross-sectional area during restricted loading phases.",
  tavily_url: "https://journal.example/bfr-study",
  rank: 1,
}

describe("POST /api/admin/topic-suggestions/research/commit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createResearchedTopicSuggestions.mockResolvedValue([{ id: "entry-1", ...sampleTopic }])
  })

  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValueOnce(null)
    const res = await POST(jsonRequest({ topics: [sampleTopic] }))
    expect(res.status).toBe(401)
    expect(mocks.createResearchedTopicSuggestions).not.toHaveBeenCalled()
  })

  it("returns 400 when topics is empty", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    const res = await POST(jsonRequest({ topics: [] }))
    expect(res.status).toBe(400)
    expect(mocks.createResearchedTopicSuggestions).not.toHaveBeenCalled()
  })

  it("returns 400 when a topic is missing a valid tavily_url", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    const res = await POST(jsonRequest({ topics: [{ ...sampleTopic, tavily_url: "not-a-url" }] }))
    expect(res.status).toBe(400)
    expect(mocks.createResearchedTopicSuggestions).not.toHaveBeenCalled()
  })

  it("inserts the selected topics and returns 201 for an admin", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    const res = await POST(jsonRequest({ topics: [sampleTopic] }))
    expect(res.status).toBe(201)
    expect(mocks.createResearchedTopicSuggestions).toHaveBeenCalledWith(
      [sampleTopic],
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    )
  })
})
