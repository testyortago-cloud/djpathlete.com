import { describe, it, expect } from "vitest"
import { computePayoutSyncWindow } from "@/lib/bookkeeping/payout-sync-window"

describe("computePayoutSyncWindow", () => {
  it("watermark present → fromDate = watermark − 14 days with epoch-seconds twin (discriminates 13/15d and ms-vs-s)", () => {
    // 2026-07-20 − 14d = 2026-07-06 (13d → 07-07, 15d → 07-05).
    // 2026-07-06T00:00:00Z = 1783296000 s (a ms value would be 1000× larger).
    expect(computePayoutSyncWindow("2026-07-20", "2026-07-24")).toEqual({
      fromDate: "2026-07-06",
      fromEpochSeconds: 1783296000,
      to: "2026-07-24",
    })
  })

  it("cold start (null watermark) → NO lower bound: full history (Decision A-4)", () => {
    expect(computePayoutSyncWindow(null, "2026-07-24")).toEqual({
      fromDate: null,
      fromEpochSeconds: null,
      to: "2026-07-24",
    })
  })

  it("crosses month AND year boundaries", () => {
    // 2026-01-05 − 14d = 2025-12-22 = 1766361600 s
    expect(computePayoutSyncWindow("2026-01-05", "2026-01-10")).toEqual({
      fromDate: "2025-12-22",
      fromEpochSeconds: 1766361600,
      to: "2026-01-10",
    })
  })

  it("future-dated watermark clamps fromDate to today (never an inverted window)", () => {
    const w = computePayoutSyncWindow("2026-08-30", "2026-07-24")
    expect(w.fromDate).toBe("2026-07-24")
    expect(w.to).toBe("2026-07-24")
    expect(w.fromEpochSeconds).toBe(Date.parse("2026-07-24T00:00:00Z") / 1000)
  })

  it("watermark exactly today still rewinds the overlap margin", () => {
    expect(computePayoutSyncWindow("2026-07-24", "2026-07-24").fromDate).toBe("2026-07-10")
  })
})
