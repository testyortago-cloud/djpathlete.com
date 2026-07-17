import { describe, it, expect } from "vitest"
import { createEntrySchema, importPreviewSchema, statementDedupeSchema } from "@/lib/validators/bookkeeping"

const BOOK = "b0000000-0000-4000-8000-000000000001"

describe("createEntrySchema", () => {
  it("accepts a valid manual entry", () => {
    const r = createEntrySchema.safeParse({
      book_id: BOOK, direction: "expense", amount_cents: 4200,
      occurred_on: "2026-07-01", account_id: null, memo: "Bands",
      counterparty: "Rogue", business_purpose: null,
    })
    expect(r.success).toBe(true)
  })
  it("rejects negative amounts", () => {
    const r = createEntrySchema.safeParse({
      book_id: BOOK, direction: "expense", amount_cents: -1, occurred_on: "2026-07-01",
    })
    expect(r.success).toBe(false)
  })
  it("rejects a bad direction", () => {
    const r = createEntrySchema.safeParse({
      book_id: BOOK, direction: "credit", amount_cents: 1, occurred_on: "2026-07-01",
    })
    expect(r.success).toBe(false)
  })
  it("rejects a malformed occurred_on date", () => {
    for (const bad of ["07/01/2026", "2026-7-1", "nope", "2026-13-01T00:00:00Z"]) {
      const r = createEntrySchema.safeParse({
        book_id: BOOK, direction: "income", amount_cents: 1, occurred_on: bad,
      })
      expect(r.success, `expected reject for ${bad}`).toBe(false)
    }
  })
  it("rejects a non-UUID book_id", () => {
    const r = createEntrySchema.safeParse({
      book_id: "not-a-uuid", direction: "income", amount_cents: 1, occurred_on: "2026-07-01",
    })
    expect(r.success).toBe(false)
  })
})

describe("importPreviewSchema", () => {
  it("requires book_id + from + to", () => {
    expect(importPreviewSchema.safeParse({ book_id: BOOK, from: "2026-01-01", to: "2026-12-31" }).success).toBe(true)
    expect(importPreviewSchema.safeParse({ book_id: BOOK }).success).toBe(false)
  })
})

describe("statementDedupeSchema", () => {
  const baseRow = {
    occurred_on: "2026-01-05",
    amount_cents: 500,
    direction: "expense" as const,
    description: "X",
    is_transfer: false,
    confidence: "low" as const,
  }

  // Regression for the C1 fix: Firebase RTDB strips `null` leaf values on
  // write, so an uncategorized row's `suggested_category` (written as `null`
  // by the statement job) round-trips as a MISSING key, not `null`. The
  // schema must accept the key being absent — `.nullable()` alone rejects a
  // missing key, only `.nullable().optional()` accepts both.
  it("accepts a row missing the suggested_category key entirely (RTDB null-stripping)", () => {
    const r = statementDedupeSchema.safeParse({ book_id: BOOK, rows: [{ ...baseRow }] })
    expect(r.success).toBe(true)
  })

  it("still accepts a row with suggested_category explicitly null", () => {
    const r = statementDedupeSchema.safeParse({
      book_id: BOOK,
      rows: [{ ...baseRow, suggested_category: null }],
    })
    expect(r.success).toBe(true)
  })

  it("still accepts a row with a real suggested_category string", () => {
    const r = statementDedupeSchema.safeParse({
      book_id: BOOK,
      rows: [{ ...baseRow, suggested_category: "Software" }],
    })
    expect(r.success).toBe(true)
  })
})
