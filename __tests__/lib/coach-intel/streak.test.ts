import { describe, it, expect } from "vitest"
import { currentStreak, longestStreak } from "@/lib/coach-intel/streak"

describe("currentStreak", () => {
  it("counts consecutive non-zero days ending today", () => {
    const daily = [
      { date: "2026-05-12", load: 300 },
      { date: "2026-05-13", load: 200 },
      { date: "2026-05-14", load: 400 },
    ]
    expect(currentStreak(daily, "2026-05-14")).toBe(3)
  })

  it("returns 0 when today has no load", () => {
    const daily = [
      { date: "2026-05-12", load: 300 },
      { date: "2026-05-13", load: 200 },
    ]
    expect(currentStreak(daily, "2026-05-14")).toBe(0)
  })

  it("breaks on the first zero-day going backwards", () => {
    const daily = [
      { date: "2026-05-11", load: 100 },
      { date: "2026-05-13", load: 200 },
      { date: "2026-05-14", load: 300 },
    ]
    expect(currentStreak(daily, "2026-05-14")).toBe(2)
  })
})

describe("longestStreak", () => {
  it("finds the longest consecutive non-zero run", () => {
    const daily = [
      { date: "2026-05-01", load: 100 },
      { date: "2026-05-02", load: 100 },
      { date: "2026-05-04", load: 100 },
      { date: "2026-05-05", load: 100 },
      { date: "2026-05-06", load: 100 },
    ]
    expect(longestStreak(daily)).toBe(3)
  })

  it("returns 0 when no days have load", () => {
    expect(longestStreak([{ date: "2026-05-01", load: 0 }])).toBe(0)
  })
})
