import { describe, it, expect } from "vitest"
import {
  SELECTOR_CHUNK_THRESHOLD,
  buildAlreadySelectedSection,
  dayLabel,
  dayScopedSkeleton,
  mergeAssignments,
  shouldChunkSelector,
} from "../selector-chunking.js"

describe("shouldChunkSelector", () => {
  it("chunks only ABOVE the threshold (26+), never at it", () => {
    expect(shouldChunkSelector(SELECTOR_CHUNK_THRESHOLD, 5, false)).toBe(false)
    expect(shouldChunkSelector(SELECTOR_CHUNK_THRESHOLD + 1, 5, false)).toBe(true)
  })
  it("the 2026-08-03 failure shape (60 slots, 5 days) chunks", () => {
    expect(shouldChunkSelector(60, 5, false)).toBe(true)
  })
  it("never chunks single-day requests or one-day weeks", () => {
    expect(shouldChunkSelector(60, 5, true)).toBe(false)
    expect(shouldChunkSelector(60, 1, false)).toBe(false)
  })
})

describe("dayScopedSkeleton", () => {
  const skeleton = {
    phase: "accumulation",
    total_sessions: 5,
    weeks: [
      {
        week_number: 1,
        theme: "volume",
        days: [
          { day_of_week: 1, slots: ["a", "b"] },
          { day_of_week: 3, slots: ["c"] },
        ],
      },
    ],
  }
  it("narrows week 0 to one day, keeping week and skeleton metadata", () => {
    const scoped = dayScopedSkeleton(skeleton, skeleton.weeks[0].days[1])
    expect(scoped.weeks[0].days).toEqual([{ day_of_week: 3, slots: ["c"] }])
    expect(scoped.weeks[0].theme).toBe("volume")
    expect(scoped.phase).toBe("accumulation")
    // Never mutates the original — the loop scopes the same skeleton per day.
    expect(skeleton.weeks[0].days).toHaveLength(2)
  })
})

describe("buildAlreadySelectedSection", () => {
  it("is empty for the first chunk", () => {
    expect(buildAlreadySelectedSection([])).toBe("")
  })
  it("names each pick with its id and day, and says working slots must not reuse", () => {
    const s = buildAlreadySelectedSection([
      { exercise_id: "ex-1", exercise_name: "Back Squat", day_of_week: 1 },
      { exercise_id: "ex-2", exercise_name: null, day_of_week: 3 },
    ])
    expect(s).toContain("Back Squat (ex-1) — Monday")
    expect(s).toContain("(ex-2) — Wednesday")
    expect(s).toMatch(/must NOT reuse/i)
  })
})

describe("mergeAssignments", () => {
  it("concatenates assignments and substitution notes in chunk order", () => {
    const merged = mergeAssignments([
      { assignments: [{ slot_id: "w1d1s1", exercise_id: "a" } as never], substitution_notes: ["n1"] },
      { assignments: [{ slot_id: "w1d3s1", exercise_id: "b" } as never], substitution_notes: [] },
    ])
    expect(merged.assignments.map((a) => a.slot_id)).toEqual(["w1d1s1", "w1d3s1"])
    expect(merged.substitution_notes).toEqual(["n1"])
  })
})

describe("dayLabel", () => {
  it("maps 1-7 to weekday names and falls back for junk", () => {
    expect(dayLabel(1)).toBe("Monday")
    expect(dayLabel(7)).toBe("Sunday")
    expect(dayLabel(9)).toBe("Day 9")
  })
})
