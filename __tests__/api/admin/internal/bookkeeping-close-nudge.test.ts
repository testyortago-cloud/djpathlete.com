import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: vi.fn(), logCronEnd: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listBooks: vi.fn(),
  listCloses: vi.fn(),
  listEntriesForReports: vi.fn(),
}))
vi.mock("@/lib/bookkeeping/email-close-nudge", async () => {
  // Keep the REAL totalOpenMonths — the audit metadata's count must be computed,
  // not echoed back by a stub.
  const actual = await vi.importActual<typeof import("@/lib/bookkeeping/email-close-nudge")>(
    "@/lib/bookkeeping/email-close-nudge",
  )
  return { ...actual, sendCloseNudgeEmail: vi.fn() }
})
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { isCronSkipped } from "@/lib/db/system-settings"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { listBooks, listCloses, listEntriesForReports } from "@/lib/db/bookkeeping"
import { sendCloseNudgeEmail } from "@/lib/bookkeeping/email-close-nudge"
import { recordAudit } from "@/lib/audit/record"
import { POST } from "@/app/api/admin/internal/bookkeeping-close-nudge/route"

const TOKEN = "test-cron-token"
const AUTH = `Bearer ${TOKEN}`
const BOOK = "b0000000-0000-4000-8000-000000000001"

// The route reads the wall clock, so fixtures are pinned RELATIVE to now:
// the 15th of last month is always a finished, in-lookback, closable month.
const now = new Date()
const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15))
const LAST_MONTH_DAY = lastMonthDate.toISOString().slice(0, 10)
const LAST_PERIOD = LAST_MONTH_DAY.slice(0, 7)
const THIS_MONTH_DAY = `${now.toISOString().slice(0, 7)}-01`

const books = [{ id: BOOK, name: "Darren — DJP Athlete" }]
const entry = (occurred_on: string, over: Record<string, unknown> = {}) => ({
  book_id: BOOK,
  account_id: null,
  direction: "income",
  amount_cents: 25000,
  occurred_on,
  counterparty: null,
  memo: null,
  source: "manual",
  ...over,
})

function makeRequest(authHeader = AUTH): Request {
  return new Request("http://localhost/api/admin/internal/bookkeeping-close-nudge", {
    method: "POST",
    headers: { authorization: authHeader },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = TOKEN
  ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: false })
  ;(logCronStart as ReturnType<typeof vi.fn>).mockResolvedValue("run-1")
  ;(logCronEnd as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  ;(listBooks as ReturnType<typeof vi.fn>).mockResolvedValue(books)
  ;(listCloses as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(listEntriesForReports as ReturnType<typeof vi.fn>).mockResolvedValue([entry(LAST_MONTH_DAY)])
  ;(sendCloseNudgeEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null })
})

describe("POST /api/admin/internal/bookkeeping-close-nudge", () => {
  it("401 with a missing bearer token", async () => {
    const res = await POST(makeRequest(""))
    expect(res.status).toBe(401)
    expect(isCronSkipped).not.toHaveBeenCalled()
  })

  it("401 with a wrong bearer token", async () => {
    expect((await POST(makeRequest("Bearer wrong"))).status).toBe(401)
  })

  it("200 {skipped} with no logCronStart when the flag is off", async () => {
    ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: true, reason: "disabled" })
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).skipped).toBe("disabled")
    expect(logCronStart).not.toHaveBeenCalled()
    expect(sendCloseNudgeEmail).not.toHaveBeenCalled()
  })

  it("defaults the flag to OFF — a missing setting must not email", async () => {
    await POST(makeRequest())
    expect(isCronSkipped).toHaveBeenCalledWith(
      expect.objectContaining({
        enabledKey: "cron_bookkeeping_close_nudge_enabled",
        defaultEnabled: false,
      }),
    )
  })

  it("emails the nudge for last month and audits the real open-month count", async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, open_months: 1, emailed: true })

    const sent = (sendCloseNudgeEmail as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(sent.nudges).toHaveLength(1)
    expect(sent.nudges[0].open_months.map((m: { period: string }) => m.period)).toEqual([LAST_PERIOD])
    // REAL snapshotTotals over the mocked entry — a sign flip or merged sum shows here
    expect(sent.nudges[0].open_months[0]).toMatchObject({
      income_cents: 25000,
      expense_cents: 0,
      net_cents: 25000,
      entry_count: 1,
    })

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bookkeeping.close_nudge_emailed",
        outcome: "success",
        actor: expect.objectContaining({ role: "system" }),
        metadata: expect.objectContaining({ open_months: 1, books: 1 }),
      }),
    )
    expect(logCronEnd).toHaveBeenCalledWith({}, "run-1", "success", { open_months: 1, emailed: true })
  })

  it("reads a window that starts before last month and ends today", async () => {
    await POST(makeRequest())
    const [from, to] = (listEntriesForReports as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(from < LAST_MONTH_DAY).toBe(true)
    expect(to).toBe(new Date().toISOString().slice(0, 10))
  })

  it("no open months → success with no email sent", async () => {
    ;(listCloses as ReturnType<typeof vi.fn>).mockResolvedValue([{ book_id: BOOK, period: LAST_PERIOD }])
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, open_months: 0 })
    expect(sendCloseNudgeEmail).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
    expect(logCronEnd).toHaveBeenCalledWith({}, "run-1", "success", { open_months: 0 })
  })

  it("the current month alone is never a reason to email", async () => {
    ;(listEntriesForReports as ReturnType<typeof vi.fn>).mockResolvedValue([entry(THIS_MONTH_DAY)])
    const res = await POST(makeRequest())
    expect((await res.json()).open_months).toBe(0)
    expect(sendCloseNudgeEmail).not.toHaveBeenCalled()
  })

  it("a send failure fails the run loudly (500 + failed cron_runs)", async () => {
    ;(sendCloseNudgeEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ error: "COACH_EMAIL not configured" })
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe("COACH_EMAIL not configured")
    expect(logCronEnd).toHaveBeenCalledWith({}, "run-1", "failed", { message: "COACH_EMAIL not configured" })
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("a DAL failure fails the run loudly", async () => {
    ;(listEntriesForReports as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"))
    expect((await POST(makeRequest())).status).toBe(500)
    expect(logCronEnd).toHaveBeenCalledWith({}, "run-1", "failed", { message: "db down" })
  })
})
