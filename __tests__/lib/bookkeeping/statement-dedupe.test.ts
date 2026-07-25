import { describe, it, expect } from "vitest"
import { flagStatementDuplicates, type DedupeInputRow, type PostedRef, type PayoutRef } from "@/lib/bookkeeping/statement-dedupe"

const inc = (over: Partial<DedupeInputRow> = {}): DedupeInputRow => ({
  occurred_on: "2026-07-04", description: "Deposit", amount_cents: 5000, direction: "income",
  source_ref: "statement:" + "a".repeat(40), is_transfer: false, suggested_category: null, confidence: "high", ...over,
})
const exp = (over: Partial<DedupeInputRow> = {}): DedupeInputRow => ({ ...inc({ direction: "expense", description: "COFFEE" }), ...over })
const posted = (over: Partial<PostedRef> = {}): PostedRef => ({ id: "p1", occurred_on: "2026-07-04", amount_cents: 5000, direction: "income", memo: "Stripe", source: "platform_import", ...over })
const payout = (over: Partial<PayoutRef> = {}): PayoutRef => ({
  id: "bp-1", stripe_payout_id: "po_1", net_cents: 5000, arrival_date: "2026-07-04", status: "paid", ...over,
})

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

describe("flagStatementDuplicates — exact payout layer (Track A)", () => {
  it("bank income == paid payout net within ±2d → flagged with matchedPayoutId, matchedEntry null", () => {
    const [r] = flagStatementDuplicates([inc()], [], { payouts: [payout()] })
    expect(r.possibleDuplicate).toBe(true)
    expect(r.matchedPayoutId).toBe("bp-1")
    expect(r.matchedEntry).toBeNull()
    expect(r.defaultInclude).toBe(false)
    expect(r.newCandidate).toBe(false)
    expect(r.reason).toMatch(/Stripe payout deposit/)
    expect(r.reason).toContain("po_1")
  })
  it("±2d boundary: 2 days matches, 3 days does not", () => {
    const [hit] = flagStatementDuplicates([inc({ occurred_on: "2026-07-06" })], [], { payouts: [payout()] })
    expect(hit.matchedPayoutId).toBe("bp-1")
    const [miss] = flagStatementDuplicates([inc({ occurred_on: "2026-07-07" })], [], { payouts: [payout()] })
    expect(miss.possibleDuplicate).toBe(false)
    expect(miss.matchedPayoutId).toBeUndefined()
  })
  it("non-paid payouts are never matched (in_transit excluded)", () => {
    const [r] = flagStatementDuplicates([inc()], [], { payouts: [payout({ status: "in_transit" })] })
    expect(r.possibleDuplicate).toBe(false)
  })
  it("net must match exactly — ±0¢, no layer-2 fuzz", () => {
    const [r] = flagStatementDuplicates([inc({ amount_cents: 5001 })], [], { payouts: [payout()] })
    expect(r.matchedPayoutId).toBeUndefined()
  })
  it("double-match consumption: one payout satisfies at most one bank line", () => {
    const out = flagStatementDuplicates([inc(), inc()], [], { payouts: [payout()] })
    expect(out.filter((r) => r.matchedPayoutId === "bp-1")).toHaveLength(1)
  })
  it("layer-1 precedence: an exact posted-entry match wins and does NOT consume the payout", () => {
    const out = flagStatementDuplicates([inc(), inc()], [posted()], { payouts: [payout()] })
    // first (in match order) row consumed the posted entry; second row still matched the payout
    expect(out.filter((r) => r.matchedEntry?.id === "p1")).toHaveLength(1)
    expect(out.filter((r) => r.matchedPayoutId === "bp-1")).toHaveLength(1)
  })
  it("payout layer does not consume posted entries: layer-2 pool stays intact for other rows", () => {
    // row 1 matches the payout; row 2 (different amount ≈ platform sum) still aggregate-matches
    const rows = [inc(), inc({ amount_cents: 9600, occurred_on: "2026-07-05" })]
    const platform = [posted({ id: "a", amount_cents: 6000 }), posted({ id: "b", amount_cents: 4000 })]
    const out = flagStatementDuplicates(rows, platform, { payouts: [payout()] })
    expect(out[0].matchedPayoutId).toBe("bp-1")
    expect(out[1].reason).toMatch(/probable Stripe payout/)
  })
})
