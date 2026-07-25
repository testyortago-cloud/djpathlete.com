import { describe, it, expect } from "vitest"
import {
  NO_PAYOUTS_FEE_NOTE, NET_AFTER_FEES_PENDING,
  feeLineDisplay, netAfterFeesDisplay,
} from "@/lib/bookkeeping/fee-lines"

describe("feeLineDisplay", () => {
  it("zero fees render the hedge, never a bare $0.00 (payout sync flag ships OFF)", () => {
    expect(feeLineDisplay(0)).toBe(NO_PAYOUTS_FEE_NOTE)
    expect(feeLineDisplay(0)).toContain("no payouts ingested")
  })
  it("positive fees carry exactly one minus sign", () => {
    expect(feeLineDisplay(4550)).toBe("−$45.50")
  })
  it("a net-negative window (fee refunds) never double-signs", () => {
    // Intl already emits "-$3.00"; hand-prefixing would render "−-$3.00".
    expect(feeLineDisplay(-300)).toBe("-$3.00")
    expect(feeLineDisplay(-300).startsWith("−")).toBe(false)
  })
})

describe("netAfterFeesDisplay", () => {
  it("zero fees do NOT restate gross under a net label", () => {
    expect(netAfterFeesDisplay(824600, 0)).toBe(NET_AFTER_FEES_PENDING)
    expect(netAfterFeesDisplay(824600, 0)).not.toContain("8,246")
  })
  it("subtracts integer cents (12.555-style discriminator: 150200 − 4550)", () => {
    expect(netAfterFeesDisplay(150200, 4550)).toBe("$1,456.50")
  })
  it("a negative fee total adds back, and says so with a plain signed number", () => {
    expect(netAfterFeesDisplay(150200, -300)).toBe("$1,505.00")
  })
})
