import { describe, it, expect } from "vitest"
import { nextIncompleteSlot, recomputeWeek, dayKey, type DaySlot } from "@/lib/services/program-progression"

const slots: DaySlot[] = [
  { week_number: 1, day_of_week: 1 },
  { week_number: 1, day_of_week: 3 },
  { week_number: 2, day_of_week: 1 },
]

describe("dayKey", () => {
  it("formats week-day", () => {
    expect(dayKey({ week_number: 2, day_of_week: 5 })).toBe("2-5")
  })
})

describe("nextIncompleteSlot", () => {
  it("returns the first slot when nothing is complete", () => {
    expect(nextIncompleteSlot(slots, new Set())).toEqual({ week_number: 1, day_of_week: 1 })
  })
  it("skips completed slots in order", () => {
    expect(nextIncompleteSlot(slots, new Set(["1-1"]))).toEqual({ week_number: 1, day_of_week: 3 })
    expect(nextIncompleteSlot(slots, new Set(["1-1", "1-3"]))).toEqual({ week_number: 2, day_of_week: 1 })
  })
  it("returns null when all complete", () => {
    expect(nextIncompleteSlot(slots, new Set(["1-1", "1-3", "2-1"]))).toBeNull()
  })
  it("returns null for an empty program", () => {
    expect(nextIncompleteSlot([], new Set())).toBeNull()
  })
})

describe("recomputeWeek", () => {
  it("is the lowest incomplete week", () => {
    expect(recomputeWeek(slots, new Set())).toBe(1)
    expect(recomputeWeek(slots, new Set(["1-1", "1-3"]))).toBe(2)
  })
  it("rolls back when a key is removed (void)", () => {
    const completed = new Set(["1-1", "1-3", "2-1"])
    expect(recomputeWeek(slots, completed)).toBeNull() // complete
    completed.delete("2-1")
    expect(recomputeWeek(slots, completed)).toBe(2) // reopened → back to week 2
  })
  it("is null when the program is complete", () => {
    expect(recomputeWeek(slots, new Set(["1-1", "1-3", "2-1"]))).toBeNull()
  })
})
