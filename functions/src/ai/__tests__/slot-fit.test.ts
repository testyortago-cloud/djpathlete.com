import { describe, it, expect } from "vitest"
import { gradeFits } from "../slot-fit.js"
import type { ProgramWeek } from "../types.js"

function weeks(slots: Array<{ id: string; role: string; pattern: string }>): ProgramWeek[] {
  return [
    {
      week_number: 3,
      phase: "p",
      intensity_modifier: "m",
      days: [
        {
          day_of_week: 2,
          label: "Tue",
          focus: "f",
          slots: slots.map((s) => ({
            slot_id: s.id,
            role: s.role,
            movement_pattern: s.pattern,
            target_muscles: ["glutes"],
            sets: 3,
            reps: "8",
            rest_seconds: 60,
            rpe_target: 7,
            tempo: null,
            group_tag: null,
            technique: "straight_set",
            intensity_pct: null,
          })),
        },
      ],
    } as ProgramWeek,
  ]
}
const LIB = [
  { id: "squat", name: "Goblet Squat", movement_pattern: "squat" },
  { id: "lunge", name: "Reverse Lunge", movement_pattern: "lunge" },
  { id: "plank", name: "Plank", movement_pattern: "isometric" },
  { id: "jump", name: "Box Jump", movement_pattern: "locomotion" },
]

describe("gradeFits", () => {
  it("flags a pattern mismatch even when the model said exact", () => {
    const out = gradeFits(
      weeks([{ id: "s1", role: "primary_compound", pattern: "squat" }]),
      [{ slot_id: "s1", exercise_id: "plank", exercise_name: "x", notes: null, fit: "exact" }],
      LIB,
    )
    expect(out).toEqual([
      {
        day_of_week: 2,
        slot_role: "primary_compound",
        slot_pattern: "squat",
        exercise_name: "Plank",
        reason: "isometric exercise in a squat slot",
      },
    ])
  })
  it("treats squat and lunge as compatible", () => {
    expect(
      gradeFits(
        weeks([{ id: "s1", role: "accessory", pattern: "squat" }]),
        [{ slot_id: "s1", exercise_id: "lunge", exercise_name: "x", notes: null, fit: "close" }],
        LIB,
      ),
    ).toEqual([])
  })
  it("honours the model's own 'poor' with its reason", () => {
    const out = gradeFits(
      weeks([{ id: "s1", role: "accessory", pattern: "squat" }]),
      [
        {
          slot_id: "s1",
          exercise_id: "squat",
          exercise_name: "x",
          notes: null,
          fit: "poor",
          fit_reason: "only one squat left",
        },
      ],
      LIB,
    )
    expect(out[0].reason).toBe("only one squat left")
  })
  it("skips the pattern test for power, warm-up and cool-down slots", () => {
    const out = gradeFits(
      weeks([
        { id: "p", role: "power", pattern: "squat" },
        { id: "w", role: "warm_up", pattern: "squat" },
      ]),
      [
        { slot_id: "p", exercise_id: "jump", exercise_name: "x", notes: null, fit: "close" },
        { slot_id: "w", exercise_id: "plank", exercise_name: "x", notes: null, fit: "close" },
      ],
      LIB,
    )
    expect(out).toEqual([])
  })
})
