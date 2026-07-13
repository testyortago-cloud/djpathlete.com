import { describe, it, expect } from "vitest"
import {
  applyPoolFilter,
  buildExcludeIdSet,
  buildExerciseRows,
  buildPoolNote,
  buildSlotLookups,
  dedupeSkeletonDaysInPlace,
  filterCandidateEquipment,
  resolveCrossDayExcludeIds,
  findUncoveredPatterns,
  remapUncoveredSlotPatterns,
  buildPoolPatternSection,
} from "../shared-helpers.js"
import type { PriorWeekContext } from "../dedup-verify.js"
import type { ProgramWeek, CompressedExercise } from "../types.js"

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

describe("applyPoolFilter pool modes", () => {
  const lib = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]

  it("returns the full library in preferred mode (default) when a pool is set", () => {
    const out = applyPoolFilter(lib, ["a", "b"], "test", "preferred")
    expect(out).toHaveLength(4)
    expect(out.map((e) => e.id)).toEqual(["a", "b", "c", "d"])
  })

  it("hard-filters to the pool in strict mode", () => {
    const out = applyPoolFilter(lib, ["a", "b"], "test", "strict")
    expect(out.map((e) => e.id).sort()).toEqual(["a", "b"])
  })

  it("returns the full library when no pool ids are provided", () => {
    expect(applyPoolFilter(lib, undefined, "test", "preferred")).toEqual(lib)
    expect(applyPoolFilter(lib, [], "test", "strict")).toEqual(lib)
  })
})

describe("buildPoolNote mode-aware language", () => {
  it("emits 'MUST select ONLY' language in strict mode", () => {
    const note = buildPoolNote(["a", "b"], 2, "strict")
    expect(note).toMatch(/MUST select from these exercises ONLY/i)
  })

  it("emits 'STRONGLY PREFERRED' language in preferred mode", () => {
    const note = buildPoolNote(["a", "b"], 100, "preferred", 2)
    expect(note).toMatch(/STRONGLY PREFERRED/i)
    expect(note).toMatch(/curated an Exercise Pool of 2/i)
  })

  it("returns empty string when no pool ids are set", () => {
    expect(buildPoolNote(undefined, 0, "preferred")).toBe("")
    expect(buildPoolNote([], 0, "strict")).toBe("")
  })
})

describe("filterCandidateEquipment honors pool over equipment (strict mode)", () => {
  const exercises = [
    { id: "bw", is_bodyweight: true, equipment_required: [] },
    { id: "db", is_bodyweight: false, equipment_required: ["dumbbell"] },
  ] as unknown as CompressedExercise[]

  it("keeps equipment-requiring exercises when pool is active, even with no equipment", () => {
    const out = filterCandidateEquipment(exercises, [], true)
    expect(out.map((e) => e.id).sort()).toEqual(["bw", "db"])
  })

  it("drops equipment-requiring exercises when not pool-active and equipment is unavailable", () => {
    const out = filterCandidateEquipment(exercises, [], false)
    expect(out.map((e) => e.id)).toEqual(["bw"])
  })
})

describe("resolveCrossDayExcludeIds relaxes exclusion in strict pool mode", () => {
  const ctx = ctxWith({ "primary_compound|squat|quads": ["ex-1", "ex-2"] })
  const roles = new Set(["primary_compound", "secondary_compound", "accessory", "isolation"])

  it("returns an empty set when the pool is active (strict) so a small pool can repeat across days", () => {
    expect(resolveCrossDayExcludeIds(ctx, roles, true).size).toBe(0)
  })

  it("excludes prior-used ids when not pool-active (normal cross-day variety)", () => {
    const out = resolveCrossDayExcludeIds(ctx, roles, false)
    expect(out.has("ex-1")).toBe(true)
    expect(out.has("ex-2")).toBe(true)
  })
})

