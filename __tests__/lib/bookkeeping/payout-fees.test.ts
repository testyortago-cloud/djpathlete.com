import { describe, it, expect } from "vitest"
import { stripeFeeWindow, NO_FEE_DATA } from "@/lib/bookkeeping/payout-fees"

/** The fee sum alone — every consumer now takes the whole window, so the scalar
 *  lives here as a test convenience rather than as a shippable API. */
const stripeFeesInWindow = (lines: Parameters<typeof stripeFeeWindow>[0], from: string, to: string) =>
  stripeFeeWindow(lines, [], from, to).fee_cents

// Unique prime-ish fee values: any wrong boundary inclusion/exclusion
// produces a sum no other subset can produce (mutation-discriminating).
const lines = [
  { txn_date: "2026-06-30", fee_cents: 111 }, // day before from — excluded
  { txn_date: "2026-07-01", fee_cents: 257 }, // from day — included
  { txn_date: "2026-07-15", fee_cents: 389 }, // mid — included
  { txn_date: "2026-07-31", fee_cents: 643 }, // to day — included
  { txn_date: "2026-08-01", fee_cents: 1009 }, // day after to — excluded
]

describe("stripeFeeWindow — fee sum", () => {
  it("sums fee_cents over txn_date in [from, to] inclusive both ends", () => {
    expect(stripeFeesInWindow(lines, "2026-07-01", "2026-07-31")).toBe(257 + 389 + 643) // 1289
  })
  it("boundary days count; adjacent days do not (discriminates > vs >= and < vs <=)", () => {
    expect(stripeFeesInWindow(lines, "2026-06-30", "2026-06-30")).toBe(111)
    expect(stripeFeesInWindow(lines, "2026-07-02", "2026-07-30")).toBe(389)
  })
  it("empty lines → 0 (the honest pre-first-sync state)", () => {
    expect(stripeFeesInWindow([], "2026-01-01", "2026-12-31")).toBe(0)
  })
  it("all lines outside the window → 0", () => {
    expect(stripeFeesInWindow(lines, "2027-01-01", "2027-12-31")).toBe(0)
  })
})

// ── Availability, not "sum === 0" ─────────────────────────────────────────────
// A window's fee total is only meaningful next to "how many payouts produced it"
// and "how many of those we could not fully explain". Manual Stripe payouts
// return NO constituent balance transactions, so a real payout can contribute
// zero fee lines — "$0.00" and "no data" must never be the same signal.
// Payout ids are deliberately reused across lines so counting LINES instead of
// DISTINCT PAYOUTS is a discriminating failure.
const scoped = [
  { txn_date: "2026-06-30", fee_cents: 111, payout_id: "p_before", fees_reconciled: true },
  { txn_date: "2026-07-01", fee_cents: 257, payout_id: "p_a", fees_reconciled: true },
  { txn_date: "2026-07-02", fee_cents: 389, payout_id: "p_a", fees_reconciled: true },
  { txn_date: "2026-07-15", fee_cents: 643, payout_id: "p_b", fees_reconciled: false },
  { txn_date: "2026-07-16", fee_cents: 1009, payout_id: "p_b", fees_reconciled: false },
  { txn_date: "2026-08-01", fee_cents: 1201, payout_id: "p_after", fees_reconciled: false },
]

describe("stripeFeeWindow", () => {
  it("counts DISTINCT payouts, not lines, and carries the fee sum", () => {
    expect(stripeFeeWindow(scoped, [], "2026-07-01", "2026-07-31")).toEqual({
      fee_cents: 257 + 389 + 643 + 1009, // 2298
      payout_count: 2, // p_a, p_b — four lines
      unreconciled_count: 1, // p_b only, counted once despite two lines
    })
  })
  it("a payout whose only lines fall outside the window contributes nothing", () => {
    const w = stripeFeeWindow(scoped, [], "2026-07-01", "2026-07-02")
    expect(w).toEqual({ fee_cents: 257 + 389, payout_count: 1, unreconciled_count: 0 })
  })
  it("no lines → NO_FEE_DATA, the only shape that may render 'no payouts ingested'", () => {
    expect(stripeFeeWindow([], [], "2026-01-01", "2026-12-31")).toEqual(NO_FEE_DATA)
    expect(stripeFeeWindow(scoped, [], "2027-01-01", "2027-12-31")).toEqual(NO_FEE_DATA)
  })
  it("payouts whose ingested fees sum to zero are still INGESTED (the manual-payout case)", () => {
    // A manual payout ingests with gross 0 / fee 0 and fees_reconciled false;
    // any refund-only window can also sum to 0. Neither is "no data".
    const w = stripeFeeWindow(
      [{ txn_date: "2026-07-05", fee_cents: 0, payout_id: "p_manual", fees_reconciled: false }],
      [],
      "2026-07-01",
      "2026-07-31",
    )
    expect(w.fee_cents).toBe(0)
    expect(w.payout_count).toBe(1)
    expect(w.unreconciled_count).toBe(1)
  })
  it("lines with no payout_id still count as ingested data (never a false zero-state)", () => {
    const w = stripeFeeWindow(lines, [], "2026-07-01", "2026-07-31")
    expect(w.fee_cents).toBe(1289)
    expect(w.payout_count).toBe(1)
    expect(w.unreconciled_count).toBe(0)
  })
  // ── The line-only count is not enough ───────────────────────────────────────
  // Stripe returns constituent balance transactions for AUTOMATIC payouts only,
  // so a manual "Pay out now" ingests with NO lines whatsoever. Counting only
  // line-bearing payouts would report "no payouts ingested" for a window made
  // entirely of manual payouts — the exact falsehood, restated one layer down.
  it("a payout that produced NO lines still counts, through the arrival-date set", () => {
    expect(stripeFeeWindow([], [{ id: "p_manual", fees_reconciled: false }], "2026-07-01", "2026-07-31")).toEqual({
      fee_cents: 0, payout_count: 1, unreconciled_count: 1,
    })
  })
  it("a payout in BOTH sets is counted once (union by id, never doubled)", () => {
    expect(stripeFeeWindow(scoped, [
      { id: "p_a", fees_reconciled: true },
      { id: "p_b", fees_reconciled: false },
    ], "2026-07-01", "2026-07-31")).toEqual({
      fee_cents: 2298, payout_count: 2, unreconciled_count: 1,
    })
  })
  it("a payout arriving in-window whose fees landed in an earlier window still counts as ingested", () => {
    // Fees attribute by balance-txn date (A-3), so this payout contributes no
    // fee_cents here — but it is emphatically not "no payout data".
    const w = stripeFeeWindow(scoped, [{ id: "p_after", fees_reconciled: false }], "2026-07-01", "2026-07-31")
    expect(w.fee_cents).toBe(2298)
    expect(w.payout_count).toBe(3)
    expect(w.unreconciled_count).toBe(2)
  })
  it("fee_cents always agrees with the plain windowed sum (one truth, two shapes)", () => {
    for (const [f, t] of [["2026-07-01", "2026-07-31"], ["2026-06-30", "2026-06-30"], ["2027-01-01", "2027-12-31"]]) {
      expect(stripeFeeWindow(scoped, [], f, t).fee_cents).toBe(stripeFeesInWindow(scoped, f, t))
    }
  })
})
