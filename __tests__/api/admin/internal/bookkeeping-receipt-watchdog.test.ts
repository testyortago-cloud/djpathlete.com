import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock("@/lib/db/cron-runs", () => ({ logCronStart: vi.fn(), logCronEnd: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({ listEntriesForInsights: vi.fn(), listAccountsForInsights: vi.fn() }))
vi.mock("@/lib/bookkeeping/email-watchdog", () => ({
  sendReceiptWatchdogEmail: vi.fn(),
  WATCHDOG_EMAIL_ROW_CAP: 25,
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { isCronSkipped } from "@/lib/db/system-settings"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { listAccountsForInsights, listEntriesForInsights } from "@/lib/db/bookkeeping"
import { sendReceiptWatchdogEmail } from "@/lib/bookkeeping/email-watchdog"
import { recordAudit } from "@/lib/audit/record"
import { POST } from "@/app/api/admin/internal/bookkeeping-receipt-watchdog/route"

const TOKEN = "test-cron-token"
const AUTH = `Bearer ${TOKEN}`
const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACC_WATCHED = "a0000000-0000-4000-8000-000000000001"

const accounts = [
  { id: ACC_WATCHED, book_id: BOOK, name: "Equipment", account_type: "expense", service_line: null, tax_category: null, sort_order: 0, is_deductible_candidate: true, requires_business_purpose: false, archived_at: null },
]
// Far-past date → aged no matter when the suite runs; document missing → a REAL finding
// through the REAL (unmocked) pure finder.
const agedEntry = {
  id: "e0000000-0000-4000-8000-000000000001", book_id: BOOK, account_id: ACC_WATCHED,
  direction: "expense", amount_cents: 5000, occurred_on: "2020-06-01", counterparty: "Rogue",
  memo: null, source: "manual", business_purpose: null, document_id: null,
}

function makeRequest(authHeader = AUTH): Request {
  return new Request("http://localhost/api/admin/internal/bookkeeping-receipt-watchdog", {
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
  ;(listEntriesForInsights as ReturnType<typeof vi.fn>).mockResolvedValue([agedEntry])
  ;(listAccountsForInsights as ReturnType<typeof vi.fn>).mockResolvedValue(accounts)
  ;(sendReceiptWatchdogEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null })
})

describe("POST /api/admin/internal/bookkeeping-receipt-watchdog", () => {
  it("401 with a missing bearer token", async () => {
    const res = await POST(makeRequest(""))
    expect(res.status).toBe(401)
    expect(isCronSkipped).not.toHaveBeenCalled()
  })

  it("401 with a wrong bearer token", async () => {
    const res = await POST(makeRequest("Bearer wrong"))
    expect(res.status).toBe(401)
  })

  it("200 {skipped} with no logCronStart when the flag is off (success-skip)", async () => {
    ;(isCronSkipped as ReturnType<typeof vi.fn>).mockResolvedValue({ skipped: true, reason: "disabled" })
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).skipped).toBe("disabled")
    expect(logCronStart).not.toHaveBeenCalled()
    expect(sendReceiptWatchdogEmail).not.toHaveBeenCalled()
  })

  it("empty findings → success-skip, NO email, logCronEnd success {findings: 0}", async () => {
    ;(listEntriesForInsights as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).findings).toBe(0)
    expect(sendReceiptWatchdogEmail).not.toHaveBeenCalled()
    expect(recordAudit).not.toHaveBeenCalled()
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ findings: 0 }),
    )
  })

  it("happy path: trailing window read, email sent, system-actor audit, single-owner cron name", async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, findings: 1, emailed: true })
    // THE byte-identical cron name — the same string EXPECTED_CRONS and functions/ must use
    expect(logCronStart).toHaveBeenCalledWith(expect.anything(), "bookkeepingReceiptWatchdogCron")
    const [from, to] = (listEntriesForInsights as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(from < to).toBe(true) // trailing window, not a single day
    expect(sendReceiptWatchdogEmail).toHaveBeenCalledWith({
      findings: [expect.objectContaining({ entry_id: agedEntry.id, reasons: ["no_document"], amount_cents: 5000 })],
    })
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bookkeeping.receipt_watchdog_emailed",
        category: "commerce",
        outcome: "success",
        actor: expect.objectContaining({ role: "system" }),
        metadata: expect.objectContaining({ findings: 1, total_cents: 5000 }),
      }),
    )
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "success", expect.objectContaining({ findings: 1, emailed: true }),
    )
  })

  it("500 + logCronEnd failed when the send errors", async () => {
    ;(sendReceiptWatchdogEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ error: "resend boom" })
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    expect(logCronEnd).toHaveBeenCalledWith(
      expect.anything(), "run-1", "failed",
      expect.objectContaining({ message: expect.stringContaining("resend boom") }),
    )
  })
})