describe("findUncoveredPatterns flags patterns the candidate pool cannot fill", () => {
  function weekWithPatterns(patterns: string[]): ProgramWeek {
    return {
      week_number: 1,
      phase: "x",
      intensity_modifier: "moderate",
      days: [
        {
          day_of_week: 1,
          label: "L",
          focus: "f",
          slots: patterns.map((p, i) => ({
            slot_id: `w1d1s${i + 1}`,
            role: "primary_compound",
            movement_pattern: p,
            target_muscles: [],
            sets: 3,
            reps: "5",
            rest_seconds: 60,
            rpe_target: 7,
            tempo: null,
            group_tag: null,
            technique: "straight_set",
            intensity_pct: null,
          })),
        },
      ],
    } as ProgramWeek
  }

  it("returns required patterns missing from the candidate set", () => {
    const weeks = [weekWithPatterns(["squat", "rotation", "push"])]
    const candidates = [
      { movement_pattern: "rotation" },
      { movement_pattern: "locomotion" },
    ] as unknown as CompressedExercise[]
    expect(findUncoveredPatterns(weeks, candidates).sort()).toEqual(["push", "squat"])
  })

  it("returns an empty array when every required pattern is covered", () => {
    const weeks = [weekWithPatterns(["rotation"])]
    const candidates = [{ movement_pattern: "rotation" }] as unknown as CompressedExercise[]
    expect(findUncoveredPatterns(weeks, candidates)).toEqual([])
  })
})

describe("remapUncoveredSlotPatterns coerces skeleton patterns onto pool coverage", () => {
  function weekWithPatterns(patterns: string[]): ProgramWeek {
    return {
      week_number: 10,
      phase: "x",
      intensity_modifier: "moderate",
      days: [
        {
          day_of_week: 4,
          label: "Thu",
          focus: "f",
          slots: patterns.map((p, i) => ({
            slot_id: `w10d4s${i + 1}`,
            role: "primary_compound",
            movement_pattern: p,
            target_muscles: [],
            sets: 3,
            reps: "5",
            rest_seconds: 60,
            rpe_target: 7,
            tempo: null,
            group_tag: null,
            technique: "straight_set",
            intensity_pct: null,
          })),
        },
      ],
    } as ProgramWeek
  }

  it("remaps uncovered patterns to the nearest neighbor the pool has", () => {
    // Pool covers squat + push only; skeleton demands carry + locomotion + squat.
    const weeks = [weekWithPatterns(["carry", "locomotion", "squat"])]
    const pool = [
      { movement_pattern: "squat" },
      { movement_pattern: "squat" },
      { movement_pattern: "push" },
    ] as unknown as CompressedExercise[]

    const remaps = remapUncoveredSlotPatterns(weeks, pool)

    expect(remaps).toHaveLength(2)
    const patterns = weeks[0].days[0].slots.map((s) => s.movement_pattern)
    // Every slot now maps to something the pool covers…
    for (const p of patterns) expect(["squat", "push"]).toContain(p)
    // …and the covered slot was left untouched.
    expect(patterns[2]).toBe("squat")
    // Coverage check now passes — the exact scenario that used to throw.
    expect(findUncoveredPatterns(weeks, pool)).toEqual([])
  })

  it("falls back to the pool's most common pattern when no neighbor matches", () => {
    const weeks = [weekWithPatterns(["carry"])]
    // None of carry's neighbors (hinge/isometric/locomotion/pull) present.
    const pool = [
      { movement_pattern: "rotation" },
      { movement_pattern: "rotation" },
      { movement_pattern: "conditioning" },
    ] as unknown as CompressedExercise[]

    const remaps = remapUncoveredSlotPatterns(weeks, pool)
    expect(remaps).toEqual([{ slot_id: "w10d4s1", from: "carry", to: "rotation" }])
  })

  it("is a no-op when the pool has no patterned exercises", () => {
    const weeks = [weekWithPatterns(["carry"])]
    const pool = [{ movement_pattern: null }] as unknown as CompressedExercise[]
    expect(remapUncoveredSlotPatterns(weeks, pool)).toEqual([])
    expect(weeks[0].days[0].slots[0].movement_pattern).toBe("carry")
  })

  it("is a no-op when every slot is already covered", () => {
    const weeks = [weekWithPatterns(["squat", "push"])]
    const pool = [
      { movement_pattern: "squat" },
      { movement_pattern: "push" },
    ] as unknown as CompressedExercise[]
    expect(remapUncoveredSlotPatterns(weeks, pool)).toEqual([])
  })
})

