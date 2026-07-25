import { describe, it, expect } from "vitest"
import { rowFromEmailDocument } from "@/lib/bookkeeping/email-receipts"
import type { BookkeepingAccount, BookkeepingDocument } from "@/types/database"

const ACCOUNTS = [
  {
    id: "a0000000-0000-4000-8000-000000000001",
    book_id: "b0000000-0000-4000-8000-000000000001",
    name: "Equipment",
    account_type: "expense",
  } as BookkeepingAccount,
]
const DOC = {
  id: "d0000000-0000-4000-8000-000000000002",
  book_id: "b0000000-0000-4000-8000-000000000001",
  kind: "receipt",
  original_filename: "invoice.pdf",
  external_ref: "gmail:m1:0",
  posted_count: null,
  scan_result: {
    vendor: "Home Depot",
    amount_cents: 12555,
    occurred_on: "2026-07-20",
    suggested_category: "Equipment",
    business_purpose_hint: "Rack parts",
    currency: "USD",
    confidence: "high",
    warnings: [],
  },
} as unknown as BookkeepingDocument

describe("rowFromEmailDocument", () => {
  it("folds scan_result into editable fields exactly like the photo flow (12.555 discriminator)", () => {
    const row = rowFromEmailDocument(DOC, ACCOUNTS)
    expect(row).toMatchObject({
      clientId: DOC.id,
      documentId: DOC.id,
      status: "scanned",
      included: true,
      counterparty: "Home Depot",
      amount: "125.55",
      occurredOn: "2026-07-20",
      accountId: "a0000000-0000-4000-8000-000000000001",
      businessPurpose: "Rack parts",
    })
    expect(row.result?.confidence).toBe("high")
  })

  it("no scan_result yet (vision job pending/failed) → editable blank row defaulting to today", () => {
    const row = rowFromEmailDocument({ ...DOC, scan_result: null } as BookkeepingDocument, ACCOUNTS)
    expect(row).toMatchObject({ status: "scanned", included: true, amount: "", counterparty: "", accountId: "" })
    expect(row.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("falls back to a friendly file name when the document has none", () => {
    const row = rowFromEmailDocument({ ...DOC, original_filename: null } as BookkeepingDocument, ACCOUNTS)
    expect(row.fileName).toBe("Email receipt")
  })
})
