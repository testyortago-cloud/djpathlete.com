import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"

vi.mock("@/lib/resend", () => ({
  resend: { emails: { send: vi.fn() } },
  FROM_EMAIL: "DJP <no-reply@darrenjpaul.com>",
}))

import { resend } from "@/lib/resend"
import {
  WATCHDOG_EMAIL_ROW_CAP,
  receiptWatchdogEmailHtml,
  sendReceiptWatchdogEmail,
} from "@/lib/bookkeeping/email-watchdog"
import type { WatchdogFinding } from "@/lib/bookkeeping/receipt-watchdog"

const send = resend.emails.send as ReturnType<typeof vi.fn>

let seq = 0
function finding(over: Partial<WatchdogFinding>): WatchdogFinding {
  seq += 1
  return {
    entry_id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    book_id: "b0000000-0000-4000-8000-000000000001",
    account_id: "a0000000-0000-4000-8000-000000000001",
    account_name: "Equipment",
    occurred_on: "2026-06-01",
    amount_cents: 5000,
    counterparty: "Rogue",
    reasons: ["no_document"],
    ...over,
  }
}

let origResendKey: string | undefined
let origCoachEmail: string | undefined

beforeEach(() => {
  vi.clearAllMocks()
  origResendKey = process.env.RESEND_API_KEY
  origCoachEmail = process.env.COACH_EMAIL
  process.env.RESEND_API_KEY = "re_test"
  process.env.COACH_EMAIL = "darren@darrenjpaul.com"
})

afterAll(() => {
  if (origResendKey !== undefined) process.env.RESEND_API_KEY = origResendKey
  else delete process.env.RESEND_API_KEY
  if (origCoachEmail !== undefined) process.env.COACH_EMAIL = origCoachEmail
  else delete process.env.COACH_EMAIL
})

describe("receiptWatchdogEmailHtml", () => {
  it("pins the row cap at 25", () => {
    expect(WATCHDOG_EMAIL_ROW_CAP).toBe(25)
  })
  it("carries count, total, reason labels, the insights link, and the honesty line", () => {
    const html = receiptWatchdogEmailHtml([
      finding({ amount_cents: 5000 }),
      finding({ amount_cents: 2500, reasons: ["no_purpose"], account_name: "Meals" }),
    ])
    expect(html).toContain("<strong>2</strong>") // count, discriminated (not just any "2" substring — every date in the fixture contains one)
    expect(html).toContain("$75.00") // 5000 + 2500 cents
    expect(html).toContain("no receipt")
    expect(html).toContain("no purpose")
    expect(html).toContain("https://www.darrenjpaul.com/admin/books/insights")
    expect(html).toContain("CPA")
  })
  it("caps at 25 rows and says how many more (26th finding never rendered)", () => {
    const findings = Array.from({ length: 26 }, (_, i) =>
      finding({ amount_cents: 10000 - i, counterparty: `Vendor ${i}` }),
    )
    const html = receiptWatchdogEmailHtml(findings)
    expect(html).toContain("Vendor 24")
    expect(html).not.toContain("Vendor 25") // the 26th (index 25) is beyond the cap
    expect(html).toContain("and 1 more")
  })
  it("escapes HTML in user-entered strings", () => {
    const html = receiptWatchdogEmailHtml([finding({ counterparty: "<b>Rogue</b>" })])
    expect(html).not.toContain("<b>Rogue</b>")
    expect(html).toContain("&lt;b&gt;Rogue&lt;/b&gt;")
  })
})

describe("sendReceiptWatchdogEmail", () => {
  it("sends to the coach with count + total in the subject", async () => {
    send.mockResolvedValue({ data: { id: "email_1" }, error: null })
    const res = await sendReceiptWatchdogEmail({ findings: [finding({}), finding({ amount_cents: 2500 })] })
    expect(res.error).toBeNull()
    const arg = send.mock.calls[0][0]
    expect(arg.to).toBe("darren@darrenjpaul.com")
    expect(arg.subject).toContain("2 entries") // count, discriminated (matches the implementation's own pluralized string)
    expect(arg.subject).toContain("$75.00")
  })
  it("fails fast when RESEND_API_KEY is unset (outbound must never silently no-op)", async () => {
    delete process.env.RESEND_API_KEY
    const res = await sendReceiptWatchdogEmail({ findings: [finding({})] })
    expect(res.error).toMatch(/RESEND_API_KEY/)
    expect(send).not.toHaveBeenCalled()
  })
  it("fails fast when COACH_EMAIL is unset (coach is the ONLY recipient)", async () => {
    delete process.env.COACH_EMAIL
    const res = await sendReceiptWatchdogEmail({ findings: [finding({})] })
    expect(res.error).toMatch(/COACH_EMAIL/)
    expect(send).not.toHaveBeenCalled()
  })
  it("returns the resend error message on failure", async () => {
    send.mockResolvedValue({ data: null, error: { message: "boom" } })
    const res = await sendReceiptWatchdogEmail({ findings: [finding({})] })
    expect(res.error).toBe("boom")
  })
})
