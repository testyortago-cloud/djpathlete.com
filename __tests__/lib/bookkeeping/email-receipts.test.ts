import { describe, it, expect } from "vitest"
import {
  rowFromEmailDocument,
  SCAN_INCOMPLETE_MESSAGE,
  buildForwarderQuery,
  GMAIL_RECEIPT_FORWARDERS_KEY,
} from "@/lib/bookkeeping/email-receipts"
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

  // Migration 00193 states this requirement in writing: the poller's
  // external_ref key means "already INGESTED", not "already SCANNED", so a
  // document whose receipt_scan job never landed is skipped by every later
  // poll forever. Reporting it as "scanned" makes it pixel-identical to a real
  // scan that found nothing, and the receipt is silently lost.
  it("no scan_result → status scan_failed (NOT scanned) with the retry message", () => {
    const row = rowFromEmailDocument({ ...DOC, scan_result: null } as BookkeepingDocument, ACCOUNTS)
    expect(row.status).toBe("scan_failed")
    expect(row.status).not.toBe("scanned")
    expect(row.error).toBe(SCAN_INCOMPLETE_MESSAGE)
    // Still fully editable so the coach can key it in by hand and post.
    expect(row).toMatchObject({ included: false, amount: "", counterparty: "", accountId: "", documentId: DOC.id })
    expect(row.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("a scanned receipt where the AI found nothing stays 'scanned' — the two cases must differ", () => {
    const blankScan = {
      ...DOC,
      scan_result: {
        vendor: null, amount_cents: null, occurred_on: null, suggested_category: null,
        business_purpose_hint: null, currency: null, confidence: "low", warnings: [],
      },
    } as unknown as BookkeepingDocument
    const row = rowFromEmailDocument(blankScan, ACCOUNTS)
    expect(row.status).toBe("scanned")
    expect(row.error).toBeNull()
    expect(row.amount).toBe("")
  })

  it("falls back to a friendly file name when the document has none", () => {
    const row = rowFromEmailDocument({ ...DOC, original_filename: null } as BookkeepingDocument, ACCOUNTS)
    expect(row.fileName).toBe("Email receipt")
  })
})

describe("buildForwarderQuery", () => {
  it("builds from: OR to: per address with -in:sent (manual forward = From, auto-forward = original From but To stays)", () => {
    expect(buildForwarderQuery(["yortago@gmail.com", "testyortago@gmail.com"])).toBe(
      "(from:yortago@gmail.com OR to:yortago@gmail.com OR from:testyortago@gmail.com OR to:testyortago@gmail.com) -in:sent",
    )
  })

  it("normalizes case/whitespace and drops non-strings and non-email garbage (query-injection guard)", () => {
    expect(
      buildForwarderQuery(["  Yortago@Gmail.com ", 42, null, "not an email", "a@b OR is:starred"]),
    ).toBe("(from:yortago@gmail.com OR to:yortago@gmail.com) -in:sent")
  })

  it("returns null for empty/invalid input so the poller skips the forwarder source entirely", () => {
    expect(buildForwarderQuery([])).toBeNull()
    expect(buildForwarderQuery("yortago@gmail.com")).toBeNull() // not an array
    expect(buildForwarderQuery(undefined)).toBeNull()
    expect(buildForwarderQuery(["%%%"])).toBeNull()
  })

  it("exports the settings key the migration seeds", () => {
    expect(GMAIL_RECEIPT_FORWARDERS_KEY).toBe("bookkeeping_gmail_receipt_forwarders")
  })
})
