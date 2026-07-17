import { describe, it, expect } from "vitest"
// Direct relative import of the functions/ twin — functions/src/ai/statement-schema.ts
// only depends on `zod`, so it imports cleanly under the root vitest config even though
// functions/ is otherwise an isolated package (functions/ cannot import lib/, but lib/
// tests importing a pure functions/ file for parity checking is fine).
import { statementImportSchema } from "../../../functions/src/ai/statement-schema"

describe("statementImportSchema (functions/ twin) parity", () => {
  it("parses a representative valid statement import result", () => {
    const valid = {
      rows: [
        {
          ref: "0",
          occurred_on: "2026-07-01",
          description: "COFFEE SHOP PURCHASE",
          amount_cents: 4250,
          direction: "expense",
          is_transfer: false,
          suggested_category: "Supplies",
          confidence: "high",
        },
        {
          ref: null,
          occurred_on: "2026-07-02",
          description: "Transfer to Savings",
          amount_cents: 10000,
          direction: "expense",
          is_transfer: true,
          suggested_category: null,
          confidence: "medium",
        },
      ],
      control_totals: {
        total_deposits_cents: 50000,
        total_withdrawals_cents: 14250,
        opening_balance_cents: 100000,
        closing_balance_cents: 135750,
      },
      warnings: ["inferred year for a month/day-only line"],
      truncated: false,
    }

    const result = statementImportSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it("accepts a null control_totals and omitted control_totals (optional)", () => {
    const base = {
      rows: [],
      warnings: [],
      truncated: false,
    }
    expect(statementImportSchema.safeParse({ ...base, control_totals: null }).success).toBe(true)
    expect(statementImportSchema.safeParse(base).success).toBe(true)
  })

  it("fails when a row is missing direction", () => {
    const invalid = {
      rows: [
        {
          ref: "0",
          occurred_on: "2026-07-01",
          description: "COFFEE SHOP PURCHASE",
          amount_cents: 4250,
          // direction omitted
          is_transfer: false,
          suggested_category: null,
          confidence: "high",
        },
      ],
      warnings: [],
      truncated: false,
    }

    const result = statementImportSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })
})
