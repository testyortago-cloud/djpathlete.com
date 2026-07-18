// __tests__/lib/bookkeeping/email-close.test.ts
// vitest.config.ts:14 sets a global non-empty RESEND_API_KEY placeholder and
// __tests__/setup.tsx:6-16 globally mocks "resend" to resolve success, so the
// fail-loud branch is NOT the default env — it must be driven explicitly by
// deleting the key, mirroring __tests__/lib/bookkeeping/email-pack.test.ts:13-35.
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { booksClosedEmailHtml, sendBooksClosedEmail } from "@/lib/bookkeeping/email-close"

const INPUT = {
  recipient: "cpa@example.com",
  bookName: "Darren — DJP Athlete",
  period: "2026-03",
  income_cents: 512345,
  expense_cents: 123400,
  net_cents: 388945,
  entry_count: 42,
  closed_at: "2026-07-18T10:00:00Z",
}

let origResendKey: string | undefined

beforeEach(() => {
  origResendKey = process.env.RESEND_API_KEY
})

afterAll(() => {
  if (origResendKey !== undefined) {
    process.env.RESEND_API_KEY = origResendKey
  } else {
    delete process.env.RESEND_API_KEY
  }
})

describe("booksClosedEmailHtml", () => {
  it("carries the book, the Month YYYY label, exact formatted totals, and the honesty line", () => {
    const html = booksClosedEmailHtml(INPUT)
    expect(html).toContain("Darren — DJP Athlete")
    expect(html).toContain("March 2026")
    expect(html).toContain("$5,123.45")
    expect(html).toContain("$1,234.00")
    expect(html).toContain("$3,889.45")
    expect(html).toContain("42")
    expect(html).toContain("It is not a filing; your CPA files.")
  })
})

describe("sendBooksClosedEmail", () => {
  it("fails LOUD when RESEND_API_KEY is unset (never a silent no-op)", async () => {
    delete process.env.RESEND_API_KEY
    const r = await sendBooksClosedEmail(INPUT)
    expect(r.error).toBe("RESEND_API_KEY not configured")
  })
})
