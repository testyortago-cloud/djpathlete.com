import { describe, it, expect } from "vitest"
import { stripeFeesInWindow } from "@/lib/bookkeeping/payout-fees"

// Unique prime-ish fee values: any wrong boundary inclusion/exclusion
// produces a sum no other subset can produce (mutation-discriminating).
const lines = [
  { txn_date: "2026-06-30", fee_cents: 111 }, // day before from — excluded
  { txn_date: "2026-07-01", fee_cents: 257 }, // from day — included
  { txn_date: "2026-07-15", fee_cents: 389 }, // mid — included
  { txn_date: "2026-07-31", fee_cents: 643 }, // to day — included
  { txn_date: "2026-08-01", fee_cents: 1009 }, // day after to — excluded
]

describe("stripeFeesInWindow", () => {
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
