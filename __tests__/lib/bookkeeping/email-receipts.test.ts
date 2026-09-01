import { describe, it, expect } from "vitest"
import {
  rowFromEmailDocument,
  SCAN_INCOMPLETE_MESSAGE,
  buildForwarderQuery,
  buildReceiptQuery,
  bucketEmailReceiptRows,
  GMAIL_RECEIPT_FORWARDERS_KEY,
  GMAIL_RECEIPT_QUERY_KEY,
  GMAIL_RECEIPT_QUERY_WINDOW_KEY,
  DEFAULT_GMAIL_RECEIPT_QUERY,
  DEFAULT_GMAIL_RECEIPT_QUERY_WINDOW_DAYS,
  MAX_GMAIL_RECEIPT_QUERY_WINDOW_DAYS,
} from "@/lib/bookkeeping/email-receipts"
import { newReceiptRow, type ReceiptBatchRow } from "@/lib/bookkeeping/receipt-batch"
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

  it("marks text/html and text/plain documents isBody (iframe preview), never images/PDFs", () => {
    const html = rowFromEmailDocument({ ...DOC, mime_type: "text/html" } as BookkeepingDocument, ACCOUNTS)
    expect(html.isBody).toBe(true)
    expect(html.isPdf).toBe(false)
    expect(
      rowFromEmailDocument({ ...DOC, mime_type: "text/plain" } as BookkeepingDocument, ACCOUNTS).isBody,
    ).toBe(true)
    expect(
      rowFromEmailDocument({ ...DOC, mime_type: "image/jpeg" } as BookkeepingDocument, ACCOUNTS).isBody,
    ).toBe(false)
    expect(
      rowFromEmailDocument({ ...DOC, mime_type: "application/pdf" } as BookkeepingDocument, ACCOUNTS).isBody,
    ).toBe(false)
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

  it("bounds the query with after: (slash form) when a valid since date is set — the backlog guard", () => {
    expect(buildForwarderQuery(["yortago@gmail.com"], "2026-08-02")).toBe(
      "(from:yortago@gmail.com OR to:yortago@gmail.com) -in:sent after:2026/08/02",
    )
    expect(buildForwarderQuery(["yortago@gmail.com"], " 2026-08-02 ")).toBe(
      "(from:yortago@gmail.com OR to:yortago@gmail.com) -in:sent after:2026/08/02",
    )
  })

  it("ignores an absent or malformed since date (unbounded — old behavior)", () => {
    const unbounded = "(from:yortago@gmail.com OR to:yortago@gmail.com) -in:sent"
    expect(buildForwarderQuery(["yortago@gmail.com"], null)).toBe(unbounded)
    expect(buildForwarderQuery(["yortago@gmail.com"], "02-08-2026")).toBe(unbounded)
    expect(buildForwarderQuery(["yortago@gmail.com"], "2026/08/02")).toBe(unbounded)
    expect(buildForwarderQuery(["yortago@gmail.com"], 20260802)).toBe(unbounded)
  })

  it("exports the settings key the migration seeds", () => {
    expect(GMAIL_RECEIPT_FORWARDERS_KEY).toBe("bookkeeping_gmail_receipt_forwarders")
  })
})

describe("buildReceiptQuery", () => {
  const D = DEFAULT_GMAIL_RECEIPT_QUERY_WINDOW_DAYS

  it("appends the bounds the poller always applies to the coach's search", () => {
    expect(buildReceiptQuery("subject:invoice", 45)).toBe(
      "subject:invoice -in:sent -in:chats newer_than:45d",
    )
  })

  it("returns null for a blank or non-string query so the source is simply off", () => {
    expect(buildReceiptQuery("")).toBeNull()
    expect(buildReceiptQuery("   ")).toBeNull()
    expect(buildReceiptQuery(null)).toBeNull()
    expect(buildReceiptQuery(undefined)).toBeNull()
    expect(buildReceiptQuery(42)).toBeNull()
    expect(buildReceiptQuery(["subject:invoice"])).toBeNull()
  })

  it("falls back to the default window when the stored one is absent or not a usable number", () => {
    for (const bad of [undefined, null, 0, -5, Number.NaN, "30", {}]) {
      expect(buildReceiptQuery("subject:invoice", bad)).toBe(
        `subject:invoice -in:sent -in:chats newer_than:${D}d`,
      )
    }
  })

  it("caps the window so a settings typo cannot walk years of mailbox history", () => {
    expect(buildReceiptQuery("subject:invoice", 9999)).toBe(
      `subject:invoice -in:sent -in:chats newer_than:${MAX_GMAIL_RECEIPT_QUERY_WINDOW_DAYS}d`,
    )
  })

  it("still appends its own window when the stored query carries a date bound of its own", () => {
    // Gmail ANDs the clauses, so the tighter one wins — this source can never
    // become unbounded no matter what is stored.
    expect(buildReceiptQuery("subject:invoice after:2020/01/01", 45)).toBe(
      "subject:invoice after:2020/01/01 -in:sent -in:chats newer_than:45d",
    )
  })

  it("ships a SUBJECT-scoped default — a body-wide one ingests every email that merely says 'receipt'", () => {
    expect(DEFAULT_GMAIL_RECEIPT_QUERY.startsWith("subject:")).toBe(true)
    expect(DEFAULT_GMAIL_RECEIPT_QUERY).toContain("invoice")
  })

  it("exports the settings keys the migration seeds", () => {
    expect(GMAIL_RECEIPT_QUERY_KEY).toBe("bookkeeping_gmail_receipt_query")
    expect(GMAIL_RECEIPT_QUERY_WINDOW_KEY).toBe("bookkeeping_gmail_receipt_query_window_days")
  })
})

