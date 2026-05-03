import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getCalendarEntryById: vi.fn(),
  jobSet: vi.fn(),
  jobDoc: vi.fn(),
  jobCollection: vi.fn(),
  getAdminFirestore: vi.fn(),
  proposePrimaryKeyword: vi.fn().mockResolvedValue("youth pitching velocity"),
}))
mocks.jobDoc.mockImplementation(() => ({ set: mocks.jobSet, id: "new-job-id" }))
mocks.jobCollection.mockImplementation(() => ({ doc: mocks.jobDoc }))
mocks.getAdminFirestore.mockImplementation(() => ({ collection: mocks.jobCollection }))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/db/content-calendar", () => ({
  getCalendarEntryById: mocks.getCalendarEntryById,
}))
vi.mock("@/lib/firebase-admin", () => ({ getAdminFirestore: mocks.getAdminFirestore }))
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }))
vi.mock("@/lib/blog/keyword-proposal", () => ({
  proposePrimaryKeyword: mocks.proposePrimaryKeyword,
}))

import { POST } from "@/app/api/admin/blog/generate-from-suggestion/route"

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/blog/generate-from-suggestion", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/blog/generate-from-suggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.jobSet.mockResolvedValue(undefined)
    mocks.jobDoc.mockImplementation(() => ({ set: mocks.jobSet, id: "new-job-id" }))
    mocks.jobCollection.mockImplementation(() => ({ doc: mocks.jobDoc }))
    mocks.getAdminFirestore.mockImplementation(() => ({ collection: mocks.jobCollection }))
    mocks.proposePrimaryKeyword.mockResolvedValue("youth pitching velocity")
  })

  it("403 when not admin", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "client" } })
    const res = await POST(jsonRequest({ calendarId: "cal-1" }))
    expect(res.status).toBe(403)
  })

  it("400 when calendarId missing", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    const res = await POST(jsonRequest({}))
    expect(res.status).toBe(400)
  })

  it("404 when calendar entry missing or wrong type", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    mocks.getCalendarEntryById.mockResolvedValueOnce(null)
    const res = await POST(jsonRequest({ calendarId: "cal-1" }))
    expect(res.status).toBe(404)
  })

  it("202 enqueues ai_jobs with sourceCalendarId and tavily_url reference", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    mocks.getCalendarEntryById.mockResolvedValueOnce({
      id: "cal-1",
      entry_type: "topic_suggestion",
      title: "RFD recovery",
      metadata: { tavily_url: "https://example.com/study", summary: "Study summary" },
      status: "planned",
    })
    const res = await POST(jsonRequest({ calendarId: "cal-1", tone: "professional", length: "medium" }))
    expect(res.status).toBe(202)
    expect(mocks.jobSet).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "blog_generation",
        status: "pending",
        input: expect.objectContaining({
          prompt: expect.stringContaining("RFD recovery"),
          register: "formal",
          length: "medium",
          primary_keyword: "youth pitching velocity",
          userId: "u1",
          sourceCalendarId: "cal-1",
          references: { urls: ["https://example.com/study"] },
        }),
      }),
    )
  })

  it("uses default tone/length when not provided", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    mocks.getCalendarEntryById.mockResolvedValueOnce({
      id: "cal-1",
      entry_type: "topic_suggestion",
      title: "x",
      metadata: {},
    })
    await POST(jsonRequest({ calendarId: "cal-1" }))
    expect(mocks.jobSet).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ register: "casual", length: "medium" }),
      }),
    )
  })

  it("500 when an unexpected error is thrown during processing", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1", role: "admin" } })
    mocks.getCalendarEntryById.mockRejectedValueOnce(new Error("Supabase exploded"))
    const res = await POST(jsonRequest({ calendarId: "cal-1" }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/internal/i)
  })

  it("calls proposePrimaryKeyword once per request", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1", role: "admin" } })
    mocks.getCalendarEntryById.mockResolvedValue({
      id: "cal-1",
      entry_type: "topic_suggestion",
      title: "Topic title",
      metadata: { summary: "summary" },
    })
    const res = await POST(jsonRequest({ calendarId: "cal-1" }))
    expect(res.status).toBe(202)
    expect(mocks.proposePrimaryKeyword).toHaveBeenCalledTimes(1)
    expect(mocks.proposePrimaryKeyword).toHaveBeenCalledWith({
      title: "Topic title",
      summary: "summary",
    })
  })
})
