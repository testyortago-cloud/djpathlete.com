// __tests__/api/admin/internal/send-daily-pulse.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const buildDailyPulseMock = vi.fn()
const resendSendMock = vi.fn()

vi.mock("@/lib/analytics/daily-pulse", () => ({
  buildDailyPulse: (opts: unknown) => buildDailyPulseMock(opts),
}))
vi.mock("@/lib/resend", () => ({
  resend: {
    emails: {
      send: (args: unknown) => resendSendMock(args),
    },
  },
  FROM_EMAIL: "DJP Athlete <noreply@test>",
}))

import { POST } from "@/app/api/admin/internal/send-daily-pulse/route"

const TOKEN = "test-token-abc"
const AUTH = `Bearer ${TOKEN}`

function makeRequest(body: unknown, authHeader = AUTH): Request {
  return new Request("http://localhost/api/admin/internal/send-daily-pulse", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authHeader },
    body: JSON.stringify(body),
  })
}

const basePulse = {
  subject: "Daily Brief — Tue, Apr 21",
  html: "<html>...</html>",
  referenceDate: new Date("2026-04-21T07:00:00Z"),
  isMondayEdition: false,
  payload: {
    referenceDate: new Date("2026-04-21T07:00:00Z"),
    isMondayEdition: false,
    bookings: null,
    coaching: null,
    pipeline: {
      awaitingReview: 2, readyToPublish: 1, scheduledToday: 0,
      videosAwaitingTranscription: 3, blogsInDraft: 1,
    },
    revenueFunnel: null,
    anomalies: null,
    trendingTopics: [],
    dashboardUrl: "http://localhost:3050/admin/content",
  },
}

describe("POST /api/admin/internal/send-daily-pulse", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INTERNAL_CRON_TOKEN = TOKEN
    process.env.RESEND_API_KEY = "re_test"
    process.env.COACH_EMAIL = "coach@example.com"
    buildDailyPulseMock.mockResolvedValue(basePulse)
  })

  it("returns 401 without a valid bearer token", async () => {
    const res = await POST(makeRequest({}, "Bearer wrong"))
    expect(res.status).toBe(401)
  })

  it("returns 500 when neither COACH_EMAIL nor 'to' is provided", async () => {
    delete process.env.COACH_EMAIL
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(500)
    expect(resendSendMock).not.toHaveBeenCalled()
  })

  it("sends the pulse to COACH_EMAIL by default", async () => {
    resendSendMock.mockResolvedValue({ error: null })
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sentTo).toBe("coach@example.com")
    expect(body.isMondayEdition).toBe(false)
    expect(resendSendMock).toHaveBeenCalledWith({
      from: "DJP Athlete <noreply@test>",
      to: "coach@example.com",
      subject: "Daily Brief — Tue, Apr 21",
      html: "<html>...</html>",
    })
  })

  it("honors the 'to' override", async () => {
    resendSendMock.mockResolvedValue({ error: null })
    await POST(makeRequest({ to: "other@example.com" }))
    expect(resendSendMock).toHaveBeenCalledWith(expect.objectContaining({ to: "other@example.com" }))
  })

  it("returns html + counts without sending when dryRun=true", async () => {
    const res = await POST(makeRequest({ dryRun: true }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.html).toContain("<html")
    expect(body.payload.pipeline.awaitingReview).toBe(2)
    expect(resendSendMock).not.toHaveBeenCalled()
  })

  it("passes forceMonday + referenceDate through to the builder", async () => {
    await POST(makeRequest({ dryRun: true, forceMonday: true, referenceDate: "2026-04-14T00:00:00.000Z" }))
    expect(buildDailyPulseMock).toHaveBeenCalledWith({
      forceMonday: true,
      referenceDate: expect.any(Date),
    })
  })

  it("returns 502 when Resend returns an error", async () => {
    resendSendMock.mockResolvedValue({ error: { message: "rate limited" } })
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(502)
  })

  it("returns 500 on an unexpected build error", async () => {
    buildDailyPulseMock.mockRejectedValue(new Error("db down"))
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(500)
  })
})
