import { describe, it, expect } from "vitest"
import { streakFromDates } from "@/lib/workout/streak"

describe("streakFromDates", () => {
  it("counts consecutive days ending today", () => {
    expect(streakFromDates(["2026-06-13", "2026-06-12", "2026-06-11"], "2026-06-13", "2026-06-12")).toBe(3)
  })
  it("counts when most recent is yesterday", () => {
    expect(streakFromDates(["2026-06-12", "2026-06-11"], "2026-06-13", "2026-06-12")).toBe(2)
  })
  it("breaks on a gap", () => {
    expect(streakFromDates(["2026-06-13", "2026-06-11"], "2026-06-13", "2026-06-12")).toBe(1)
  })
  it("zero when latest older than yesterday", () => {
    expect(streakFromDates(["2026-06-01"], "2026-06-13", "2026-06-12")).toBe(0)
  })
  it("zero when empty", () => {
    expect(streakFromDates([], "2026-06-13", "2026-06-12")).toBe(0)
  })
  it("handles month boundary", () => {
    expect(streakFromDates(["2026-06-01", "2026-05-31", "2026-05-30"], "2026-06-01", "2026-05-31")).toBe(3)
  })
  it("dedupes duplicate dates", () => {
    expect(streakFromDates(["2026-06-13", "2026-06-13", "2026-06-12"], "2026-06-13", "2026-06-12")).toBe(2)
  })
})
