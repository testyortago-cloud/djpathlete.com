import { describe, it, expect } from "vitest"
import { createEntrySchema, importPreviewSchema } from "@/lib/validators/bookkeeping"

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
