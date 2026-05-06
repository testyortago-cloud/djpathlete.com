import { describe, it, expect } from "vitest"
import { buildExcludeIdSet, buildExerciseRows, buildSlotLookups } from "../shared-helpers.js"
import type { PriorWeekContext } from "../dedup-verify.js"
import type { ProgramWeek } from "../types.js"

function ctxWith(rolesToIds: Record<string, string[]>): PriorWeekContext {
  const used = new Map<string, Set<string>>()
  const exerciseWeekMap = new Map<string, number[]>()
  const excluded = new Set<string>()
  for (const [groupKey, ids] of Object.entries(rolesToIds)) {
    used.set(groupKey, new Set(ids))
    for (const id of ids) {
      exerciseWeekMap.set(id, [1])
      excluded.add(id)
    }
  }
  return {
    anchor_exercises: new Map(),
    used_accessory_exercises: used,
    exercise_week_map: exerciseWeekMap,
    excluded_exercise_ids: excluded,
    prompt_text: "",
  }
}

describe("buildExcludeIdSet", () => {
  it("returns excluded ids matching the requested roles", () => {
    const ctx = ctxWith({
      "primary_compound|squat|quads": ["ex-1", "ex-2"],
      "isolation|rotation|obliques": ["ex-3"],
    })
    const out = buildExcludeIdSet(ctx, new Set(["primary_compound", "secondary_compound", "accessory", "isolation"]))
    expect(out.has("ex-1")).toBe(true)
    expect(out.has("ex-2")).toBe(true)
    expect(out.has("ex-3")).toBe(true)
  })

  it("returns empty set when no roles match", () => {
    const ctx = ctxWith({ "primary_compound|squat|quads": ["ex-1"] })
    const out = buildExcludeIdSet(ctx, new Set(["warm_up"]))
    expect(out.size).toBe(0)
  })
})

describe("buildExerciseRows persists slot_role", () => {
  it("writes slot_role from slotDetailsLookup into output rows", () => {
    const weeks: ProgramWeek[] = [{
      week_number: 1, phase: "x", intensity_modifier: "moderate",
      days: [{ day_of_week: 1, label: "L", focus: "f", slots: [{
        slot_id: "w1d1s1", role: "primary_compound", movement_pattern: "squat",
        target_muscles: ["quads"], sets: 3, reps: "5", rest_seconds: 120,
        rpe_target: 8, tempo: null, group_tag: null, technique: "straight_set",
        intensity_pct: null,
      }] }],
    }]
    const { slotLookup, slotDetailsLookup } = buildSlotLookups(weeks)
    const rows = buildExerciseRows(
      [{ slot_id: "w1d1s1", exercise_id: "ex-1", notes: null }],
      slotLookup, slotDetailsLookup, "prog-1",
    )
    expect(rows[0].slot_role).toBe("primary_compound")
  })
})