describe("buildPoolPatternSection tells the architect what the pool covers", () => {
  const pool = [
    { name: "Goblet Squat", movement_pattern: "squat" },
    { name: "Push-up", movement_pattern: "push" },
  ] as unknown as CompressedExercise[]

  it("lists the pool's patterns and exercises in strict mode", () => {
    const section = buildPoolPatternSection(pool, true)
    expect(section).toMatch(/STRICT EXERCISE POOL/)
    expect(section).toMatch(/squat, push|push, squat/)
    expect(section).toMatch(/Goblet Squat \(squat\)/)
  })

  it("returns empty string when the pool is not active", () => {
    expect(buildPoolPatternSection(pool, false)).toBe("")
  })

  it("returns empty string for an empty or unpatterned pool", () => {
    expect(buildPoolPatternSection([], true)).toBe("")
    expect(
      buildPoolPatternSection([{ name: "X", movement_pattern: null }] as unknown as CompressedExercise[], true),
    ).toBe("")
  })
})

describe("buildExerciseRows sanitizes internal slot refs out of notes", () => {
  function slotsForWeek(): ProgramWeek[] {
    return [
      {
        week_number: 2,
        phase: "x",
        intensity_modifier: "moderate",
        days: [
          {
            day_of_week: 1,
            label: "Mon",
            focus: "f",
            slots: [1, 2].map((i) => ({
              slot_id: `w2d1s${i}`,
              role: "accessory",
              movement_pattern: "hinge",
              target_muscles: ["glutes"],
              sets: 3,
              reps: "8",
              rest_seconds: 60,
              rpe_target: 7,
              tempo: null,
              group_tag: "A",
              technique: "superset",
              intensity_pct: null,
            })),
          },
        ],
      } as ProgramWeek,
    ]
  }

  it("replaces slot ids in notes with the paired exercise's name", () => {
    const { slotLookup, slotDetailsLookup } = buildSlotLookups(slotsForWeek())
    const rows = buildExerciseRows(
      [
        {
          slot_id: "w2d1s1",
          exercise_id: "ex-1",
          exercise_name: "Single Leg Hip Thrust",
          notes: "Superset with w2d1s2. 4-second eccentric.",
        },
        { slot_id: "w2d1s2", exercise_id: "ex-2", exercise_name: "Single Leg RDL", notes: "Superset with W2D1S1" },
      ],
      slotLookup,
      slotDetailsLookup,
      "prog-1",
    )
    expect(rows[0].notes).toBe("Superset with Single Leg RDL. 4-second eccentric.")
    // Case-insensitive replacement.
    expect(rows[1].notes).toBe("Superset with Single Leg Hip Thrust")
  })

  it("degrades unresolvable slot refs to a generic phrase", () => {
    const { slotLookup, slotDetailsLookup } = buildSlotLookups(slotsForWeek())
    const rows = buildExerciseRows(
      [{ slot_id: "w2d1s1", exercise_id: "ex-1", exercise_name: "Hip Thrust", notes: "Superset with w9d9s9" }],
      slotLookup,
      slotDetailsLookup,
      "prog-1",
    )
    expect(rows[0].notes).toBe("Superset with the paired exercise")
  })

  it("strips parenthesized exercise-id fragments", () => {
    const { slotLookup, slotDetailsLookup } = buildSlotLookups(slotsForWeek())
    const rows = buildExerciseRows(
      [
        {
          slot_id: "w2d1s1",
          exercise_id: "ex-1",
          exercise_name: "A",
          notes: "Different from Week 1's wall drops (81e06b26) — freestanding (3fa85f64-5717-4562-b3fc-2c963f66afa6) now.",
        },
      ],
      slotLookup,
      slotDetailsLookup,
      "prog-1",
    )
    expect(rows[0].notes).toBe("Different from Week 1's wall drops — freestanding now.")
  })

  it("preserves legitimate parenthesized numbers (only hex-lettered fragments are ids)", () => {
    const { slotLookup, slotDetailsLookup } = buildSlotLookups(slotsForWeek())
    const rows = buildExerciseRows(
      [
        {
          slot_id: "w2d1s1",
          exercise_id: "ex-1",
          exercise_name: "A",
          notes: "Tempo (3-1-2-0), target 8 reps (20260713) session marker.",
        },
      ],
      slotLookup,
      slotDetailsLookup,
      "prog-1",
    )
    expect(rows[0].notes).toBe("Tempo (3-1-2-0), target 8 reps (20260713) session marker.")
  })

  it("leaves plain notes and null notes untouched", () => {
    const { slotLookup, slotDetailsLookup } = buildSlotLookups(slotsForWeek())
    const rows = buildExerciseRows(
      [
        { slot_id: "w2d1s1", exercise_id: "ex-1", exercise_name: "A", notes: "Slow eccentric, brace hard." },
        { slot_id: "w2d1s2", exercise_id: "ex-2", exercise_name: "B", notes: null },
      ],
      slotLookup,
      slotDetailsLookup,
      "prog-1",
    )
    expect(rows[0].notes).toBe("Slow eccentric, brace hard.")
    expect(rows[1].notes).toBeNull()
  })
})

