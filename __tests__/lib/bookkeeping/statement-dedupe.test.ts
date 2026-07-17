import { describe, it, expect } from "vitest"
import { flagStatementDuplicates, type DedupeInputRow, type PostedRef } from "@/lib/bookkeeping/statement-dedupe"

const inc = (over: Partial<DedupeInputRow> = {}): DedupeInputRow => ({
  occurred_on: "2026-07-04", description: "Deposit", amount_cents: 5000, direction: "income",
  source_ref: "statement:" + "a".repeat(40), is_transfer: false, suggested_category: null, confidence: "high", ...over,
})
const exp = (over: Partial<DedupeInputRow> = {}): DedupeInputRow => ({ ...inc({ direction: "expense", description: "COFFEE" }), ...over })
const posted = (over: Partial<PostedRef> = {}): PostedRef => ({ id: "p1", occurred_on: "2026-07-04", amount_cents: 5000, direction: "income", memo: "Stripe", source: "platform_import", ...over })

describe("flagStatementDuplicates — income", () => {
  it("all income defaults to include=false", () => {
    const [r] = flagStatementDuplicates([inc()], [])
    expect(r.defaultInclude).toBe(false)
  })
  it("exact amount+date within window → possibleDuplicate", () => {
    const [r] = flagStatementDuplicates([inc()], [posted()])
    expect(r.possibleDuplicate).toBe(true)
    expect(r.matchedEntry?.id).toBe("p1")
  })
  it("income with no match is tagged newCandidate", () => {
    const [r] = flagStatementDuplicates([inc({ amount_cents: 9999 })], [posted()])
    expect(r.newCandidate).toBe(true)
    expect(r.possibleDuplicate).toBe(false)
  })
  it("aggregate-payout: income ≈ sum of platform income in window (within fee tolerance) is flagged", () => {
    const rows = [inc({ amount_cents: 9600 })] // ~= 10000 gross minus ~4% fees
    const p = [posted({ id: "a", amount_cents: 6000 }), posted({ id: "b", amount_cents: 4000 })]
    const [r] = flagStatementDuplicates(rows, p)
    expect(r.possibleDuplicate).toBe(true)
    expect(r.reason).toMatch(/payout/i)
  })
})

describe("flagStatementDuplicates — expense", () => {
  it("plain expense defaults to include=true", () => {
    const [r] = flagStatementDuplicates([exp()], [])
    expect(r.defaultInclude).toBe(true)
    expect(r.newCandidate).toBe(false)
  })
  it("cross-statement expense dup requires description similarity (same amount+date, different desc → NOT flagged)", () => {
    const p = [posted({ id: "e1", direction: "expense", amount_cents: 5000, memo: "TEA HOUSE", source: "statement_import" })]
    const [r] = flagStatementDuplicates([exp({ description: "COFFEE" })], p)
    expect(r.possibleDuplicate).toBe(false)
    expect(r.defaultInclude).toBe(true)
  })
  it("cross-statement expense dup with similar desc → flagged + pre-excluded", () => {
    const p = [posted({ id: "e1", direction: "expense", amount_cents: 5000, memo: "COFFEE", source: "statement_import" })]
    const [r] = flagStatementDuplicates([exp({ description: "COFFEE" })], p)
    expect(r.possibleDuplicate).toBe(true)
    expect(r.defaultInclude).toBe(false)
  })
  it("is_transfer expense → include=false", () => {
    const [r] = flagStatementDuplicates([exp({ is_transfer: true })], [])
    expect(r.defaultInclude).toBe(false)
    expect(r.reason).toMatch(/transfer/i)
  })
  it("transferSuspect expense → include=false, still marked postable", () => {
    const [r] = flagStatementDuplicates([exp({ transferSuspect: true })], [])
    expect(r.defaultInclude).toBe(false)
    expect(r.reason).toMatch(/possible transfer/i)
  })
})

describe("flagStatementDuplicates — ordering + consumption", () => {
  it("returns rows in input order", () => {
    const rows = [exp({ occurred_on: "2026-07-10", description: "B" }), exp({ occurred_on: "2026-07-01", description: "A" })]
    const out = flagStatementDuplicates(rows, [])
    expect(out.map((r) => r.row.description)).toEqual(["B", "A"])
  })
  it("a posted entry is consumed by at most one statement row", () => {
    const rows = [inc(), inc()]
    const out = flagStatementDuplicates(rows, [posted()])
    expect(out.filter((r) => r.possibleDuplicate)).toHaveLength(1)
  })
})
