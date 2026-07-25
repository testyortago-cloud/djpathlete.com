import { describe, it, expect } from "vitest"
import { reconcileControlTotals, applyRowCap, MAX_STATEMENT_ROWS, type StatementImportOutputRow } from "../statement-import.js"

const row = (o: Partial<StatementImportOutputRow>): StatementImportOutputRow => ({
  occurred_on: "2026-07-01", description: "x", amount_cents: 100, direction: "expense",
  suggested_category: null, is_transfer: false, confidence: "high", ...o,
})

describe("reconcileControlTotals", () => {
  it("warns 'completeness unverified' when all totals null", () => {
    const w: string[] = []; reconcileControlTotals([row({})], null, w)
    expect(w.some((s) => /completeness unverified/i.test(s))).toBe(true)
  })
  it("warns on a deposit-total mismatch beyond tolerance", () => {
    const w: string[] = []
    reconcileControlTotals([row({ direction: "income", amount_cents: 5000 })],
      { total_deposits_cents: 9999, total_withdrawals_cents: null, opening_balance_cents: null, closing_balance_cents: null }, w)
    expect(w.some((s) => /deposit total mismatch/i.test(s))).toBe(true)
  })
  it("no mismatch warning when sums agree within tolerance", () => {
    const w: string[] = []
    reconcileControlTotals([row({ direction: "expense", amount_cents: 5000 })],
      { total_deposits_cents: null, total_withdrawals_cents: 5050, opening_balance_cents: null, closing_balance_cents: null }, w)
    expect(w.some((s) => /mismatch/i.test(s))).toBe(false)
  })
  it("warns on a withdrawal-total mismatch beyond tolerance", () => {
    const w: string[] = []
    reconcileControlTotals([row({ direction: "expense", amount_cents: 7300 })],
      { total_deposits_cents: null, total_withdrawals_cents: 12555, opening_balance_cents: null, closing_balance_cents: null }, w)
    expect(w.some((s) => /withdrawal total mismatch/i.test(s))).toBe(true)
    expect(w.some((s) => /deposit total mismatch/i.test(s))).toBe(false)
  })
  it("stays silent on deposit drift of exactly 100 cents (boundary is strictly >100)", () => {
    const w: string[] = []
    reconcileControlTotals([row({ direction: "income", amount_cents: 12455 })],
      { total_deposits_cents: 12555, total_withdrawals_cents: null, opening_balance_cents: null, closing_balance_cents: null }, w)
    expect(w.some((s) => /mismatch/i.test(s))).toBe(false)
    expect(w.some((s) => /completeness unverified/i.test(s))).toBe(false)
  })
  it("treats an object with all-null fields the same as a null totals object", () => {
    const w: string[] = []
    reconcileControlTotals([row({ direction: "income", amount_cents: 5000 })],
      { total_deposits_cents: null, total_withdrawals_cents: null, opening_balance_cents: null, closing_balance_cents: null }, w)
    expect(w.some((s) => /completeness unverified/i.test(s))).toBe(true)
    expect(w).toHaveLength(1)
  })
})

describe("applyRowCap", () => {
  it("caps at MAX and flags truncation", () => {
    const many = Array.from({ length: MAX_STATEMENT_ROWS + 5 }, () => row({}))
    const w: string[] = []
    const res = applyRowCap(many, w, false)
    expect(res.rows).toHaveLength(MAX_STATEMENT_ROWS)
    expect(res.truncated).toBe(true)
    expect(w.some((s) => /500-row cap/i.test(s))).toBe(true)
  })
  it("leaves a small set untouched", () => {
    const w: string[] = []
    const res = applyRowCap([row({}), row({})], w, false)
    expect(res.rows).toHaveLength(2)
    expect(res.truncated).toBe(false)
    expect(w).toEqual([])
  })
})