describe("dedupeSkeletonDaysInPlace", () => {
  function wk(weekNum: number, dayNums: number[]): ProgramWeek {
    return {
      week_number: weekNum,
      phase: "x",
      intensity_modifier: "moderate",
      days: dayNums.map((d) => ({
        day_of_week: d,
        label: "L",
        focus: "f",
        slots: [
          {
            slot_id: `w${weekNum}d${d}s1`, role: "primary_compound", movement_pattern: "squat",
            target_muscles: [], sets: 3, reps: "5", rest_seconds: 60, rpe_target: 7,
            tempo: null, group_tag: null, technique: "straight_set", intensity_pct: null,
          },
          {
            slot_id: `w${weekNum}d${d}s2`, role: "accessory", movement_pattern: "hinge",
            target_muscles: [], sets: 3, reps: "10", rest_seconds: 60, rpe_target: 7,
            tempo: null, group_tag: null, technique: "straight_set", intensity_pct: null,
          },
        ],
      })),
    } as ProgramWeek
  }

  it("reassigns a duplicate day_of_week to the lowest free weekday", () => {
    const skeleton = { weeks: [wk(2, [2, 2, 5])] }
    const moves = dedupeSkeletonDaysInPlace(skeleton)
    const days = skeleton.weeks[0].days.map((d) => d.day_of_week)
    expect(new Set(days).size).toBe(days.length) // all unique
    expect(days).toEqual([2, 1, 5]) // duplicate "2" moved to lowest free (1)
    expect(moves).toEqual([{ week_number: 2, from_day: 2, to_day: 1 }])
  })

  it("regenerates slot_ids for a moved day to match its new day_of_week", () => {
    const skeleton = { weeks: [wk(2, [2, 2])] }
    dedupeSkeletonDaysInPlace(skeleton)
    const movedDay = skeleton.weeks[0].days[1]
    expect(movedDay.day_of_week).toBe(1)
    expect(movedDay.slots.map((s) => s.slot_id)).toEqual(["w2d1s1", "w2d1s2"])
    // first day left untouched
    expect(skeleton.weeks[0].days[0].slots.map((s) => s.slot_id)).toEqual(["w2d2s1", "w2d2s2"])
  })

  it("is a no-op when every day is already unique", () => {
    const skeleton = { weeks: [wk(1, [2, 5]), wk(2, [1, 3, 6])] }
    const moves = dedupeSkeletonDaysInPlace(skeleton)
    expect(moves).toEqual([])
    expect(skeleton.weeks[0].days.map((d) => d.day_of_week)).toEqual([2, 5])
    expect(skeleton.weeks[1].days.map((d) => d.day_of_week)).toEqual([1, 3, 6])
  })

  it("resolves cascading duplicates so all days in a week are distinct", () => {
    const skeleton = { weeks: [wk(1, [2, 2, 1])] }
    dedupeSkeletonDaysInPlace(skeleton)
    const days = skeleton.weeks[0].days.map((d) => d.day_of_week)
    expect(new Set(days).size).toBe(3)
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
