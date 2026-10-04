import { describe, it, expect } from "vitest"
import { muscleVocabulary, normalizeSkeletonInPlace, normalizeMuscleName } from "../slot-normalize.js"
import type { ProgramWeek } from "../types.js"

const VOCAB = ["glutes", "quadriceps", "shoulders", "hamstrings", "core", "obliques", "upper_back", "chest", "lats"]

function week(slot: Record<string, unknown>): ProgramWeek[] {
  return [
    {
      week_number: 1,
      phase: "p",
      intensity_modifier: "moderate",
      days: [
        {
          day_of_week: 1,
          label: "L",
          focus: "f",
          slots: [
            {
              slot_id: "w1d1s1",
              role: "accessory",
              movement_pattern: "squat",
              target_muscles: ["glutes"],
              sets: 3,
              reps: "8",
              rest_seconds: 60,
              rpe_target: 7,
              tempo: null,
              group_tag: null,
              technique: "straight_set",
              intensity_pct: null,
              ...slot,
            },
          ],
        },
      ],
    } as ProgramWeek,
  ]
}

describe("muscleVocabulary", () => {
  it("normalises spelling and keeps values used at least minUses times", () => {
    const lib = [
      { primary_muscles: ["Glutes", "serratus anterior"] },
      { primary_muscles: ["glutes", "serratus_anterior"] },
      { primary_muscles: ["glutes", "serratus anterior", "grip"] },
    ]
    expect(muscleVocabulary(lib, 3).sort()).toEqual(["glutes", "serratus_anterior"])
  })
  it("normalizeMuscleName folds case, spaces and hyphens", () => {
    expect(normalizeMuscleName(" Upper-Back ")).toBe("upper_back")
  })
})

describe("normalizeSkeletonInPlace — muscles", () => {
  it("maps known non-muscle words onto the list and drops unknown ones", () => {
    const w = week({ target_muscles: ["anti-rotation", "Glutes", "vibes"] })
    const changes = normalizeSkeletonInPlace(w, VOCAB)
    expect(w[0].days[0].slots[0].target_muscles).toEqual(["core", "obliques", "glutes"])
    expect(changes.some((c) => c.field === "target_muscles")).toBe(true)
  })
  it("never leaves a slot without muscles — falls back to its pattern's", () => {
    const w = week({ movement_pattern: "hinge", target_muscles: ["cardiovascular"] })
    normalizeSkeletonInPlace(w, VOCAB)
    expect(w[0].days[0].slots[0].target_muscles).toEqual(["hamstrings", "glutes"])
  })
  it("keeps the original list when even the fallback has nothing in the vocabulary", () => {
    const w = week({ movement_pattern: "carry", target_muscles: ["vibes"] })
    normalizeSkeletonInPlace(w, ["glutes"])
    expect(w[0].days[0].slots[0].target_muscles).toEqual(["vibes"])
  })
})

describe("normalizeSkeletonInPlace — numbers", () => {
  it("clamps sets, rest, RPE and intensity_pct and logs each change", () => {
    const w = week({ sets: 3.6, rest_seconds: 900, rpe_target: 11, intensity_pct: 150 })
    const changes = normalizeSkeletonInPlace(w, VOCAB)
    const s = w[0].days[0].slots[0]
    expect([s.sets, s.rest_seconds, s.rpe_target, s.intensity_pct]).toEqual([4, 600, 10, 110])
    expect(changes.map((c) => c.field).sort()).toEqual(["intensity_pct", "rest_seconds", "rpe_target", "sets"])
  })
  it("leaves in-range values alone and reports nothing", () => {
    const w = week({})
    expect(normalizeSkeletonInPlace(w, VOCAB)).toEqual([])
  })
  it("sets a non-finite sets value to 3 and a zero to 1", () => {
    const a = week({ sets: Number.NaN })
    normalizeSkeletonInPlace(a, VOCAB)
    expect(a[0].days[0].slots[0].sets).toBe(3)
    const b = week({ sets: 0 })
    normalizeSkeletonInPlace(b, VOCAB)
    expect(b[0].days[0].slots[0].sets).toBe(1)
  })
})
