import { describe, it, expect } from "vitest"
import { computeSyncWindow } from "@/lib/bookkeeping/income-sync-window"

describe("computeSyncWindow", () => {
  it("watermark present → from = watermark − 14 days (discriminates 13/15)", () => {
    // 2026-07-20 − 14d = 2026-07-06 (13d → 07-07, 15d → 07-05)
    expect(computeSyncWindow("2026-07-20", "2026-07-24")).toEqual({ from: "2026-07-06", to: "2026-07-24" })
  })

  it("no watermark → from = today − 90 days", () => {
    // 2026-07-24 − 90d = 2026-04-25 (Apr 25→30 =5, +31 May, +30 Jun, +24 Jul = 90)
    expect(computeSyncWindow(null, "2026-07-24")).toEqual({ from: "2026-04-25", to: "2026-07-24" })
  })

  it("crosses month AND year boundaries", () => {
    // 2026-01-05 − 14d = 2025-12-22
    expect(computeSyncWindow("2026-01-05", "2026-01-10")).toEqual({ from: "2025-12-22", to: "2026-01-10" })
  })

  it("future-dated watermark clamps from to today (never an inverted window)", () => {
    expect(computeSyncWindow("2026-08-30", "2026-07-24")).toEqual({ from: "2026-07-24", to: "2026-07-24" })
  })

  it("watermark exactly today still rewinds the overlap margin", () => {
    expect(computeSyncWindow("2026-07-24", "2026-07-24")).toEqual({ from: "2026-07-10", to: "2026-07-24" })
  })
})
