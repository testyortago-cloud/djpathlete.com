import { describe, expect, it } from "vitest"
import { closePeriodSchema } from "@/lib/validators/bookkeeping"

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
