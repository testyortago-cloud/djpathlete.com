import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createManualTopicSuggestion: vi.fn(),
  addScanTopic: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/db/content-calendar", () => ({ createManualTopicSuggestion: mocks.createManualTopicSuggestion }))
vi.mock("@/lib/blog/scan-topics-store", () => ({ addScanTopic: mocks.addScanTopic }))

import { POST } from "@/app/api/admin/topic-suggestions/custom/route"

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/admin/topic-suggestions/custom", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )

const title = "Rotational power for golfers: medicine-ball protocols"

describe("POST /api/admin/topic-suggestions/custom", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z")) // a Tuesday
    mocks.auth.mockResolvedValue({ user: { id: "u1", role: "admin" } })
    mocks.createManualTopicSuggestion.mockResolvedValue({ id: "e1", title })
    mocks.addScanTopic.mockResolvedValue("on")
  })
  afterEach(() => vi.useRealTimers())

  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValueOnce(null)
    expect((await post({ title })).status).toBe(401)
    expect(mocks.createManualTopicSuggestion).not.toHaveBeenCalled()
  })

  it("adds the card in this week's brief and the title to the weekly scan topics", async () => {
    const res = await post({ title })
    expect(res.status).toBe(201)
    expect(mocks.createManualTopicSuggestion).toHaveBeenCalledWith(title, "2026-11-09")
    expect(mocks.addScanTopic).toHaveBeenCalledWith(title, "manual", "u1")
    expect(await res.json()).toMatchObject({ id: "e1", scan_topic: "on" })
  })

  it("still adds the card when the scan topic cannot be saved", async () => {
    mocks.addScanTopic.mockRejectedValueOnce(new Error("settings write failed"))
    const res = await post({ title })
    expect(res.status).toBe(201)
    expect((await res.json()).scan_topic).toBeNull()
  })
})
