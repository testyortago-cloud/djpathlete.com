import { describe, it, expect } from "vitest"
import { formatOccurredOn } from "@/lib/bookkeeping/format"

describe("formatOccurredOn", () => {
  it("formats a YYYY-MM-DD date without UTC rollback", () => {
    expect(formatOccurredOn("2026-07-04")).toBe("Jul 4, 2026")
  })
  it("returns the input unchanged when malformed", () => {
    expect(formatOccurredOn("not-a-date")).toBe("not-a-date")
  })
})
