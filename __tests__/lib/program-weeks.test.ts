import { describe, it, expect } from "vitest"
import { effectiveTotalWeeks, savedSetsForSlot, slotKey, sourceWeekForDisplay } from "@/lib/program-weeks"

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

describe("sourceWeekForDisplay", () => {
  it("returns null when no week has content (genuinely empty program)", () => {
    expect(sourceWeekForDisplay(1, [])).toBeNull()
    expect(sourceWeekForDisplay(4, [])).toBeNull()
  })

  it("returns the week itself when it has its own content", () => {
    expect(sourceWeekForDisplay(2, [1, 2, 3])).toBe(2)
  })

  it("repeats the closest earlier built week for a blank later week (only Week 1 built)", () => {
    // The Sienna case: only Week 1 built, program runs 4 weeks → 2,3,4 repeat Week 1
    expect(sourceWeekForDisplay(2, [1])).toBe(1)
    expect(sourceWeekForDisplay(3, [1])).toBe(1)
    expect(sourceWeekForDisplay(4, [1])).toBe(1)
  })

  it("picks the nearest earlier built week when several weeks are built", () => {
    // Built weeks 1 and 3; week 2 repeats 1, week 4+ repeats 3
    expect(sourceWeekForDisplay(2, [1, 3])).toBe(1)
    expect(sourceWeekForDisplay(4, [1, 3])).toBe(3)
  })

  it("falls back to the earliest built week when the target precedes all built weeks", () => {
    // Coach built Week 2 first, left Week 1 blank → Week 1 shows Week 2's content
    expect(sourceWeekForDisplay(1, [2, 3])).toBe(2)
  })

  it("is order-independent in the input array", () => {
    expect(sourceWeekForDisplay(4, [3, 1])).toBe(3)
  })

  it("matches the legacy inline fallback across a full week range", () => {
    // Reference implementation = the loop that used to live in the client page.
    const legacy = (w: number, defined: number[]): number | null => {
      if (defined.length === 0) return null
      const sorted = [...defined].sort((a, b) => a - b)
      let s = sorted[0]
      for (const dw of sorted) {
        if (dw <= w) s = dw
        else break
      }
      return s
    }
    const cases: number[][] = [[], [1], [1, 2, 3], [1, 3], [2, 4], [2]]
    for (const defined of cases) {
      for (let w = 1; w <= 6; w++) {
        expect(sourceWeekForDisplay(w, defined)).toBe(legacy(w, defined))
      }
    }
  })
})

/**
 * The set table refills from the log the athlete saved for THIS week and day.
 * Refilling from the newest log of the exercise (any week) showed last week's
 * sets and reps instead of the coach's; refilling only "today" in the athlete's
 * current_week (stuck at 1 on 17 of 20 assignments) blanked the form they saved.
 */
describe("savedSetsForSlot", () => {
  const wk10 = [{ set_number: 1, weight_kg: 20, reps: 8, rpe: null }]
  const wk9 = [1, 2, 3].map((n) => ({ set_number: n, weight_kg: 20, reps: 12, rpe: null }))
  const slots = new Map([
    ["s-wk9", slotKey("a-1", 9, 2)],
    ["s-wk10", slotKey("a-1", 10, 3)],
  ])

  it("returns this slot's log even when a newer log from another week exists", () => {
    const history = [
      { session_id: "s-wk9", set_details: wk9 },
      { session_id: "s-wk10", set_details: wk10 },
    ]
    expect(savedSetsForSlot(history, slots, slotKey("a-1", 10, 3))).toBe(wk10)
  })

  it("returns null when the only logs belong to other weeks", () => {
    const history = [{ session_id: "s-wk9", set_details: wk9 }]
    expect(savedSetsForSlot(history, slots, slotKey("a-1", 10, 3))).toBeNull()
  })

  it("returns null for a log with no session", () => {
    expect(savedSetsForSlot([{ session_id: null, set_details: wk9 }], slots, slotKey("a-1", 9, 2))).toBeNull()
  })

  it("keeps assignments apart", () => {
    const history = [{ session_id: "s-wk9", set_details: wk9 }]
    expect(savedSetsForSlot(history, slots, slotKey("a-2", 9, 2))).toBeNull()
  })
})
