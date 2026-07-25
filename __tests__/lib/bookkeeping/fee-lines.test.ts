import { describe, it, expect } from "vitest"
import {
  NO_PAYOUTS_FEE_NOTE, NET_AFTER_FEES_PENDING,
  feeLineDisplay, netAfterFeesDisplay,
} from "@/lib/bookkeeping/fee-lines"
import { NO_FEE_DATA, type StripeFeeWindow } from "@/lib/bookkeeping/payout-fees"

/** Shorthand: n payouts ingested, u of them unreconciled, summing to fee. */
const w = (fee_cents: number, payout_count = 1, unreconciled_count = 0): StripeFeeWindow =>
  ({ fee_cents, payout_count, unreconciled_count })

describe("feeLineDisplay", () => {
  it("NO payouts ingested renders the hedge (payout sync flag ships OFF)", () => {
    expect(feeLineDisplay(NO_FEE_DATA)).toBe(NO_PAYOUTS_FEE_NOTE)
    expect(feeLineDisplay(NO_FEE_DATA)).toContain("no payouts ingested")
  })
  it("ingested payouts that really summed to zero print $0.00, NOT 'no payouts ingested'", () => {
    // The lie this replaces: the hedge used to fire on "sum === 0", so a window
    // whose payouts were all ingested but carried no capturable fee asserted
    // that nothing had been ingested — into a workbook that leaves the building.
    expect(feeLineDisplay(w(0, 2, 0))).toBe("$0.00")
    expect(feeLineDisplay(w(0, 2, 0))).not.toContain("no payouts ingested")
  })
  it("positive fees carry exactly one minus sign", () => {
    expect(feeLineDisplay(w(4550, 3, 0))).toBe("−$45.50")
  })
  it("a net-negative window (fee refunds) never double-signs", () => {
    // Intl already emits "-$3.00"; hand-prefixing would render "−-$3.00".
    expect(feeLineDisplay(w(-300, 1, 0))).toBe("-$3.00")
    expect(feeLineDisplay(w(-300, 1, 0)).startsWith("−")).toBe(false)
  })
  it("unreconciled payouts (manual payouts) say how many of how many are incomplete", () => {
    const s = feeLineDisplay(w(4550, 5, 2))
    expect(s).toContain("−$45.50")
    expect(s).toContain("fees incomplete for 2 of 5 payouts")
  })
  it("a single incomplete payout reads in the singular", () => {
    expect(feeLineDisplay(w(0, 1, 1))).toContain("fees incomplete for 1 of 1 payout")
    expect(feeLineDisplay(w(0, 1, 1))).not.toContain("payouts")
  })
})

describe("netAfterFeesDisplay", () => {
  it("no ingested payouts does NOT restate gross under a net label", () => {
    expect(netAfterFeesDisplay(824600, NO_FEE_DATA)).toBe(NET_AFTER_FEES_PENDING)
    expect(netAfterFeesDisplay(824600, NO_FEE_DATA)).not.toContain("8,246")
  })
  it("subtracts integer cents (12.555-style discriminator: 150200 − 4550)", () => {
    expect(netAfterFeesDisplay(150200, w(4550, 3, 0))).toBe("$1,456.50")
  })
  it("a negative fee total adds back, and says so with a plain signed number", () => {
    expect(netAfterFeesDisplay(150200, w(-300, 1, 0))).toBe("$1,505.00")
  })
  it("ingested-but-zero-fee payouts net honestly instead of hedging", () => {
    expect(netAfterFeesDisplay(150200, w(0, 2, 0))).toBe("$1,502.00")
  })
  it("an incomplete window never presents a clean net number", () => {
    const s = netAfterFeesDisplay(150200, w(4550, 5, 2))
    expect(s).toContain("$1,456.50")
    expect(s).toContain("fees incomplete for 2 of 5 payouts")
  })
})