describe("bucketEmailReceiptRows", () => {
  const mkRow = (over: Partial<ReceiptBatchRow>): ReceiptBatchRow => ({
    ...newReceiptRow(over.clientId ?? "r1", over.fileName ?? "r.pdf", null),
    status: "scanned",
    counterparty: "Vercel Inc.",
    amount: "20",
    occurredOn: "2026-07-18",
    result: {
      vendor: "Vercel Inc.", amount_cents: 2000, occurred_on: "2026-07-18",
      suggested_category: null, business_purpose_hint: null, memo: null,
      payment_status: null, currency: "USD",
      confidence: "high", warnings: [],
    },
    ...over,
  })

  it("clean scans go to review; failed, low-confidence and warned scans go to attention", () => {
    const clean = mkRow({ clientId: "a" })
    const failed = mkRow({ clientId: "b", status: "scan_failed", result: null, counterparty: "x1" })
    const low = mkRow({
      clientId: "c", counterparty: "x2",
      result: { ...mkRow({}).result!, confidence: "low" },
    })
    const warned = mkRow({
      clientId: "d", counterparty: "x3",
      result: { ...mkRow({}).result!, warnings: ["might be a statement"] },
    })
    const buckets = bucketEmailReceiptRows([clean, failed, low, warned])
    expect(buckets.review.map((r) => r.clientId)).toEqual(["a"])
    expect(buckets.attention.map((r) => r.clientId)).toEqual(["b", "c", "d"])
    expect(buckets.duplicates).toEqual([])
  })

  it("a scan marked payment_status 'due' (vendor invoice, not a paid receipt) lands in attention via the synthesized warning", () => {
    const dueDoc = {
      ...DOC,
      id: "d0000000-0000-4000-8000-000000000009",
      scan_result: { ...(DOC.scan_result as Record<string, unknown>), payment_status: "due" },
    } as unknown as BookkeepingDocument
    const row = rowFromEmailDocument(dueDoc, ACCOUNTS)
    expect(row.result?.warnings.some((w) => w.includes("DUE"))).toBe(true)
    const buckets = bucketEmailReceiptRows([row])
    expect(buckets.attention.map((r) => r.clientId)).toEqual([dueDoc.id])
    expect(buckets.review).toEqual([])
  })

  it("the LATER vendor+amount+date twin goes to duplicates, mapped to the earlier card", () => {
    const first = mkRow({ clientId: "inv" })
    const twin = mkRow({ clientId: "rcpt" })
    const other = mkRow({ clientId: "other", counterparty: "Supabase", amount: "34.35" })
    const buckets = bucketEmailReceiptRows([first, twin, other])
    expect(buckets.review.map((r) => r.clientId)).toEqual(["inv", "other"])
    expect(buckets.duplicates.map((r) => r.clientId)).toEqual(["rcpt"])
    expect(buckets.duplicateOf).toEqual({ rcpt: "inv" })
  })

  it("attention outranks duplicates — an uncertain twin still needs the human first", () => {
    const first = mkRow({ clientId: "inv" })
    const lowTwin = mkRow({ clientId: "rcpt", result: { ...mkRow({}).result!, confidence: "low" } })
    const buckets = bucketEmailReceiptRows([first, lowTwin])
    expect(buckets.attention.map((r) => r.clientId)).toEqual(["rcpt"])
    expect(buckets.duplicates).toEqual([])
  })
})
