import { describe, it, expect } from "vitest"
import { num, formatDate } from "@/lib/test-report/format"

describe("num", () => {
  it("trims trailing zeros without lying about precision", () => {
    expect(num(45.7)).toBe("45.7")
    expect(num(140)).toBe("140")
    expect(num(1.3142)).toBe("1.31")
  })
})

describe("formatDate", () => {
  it("prints the report's date format", () => {
    expect(formatDate("2026-08-04")).toBe("4 Aug 2026")
  })

  it("accepts a full timestamp, not just a bare date", () => {
    expect(formatDate("2026-08-04T00:00:00Z")).toBe("4 Aug 2026")
  })

  it("returns empty for null rather than a placeholder date", () => {
    expect(formatDate(null)).toBe("")
  })

  it("does NOT shift the day for a viewer west of UTC", () => {
    // The bug this guards: without the UTC anchoring, a midnight-UTC date renders
    // as the PREVIOUS day for anyone in a negative-offset timezone. It would pass
    // every CI run (UTC) and be wrong for every real viewer in the Americas.
    const original = process.env.TZ
    process.env.TZ = "America/Los_Angeles"
    try {
      expect(formatDate("2026-08-04")).toBe("4 Aug 2026")
    } finally {
      process.env.TZ = original
    }
  })
})
