import { describe, it, expect } from "vitest"
import {
  findUnassignedSlots,
  buildUnassignedSlotsFeedback,
  buildUnfilledSlotsWarning,
  pickMoreComplete,
} from "../selector-coverage.js"
import type { ExerciseSlot, ProgramWeek } from "../types.js"

const slot = (slot_id: string, over: Partial<ExerciseSlot> = {}): ExerciseSlot => ({
  slot_id,
  role: "accessory",
  movement_pattern: "push",
  target_muscles: ["shoulders"],
  sets: 3,
  reps: "6",
  rest_seconds: 60,
  rpe_target: null,
  tempo: "4-2-4",
  group_tag: null,
  technique: "straight_set",
  ...over,
})

// Twelve slots on one Monday — the shape of the 2026-09-30 report, where the
// selector returned ONE assignment and the day was saved with one exercise.
const monday: ProgramWeek = {
  week_number: 2,
  phase: "build",
  intensity_modifier: "moderate",
  days: [
    {
      day_of_week: 1,
      label: "Shoulders",
      focus: "shoulders",
      slots: Array.from({ length: 12 }, (_, i) => slot(`w2d1s${i + 1}`)),
    },
  ],
}

const a = (slot_id: string, exercise_id = `ex-${slot_id}`) => ({
  slot_id,
  exercise_id,
  exercise_name: exercise_id,
  notes: null,
})

describe("findUnassignedSlots", () => {
  it("names every slot the selector left empty, in skeleton order", () => {
    const missing = findUnassignedSlots([a("w2d1s12")], monday)
    expect(missing.map((m) => m.slot_id)).toEqual(Array.from({ length: 11 }, (_, i) => `w2d1s${i + 1}`))
    expect(missing[0]).toMatchObject({ day_of_week: 1, role: "accessory", movement_pattern: "push" })
  })

  it("returns nothing when every slot has an assignment (presence control)", () => {
    const all = monday.days[0].slots.map((s) => a(s.slot_id))
    expect(findUnassignedSlots(all, monday)).toEqual([])
  })

  it("does not count an assignment to a slot id the skeleton never had", () => {
    const all = monday.days[0].slots.slice(1).map((s) => a(s.slot_id))
    const missing = findUnassignedSlots([...all, a("w9d9s99")], monday)
    expect(missing.map((m) => m.slot_id)).toEqual(["w2d1s1"])
  })
})

describe("buildUnassignedSlotsFeedback", () => {
  it("is empty when nothing is missing", () => {
    expect(buildUnassignedSlotsFeedback([])).toBe("")
  })

  it("lists each missing slot id and forbids leaving slots empty", () => {
    const text = buildUnassignedSlotsFeedback(findUnassignedSlots([a("w2d1s12")], monday))
    expect(text).toContain("11 of the skeleton's slots have NO assignment")
    expect(text).toContain("w2d1s1 ")
    expect(text).toContain("w2d1s11 ")
    expect(text).not.toContain("w2d1s12 ")
    expect(text).toMatch(/closest available exercise/i)
  })
})

describe("buildUnfilledSlotsWarning", () => {
  it("says how many of the planned exercises are missing, for the day", () => {
    const missing = findUnassignedSlots([a("w2d1s12")], monday)
    const [warning] = buildUnfilledSlotsWarning(missing, 12, "Monday")
    expect(warning).toContain("Monday has 1 of the 12 exercises it was planned with")
    expect(warning).toContain("11 were left empty")
  })

  it("says nothing when every slot was filled", () => {
    expect(buildUnfilledSlotsWarning([], 12, "Monday")).toEqual([])
  })

  it("uses the singular for one missing exercise", () => {
    const all = monday.days[0].slots.slice(1).map((s) => a(s.slot_id))
    const [warning] = buildUnfilledSlotsWarning(findUnassignedSlots(all, monday), 12, "Monday")
    expect(warning).toContain("1 was left empty")
  })
})

describe("pickMoreComplete", () => {
  const short = { assignments: [a("w2d1s1")], substitution_notes: [] }
  const full = { assignments: monday.days[0].slots.map((s) => a(s.slot_id)), substitution_notes: [] }

  it("keeps an earlier attempt that filled MORE slots than a later one", () => {
    expect(pickMoreComplete(full, short, monday)).toBe(full)
  })

  it("takes a later attempt that filled more slots", () => {
    expect(pickMoreComplete(short, full, monday)).toBe(full)
  })

  it("takes the later attempt on a tie — it had the retry feedback", () => {
    const shortToo = { assignments: [a("w2d1s2")], substitution_notes: [] }
    expect(pickMoreComplete(short, shortToo, monday)).toBe(shortToo)
  })

  it("on equal coverage, keeps the attempt with FEWER within-week duplicates", () => {
    // The 2026-09-30 fix run: attempt 2 was clean, attempt 3 repeated exercises,
    // and keeping attempt 3 made the post-hoc swapper replace 8 of 12 shoulder
    // picks with calf raises and jumps.
    const clean = full
    const dupes = {
      assignments: monday.days[0].slots.map((s, i) => a(s.slot_id, i < 3 ? "ex-same" : `ex-${s.slot_id}`)),
      substitution_notes: [],
    }
    expect(pickMoreComplete(clean, dupes, monday)).toBe(clean)
    expect(pickMoreComplete(dupes, clean, monday)).toBe(clean)
  })

  it("prefers coverage over duplicates — an empty slot is worse than a repeat", () => {
    const dupes = {
      assignments: monday.days[0].slots.map((s, i) => a(s.slot_id, i < 3 ? "ex-same" : `ex-${s.slot_id}`)),
      substitution_notes: [],
    }
    const cleanButShort = {
      assignments: monday.days[0].slots.slice(1).map((s) => a(s.slot_id)),
      substitution_notes: [],
    }
    expect(pickMoreComplete(cleanButShort, dupes, monday)).toBe(dupes)
  })

  it("takes the attempt when there is nothing yet", () => {
    expect(pickMoreComplete(null, short, monday)).toBe(short)
  })
})
