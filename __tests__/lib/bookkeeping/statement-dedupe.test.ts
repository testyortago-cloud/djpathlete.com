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
  it("±2d window is SYMMETRIC: bank dates BEFORE arrival_date match too (−1, −2 in; −3 out)", () => {
    // Banks routinely post a Stripe ACH deposit a day or two before Stripe's
    // stated arrival_date. Only probing dates at/after arrival would leave a
    // one-sided `rowDate - arrival` window passing every test.
    const opts = { payouts: [payout()] } // arrival 2026-07-04
    const [minus1] = flagStatementDuplicates([inc({ occurred_on: "2026-07-03" })], [], opts)
    expect(minus1.matchedPayoutId).toBe("bp-1")
    const [minus2] = flagStatementDuplicates([inc({ occurred_on: "2026-07-02" })], [], opts)
    expect(minus2.matchedPayoutId).toBe("bp-1")
    const [minus3] = flagStatementDuplicates([inc({ occurred_on: "2026-07-01" })], [], opts)
    expect(minus3.matchedPayoutId).toBeUndefined()
    expect(minus3.possibleDuplicate).toBe(false)
    expect(minus3.newCandidate).toBe(true)
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
    // Positional, not counts: both rows are same-date so match order === input order.
    // Row 0 MUST take layer 1 (posted entry) — if the payout layer were hoisted above
    // it, row 0 would take the payout and row 1 the entry, and count-only assertions
    // would still be 1/1 while the consumption pools had silently swapped.
    expect(out[0].matchedEntry?.id).toBe("p1")
    expect(out[0].matchedPayoutId).toBeUndefined()
    expect(out[1].matchedPayoutId).toBe("bp-1")
    expect(out[1].matchedEntry).toBeNull()
  })
  it("nearest-date unconsumed payout wins (spec §1.5) — not first-in-list", () => {
    // Two identical $50 paid payouts; the bank line is 0d from bp-2 and 2d from bp-1.
    // First-match-wins would take bp-1 (earlier in the array) and leave bp-2 free to
    // flag the second, genuinely-unrelated line.
    const payouts = [payout({ id: "bp-1", stripe_payout_id: "po_1", arrival_date: "2026-07-02" }), payout({ id: "bp-2", stripe_payout_id: "po_2", arrival_date: "2026-07-04" })]
    const out = flagStatementDuplicates([inc({ occurred_on: "2026-07-04" }), inc({ occurred_on: "2026-07-06" })], [], { payouts })
    expect(out[0].matchedPayoutId).toBe("bp-2")
    // bp-1 is now 4d away (out of the ±2d window) so row 1 gets nothing.
    expect(out[1].matchedPayoutId).toBeUndefined()
    expect(out[1].possibleDuplicate).toBe(false)
    expect(out[1].newCandidate).toBe(true)
  })
  it("a claimed payout also consumes the platform income it is COMPOSED OF — a later unrelated deposit is not re-flagged off the same batch", () => {
    // bp-1 = $500 net arriving 07-04, composed of the $200 (07-02) + $300 (07-03)
    // platform_import entries. If the payout layer leaves those entries in the
    // pool, the aggregate layer re-spends the very same $500 batch against the
    // genuine, unrelated $500 client cheque banked on 07-05 and pre-excludes it
    // as a "probable Stripe payout of $500.00" — real income dropped silently.
    const platform = [
      posted({ id: "a", amount_cents: 20000, occurred_on: "2026-07-02" }),
      posted({ id: "b", amount_cents: 30000, occurred_on: "2026-07-03" }),
    ]
    const rows = [
      inc({ amount_cents: 50000, occurred_on: "2026-07-04", description: "STRIPE PAYOUT" }),
      inc({ amount_cents: 50000, occurred_on: "2026-07-05", description: "CHECK DEPOSIT 1042" }),
    ]
    const out = flagStatementDuplicates(rows, platform, { payouts: [payout({ net_cents: 50000, arrival_date: "2026-07-04" })] })
    expect(out[0].matchedPayoutId).toBe("bp-1")
    expect(out[1].possibleDuplicate).toBe(false)
    expect(out[1].matchedEntry).toBeNull()
    expect(out[1].reason ?? "").not.toMatch(/probable Stripe payout/)
    expect(out[1].newCandidate).toBe(true)
  })
  it("payout consumption is SCOPED to its own window — platform income outside it still aggregate-matches", () => {
    // Guards the opposite over-correction: claiming a payout must not drain the
    // whole posted pool, only the entries inside the payout's own trailing window.
    const platform = [
      posted({ id: "a", amount_cents: 20000, occurred_on: "2026-07-02" }),
      posted({ id: "b", amount_cents: 30000, occurred_on: "2026-07-03" }),
      posted({ id: "c", amount_cents: 6000, occurred_on: "2026-07-18" }),
      posted({ id: "d", amount_cents: 4000, occurred_on: "2026-07-19" }),
    ]
    const rows = [
      inc({ amount_cents: 50000, occurred_on: "2026-07-04" }),
      inc({ amount_cents: 9700, occurred_on: "2026-07-20" }), // ≈ $100 gross minus fees
    ]
    const out = flagStatementDuplicates(rows, platform, { payouts: [payout({ net_cents: 50000, arrival_date: "2026-07-04" })] })
    expect(out[0].matchedPayoutId).toBe("bp-1")
    expect(out[1].possibleDuplicate).toBe(true)
    expect(out[1].reason).toMatch(/probable Stripe payout/)
  })
  it("payout constituents are claimed off the payout's ARRIVAL date, not the bank row's date", () => {
    // Bank posted the deposit 2 days EARLY (07-02) for a payout arriving 07-04.
    // Anchoring the consumption window on the bank row would look back from
    // 07-02 and miss the 07-03 constituent, leaving it re-spendable.
    const platform = [
      posted({ id: "a", amount_cents: 20000, occurred_on: "2026-07-03" }),
      posted({ id: "b", amount_cents: 30000, occurred_on: "2026-07-04" }),
    ]
    const rows = [
      inc({ amount_cents: 50000, occurred_on: "2026-07-02", description: "STRIPE PAYOUT" }),
      inc({ amount_cents: 50000, occurred_on: "2026-07-06", description: "CHECK DEPOSIT 1042" }),
    ]
    const out = flagStatementDuplicates(rows, platform, { payouts: [payout({ net_cents: 50000, arrival_date: "2026-07-04" })] })
    expect(out[0].matchedPayoutId).toBe("bp-1")
    expect(out[1].possibleDuplicate).toBe(false)
    expect(out[1].newCandidate).toBe(true)
  })
  it("nearest-arrival matching is greedy per row in (occurred_on, index) order — NOT a global assignment", () => {
    // Documented limitation, pinned deliberately. bp-1 arrives 07-05; the 07-03
    // coincidental cheque is matched FIRST (earlier occurred_on) and is 2d away,
    // so it claims the payout the 07-05 line actually needed. Output order still
    // follows INPUT order, so out[0] is the 07-05 row.
    const rows = [
      inc({ occurred_on: "2026-07-05", description: "STRIPE PAYOUT" }),
      inc({ occurred_on: "2026-07-03", description: "CHECK DEPOSIT 1042" }),
    ]
    const out = flagStatementDuplicates(rows, [], { payouts: [payout({ arrival_date: "2026-07-05" })] })
    expect(out[1].matchedPayoutId).toBe("bp-1")
    expect(out[0].matchedPayoutId).toBeUndefined()
    expect(out[0].possibleDuplicate).toBe(false)
  })
  it("a hard internal-transfer income row never reaches the payout layer, and leaves the payout unconsumed", () => {
    // Stripe's own ACH company entry description is literally "STRIPE TRANSFER",
    // which HARD_TRANSFER_RE classifies as `is_transfer` upstream — so the payout
    // layer does not annotate it. The money default is identical (excluded), and
    // critically the payout stays available for a real bank line.
    const rows = [
      inc({ is_transfer: true, description: "STRIPE TRANSFER ST-A1B2C3" }),
      inc({ description: "DEPOSIT" }),
    ]
    const out = flagStatementDuplicates(rows, [], { payouts: [payout()] })
    expect(out[0].matchedPayoutId).toBeUndefined()
    expect(out[0].reason).toMatch(/internal transfer/)
    expect(out[0].defaultInclude).toBe(false)
    expect(out[1].matchedPayoutId).toBe("bp-1")
  })
})
