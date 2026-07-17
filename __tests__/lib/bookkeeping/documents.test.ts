import { describe, it, expect } from "vitest"
import { safeStatementName } from "@/lib/bookkeeping/documents"
describe("safeStatementName", () => {
  it("strips unsafe chars and keeps the basename + extension", () => {
    expect(safeStatementName("../My Statement (July).csv")).toMatch(/^My_Statement__July_\.csv$/)
  })
  it("caps length", () => { expect(safeStatementName("a".repeat(300) + ".pdf").length).toBeLessThanOrEqual(120) })
})
