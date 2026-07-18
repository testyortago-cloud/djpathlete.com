import { describe, it, expect } from "vitest"
import { receiptCashSchema, receiptCommitSchema, amazonCommitSchema } from "@/lib/validators/bookkeeping"
import { AUDIT_ACTIONS } from "@/lib/audit/actions"

const UUID = "11111111-2222-4333-8444-555555555555"

describe("receiptCashSchema", () => {
  it("accepts a minimal cash receipt", () => {
    const r = receiptCashSchema.safeParse({ book_id: UUID, account_id: UUID, amount_cents: 1200, occurred_on: "2026-07-18" })
    expect(r.success).toBe(true)
  })
  it("rejects a bad date and negative amount", () => {
    expect(receiptCashSchema.safeParse({ book_id: UUID, account_id: UUID, amount_cents: -1, occurred_on: "2026-07-18" }).success).toBe(false)
    expect(receiptCashSchema.safeParse({ book_id: UUID, account_id: UUID, amount_cents: 1, occurred_on: "07/18/2026" }).success).toBe(false)
  })
})

describe("receiptCommitSchema", () => {
  it("requires document_id + source_ref", () => {
    const ok = receiptCommitSchema.safeParse({
      book_id: UUID, document_id: UUID, account_id: UUID, amount_cents: 999,
      occurred_on: "2026-07-18", source_ref: `receipt:${UUID}`, business_purpose: "conference",
    })
    expect(ok.success).toBe(true)
    expect(receiptCommitSchema.safeParse({ book_id: UUID, amount_cents: 1, occurred_on: "2026-07-18" }).success).toBe(false)
  })
})

describe("amazonCommitSchema", () => {
  it("accepts entries with amazon refs", () => {
    const r = amazonCommitSchema.safeParse({
      book_id: UUID, document_id: UUID,
      entries: [{ direction: "expense", amount_cents: 2499, occurred_on: "2026-07-01", memo: "Bands", counterparty: "Amazon", service_line: null, source: "receipt", source_ref: "amazon:112-1:0", account_id: UUID }],
    })
    expect(r.success).toBe(true)
  })
})

describe("audit slugs", () => {
  it("registers the three receipt slugs", () => {
    const slugs = AUDIT_ACTIONS.map((a) => a.slug)
    expect(slugs).toContain("bookkeeping.receipt_cash_recorded")
    expect(slugs).toContain("bookkeeping.receipt_uploaded")
    expect(slugs).toContain("bookkeeping.receipt_imported")
  })
})
