// __tests__/api/admin/internal/send-weekly-report.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const buildWeeklyReportMock = vi.fn()
const resendSendMock = vi.fn()
const isCronSkippedMock = vi.fn()

vi.mock("@/lib/analytics/weekly-report", () => ({
  buildWeeklyReport: (opts: unknown) => buildWeeklyReportMock(opts),
}))
vi.mock("@/lib/resend", () => ({
  resend: {
    emails: {
      send: (args: unknown) => resendSendMock(args),
    },
  },
  FROM_EMAIL: "DJP Athlete <noreply@test>",
}))
vi.mock("@/lib/db/system-settings", () => ({
  isCronSkipped: (args: unknown) => isCronSkippedMock(args),
}))

import { POST } from "@/app/api/admin/internal/send-weekly-report/route"

const TOKEN = "test-token-abc"
const AUTH = `Bearer ${TOKEN}`

function makeRequest(body: unknown, authHeader = AUTH): Request {
  return new Request("http://localhost/api/admin/internal/send-weekly-report", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authHeader },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/internal/send-weekly-report", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INTERNAL_CRON_TOKEN = TOKEN
    process.env.RESEND_API_KEY = "re_test"
    process.env.COACH_EMAIL = "coach@example.com"
    isCronSkippedMock.mockResolvedValue({ skipped: false })
    buildWeeklyReportMock.mockResolvedValue({
      subject: "Weekly Review — Week of Apr 14",
      html: "<html>...</html>",
      rangeStart: new Date("2026-04-14T00:00:00Z"),
      rangeEnd: new Date("2026-04-21T00:00:00Z"),
      payload: {
        rangeStart: new Date("2026-04-14T00:00:00Z"),
        rangeEnd: new Date("2026-04-21T00:00:00Z"),
        topOfMind: [{ text: "Quiet week across the board.", positive: null }],
        coaching: null, revenue: null, funnel: null,
        social: {} as any, content: {} as any,
        opsHealth: null,
        dashboardUrl: "http://localhost:3050/admin/analytics?tab=social",
      },
    })
  })

  it("returns 401 without a valid bearer token", async () => {
    const res = await POST(makeRequest({}, "Bearer wrong"))
    expect(res.status).toBe(401)
  })

  it("returns 500 when neither COACH_EMAIL nor 'to' override is provided", async () => {
    delete process.env.COACH_EMAIL
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(500)
    expect(resendSendMock).not.toHaveBeenCalled()
  })

  it("sends the report to COACH_EMAIL by default", async () => {
    resendSendMock.mockResolvedValue({ error: null })
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sentTo).toBe("coach@example.com")
    expect(resendSendMock).toHaveBeenCalledWith({
      from: "DJP Athlete <noreply@test>",
      to: "coach@example.com",
      subject: "Weekly Review — Week of Apr 14",
      html: "<html>...</html>",
    })
  })

  it("honors the 'to' override", async () => {
    resendSendMock.mockResolvedValue({ error: null })
    const res = await POST(makeRequest({ to: "other@example.com" }))
    expect(res.status).toBe(200)
    expect(resendSendMock).toHaveBeenCalledWith(expect.objectContaining({ to: "other@example.com" }))
  })

  it("returns the rendered html without sending when dryRun=true", async () => {
    const res = await POST(makeRequest({ dryRun: true }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.html).toContain("<html")
    expect(resendSendMock).not.toHaveBeenCalled()
  })

  it("passes rangeEnd through to buildWeeklyReport when provided", async () => {
    const res = await POST(makeRequest({ dryRun: true, rangeEnd: "2026-04-18T00:00:00.000Z" }))
    expect(res.status).toBe(200)
    expect(buildWeeklyReportMock).toHaveBeenCalledWith({
      rangeEnd: expect.any(Date),
    })
  })

  it("returns 502 when Resend returns an error", async () => {
    resendSendMock.mockResolvedValue({ error: { message: "rate limited" } })
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(502)
  })

  it("returns 500 on an unexpected build error", async () => {
    buildWeeklyReportMock.mockRejectedValue(new Error("db down"))
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(500)
  })
})
