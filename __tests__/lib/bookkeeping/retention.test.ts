import { describe, it, expect } from "vitest"
import { isDocumentExpired } from "@/lib/db/bookkeeping"

describe("isDocumentExpired", () => {
  it("expired strictly before today (date-string compare, tz-independent)", () => {
    expect(isDocumentExpired("2020-12-31", "2026-07-18")).toBe(true)
    expect(isDocumentExpired("2033-12-31", "2026-07-18")).toBe(false)
    expect(isDocumentExpired("2026-07-18", "2026-07-18")).toBe(false) // not past yet
  })
})
