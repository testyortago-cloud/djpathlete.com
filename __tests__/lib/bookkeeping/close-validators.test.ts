import { describe, expect, it } from "vitest"
import { closePeriodSchema, createEntrySchema, updateEntrySchema } from "@/lib/validators/bookkeeping"

const BOOK = "b0000000-0000-4000-8000-000000000001"

describe("closePeriodSchema", () => {
  it("accepts a uuid book + YYYY-MM period", () => {
    expect(closePeriodSchema.safeParse({ book_id: BOOK, period: "2026-01" }).success).toBe(true)
    expect(closePeriodSchema.safeParse({ book_id: BOOK, period: "2019-12" }).success).toBe(true)
  })
  it("rejects month 00/13, date strings, missing keys, non-uuid book", () => {
    for (const period of ["2026-00", "2026-13", "2026-1", "2026-03-15", ""]) {
      expect(closePeriodSchema.safeParse({ book_id: BOOK, period }).success).toBe(false)
    }
    expect(closePeriodSchema.safeParse({ period: "2026-01" }).success).toBe(false)
    expect(closePeriodSchema.safeParse({ book_id: "not-a-uuid", period: "2026-01" }).success).toBe(false)
  })
})

describe("adjusts_period on entry schemas", () => {
  const base = { book_id: BOOK, direction: "expense" as const, amount_cents: 100, occurred_on: "2026-02-01" }
  it("optional/nullable and regex-validated on create", () => {
    expect(createEntrySchema.safeParse(base).success).toBe(true)
    expect(createEntrySchema.safeParse({ ...base, adjusts_period: null }).success).toBe(true)
    expect(createEntrySchema.safeParse({ ...base, adjusts_period: "2019-01" }).success).toBe(true)
    expect(createEntrySchema.safeParse({ ...base, adjusts_period: "2019-13" }).success).toBe(false)
    expect(createEntrySchema.safeParse({ ...base, adjusts_period: "2019-01-15" }).success).toBe(false)
  })
  it("same on update", () => {
    expect(updateEntrySchema.safeParse({ adjusts_period: "2019-12" }).success).toBe(true)
    expect(updateEntrySchema.safeParse({ adjusts_period: null }).success).toBe(true)
    expect(updateEntrySchema.safeParse({ adjusts_period: "2019-00" }).success).toBe(false)
  })
})
