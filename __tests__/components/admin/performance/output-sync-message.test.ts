import { describe, it, expect } from "vitest"
import { notBroughtIn, summaryText } from "@/components/admin/performance/output-athlete-panel"

const summary = (added: number, updated: number, skipped: Record<string, number> = {}) => ({
  imported: added + updated,
  added,
  updated,
  skipped,
})

describe("the Output sync message", () => {
  it("says what came in on its own line", () => {
    expect(summaryText(summary(3, 1))).toBe("3 new results, 1 updated.")
    expect(summaryText(summary(1, 0))).toBe("1 new result.")
    expect(summaryText(summary(0, 0, { Jumps: 2 }))).toBe("No new results.")
  })

  it("says what was NOT brought in separately, so its count is never read as results added", () => {
    expect(notBroughtIn(summary(0, 0, { Jumps: 2, "Slams, Swings & Throws": 1 }))).toBe(
      "Not brought in (no matching test in the app): 2 Jumps · 1 Slams, Swings & Throws",
    )
    expect(notBroughtIn(summary(3, 0))).toBeNull()
  })
})
