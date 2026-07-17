import { describe, it, expect } from "vitest"
import {
  joinCategorizedRows,
  type StatementImportInputRow,
} from "../../../functions/src/statement-import"

// Money-critical join (AI Bookkeeper Phase 2, Task 9): the deterministic
// csv_structured input rows are authoritative. The AI may only contribute
// suggested_category/is_transfer/confidence, matched back by `ref`. It can
// never add, remove, or alter a row.

const row = (over: Partial<StatementImportInputRow> = {}): StatementImportInputRow => ({
  ref: "r1",
  occurred_on: "2026-07-04",
  description: "COFFEE",
  amount_cents: 500,
  direction: "expense",
  ...over,
})

describe("joinCategorizedRows", () => {
  it("takes only suggested_category/is_transfer/confidence from the matching AI row", () => {
    const [out] = joinCategorizedRows(
      [row()],
      [{ ref: "r1", occurred_on: "2099-01-01", description: "WRONG", amount_cents: 1, direction: "income", suggested_category: "Meals", is_transfer: false, confidence: "high" }],
    )
    expect(out).toEqual({
      occurred_on: "2026-07-04",
      description: "COFFEE",
      amount_cents: 500,
      direction: "expense",
      suggested_category: "Meals",
      is_transfer: false,
      confidence: "high",
    })
  })

  it("never drops an input row missing a matching AI ref — defaults to null/false/low", () => {
    const [out] = joinCategorizedRows([row({ ref: "r2" })], [])
    expect(out).toMatchObject({ suggested_category: null, is_transfer: false, confidence: "low" })
    expect(out.occurred_on).toBe("2026-07-04")
    expect(out.amount_cents).toBe(500)
  })

  it("ignores an AI row whose ref matches no input row", () => {
    const out = joinCategorizedRows(
      [row({ ref: "r1" })],
      [
        { ref: "r1", occurred_on: "x", description: "x", amount_cents: 1, direction: "income", suggested_category: "A", is_transfer: false, confidence: "high" },
        { ref: "unknown-ref", occurred_on: "x", description: "x", amount_cents: 1, direction: "income", suggested_category: "B", is_transfer: true, confidence: "high" },
      ],
    )
    expect(out).toHaveLength(1)
    expect(out[0].suggested_category).toBe("A")
  })

  it("output has exactly one row per input row, in input order, even with duplicate/null AI refs", () => {
    const rows = [row({ ref: "r1" }), row({ ref: "r2", description: "TEA" }), row({ ref: "r3", description: "SODA" })]
    const out = joinCategorizedRows(rows, [
      { ref: null, occurred_on: "x", description: "x", amount_cents: 1, direction: "income", suggested_category: "X", is_transfer: false, confidence: "low" },
      { ref: "r2", occurred_on: "x", description: "x", amount_cents: 1, direction: "income", suggested_category: "Y", is_transfer: false, confidence: "medium" },
    ])
    expect(out.map((r) => r.description)).toEqual(["COFFEE", "TEA", "SODA"])
    expect(out[1].suggested_category).toBe("Y")
    expect(out[0].suggested_category).toBeNull()
    expect(out[2].suggested_category).toBeNull()
  })
})
