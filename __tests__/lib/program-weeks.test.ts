import { describe, it, expect } from "vitest"
import { effectiveTotalWeeks } from "@/lib/program-weeks"

describe("effectiveTotalWeeks", () => {
  it("uses the live program duration when the snapshot is stale (the Luke bug)", () => {
    // assignment frozen at 1 week, program later expanded to 10
    expect(effectiveTotalWeeks(1, 10, 3)).toBe(10)
  })

  it("uses content weeks when they exceed both snapshot and duration", () => {
    expect(effectiveTotalWeeks(2, 2, 5)).toBe(5)
  })

  it("keeps the snapshot when it is the largest (per-client extension)", () => {
    expect(effectiveTotalWeeks(8, 4, 2)).toBe(8)
  })

  it("treats a 1-week program as exactly 1 week (Ava 2.0)", () => {
    expect(effectiveTotalWeeks(1, 1, 1)).toBe(1)
  })

  it("never returns less than 1, even with all-null inputs", () => {
    expect(effectiveTotalWeeks(null, null)).toBe(1)
    expect(effectiveTotalWeeks(undefined, undefined, 0)).toBe(1)
  })

  it("ignores the optional content arg when omitted", () => {
    expect(effectiveTotalWeeks(1, 6)).toBe(6)
  })
})
