import { describe, it, expect } from "vitest"
import { scoreAndFilterExercises } from "../exercise-filter.js"
import type { CompressedExercise, ProgramSkeleton, ProfileAnalysis } from "../types.js"

/**
 * A full CompressedExercise. Built against the real interface rather than a
 * loose object literal — a fixture that does not match the schema is how a test
 * ends up unable to fail.
 */
function ex(id: string, movementPattern: string): CompressedExercise {
  return {
    id,
    name: id,
    category: ["strength"],
    difficulty: "intermediate",
    difficulty_score: 5,
    muscle_group: "core",
    movement_pattern: movementPattern as CompressedExercise["movement_pattern"],
    primary_muscles: ["core"],
    secondary_muscles: [],
    force_type: "static" as CompressedExercise["force_type"],
    laterality: "bilateral" as CompressedExercise["laterality"],
    equipment_required: [],
    is_bodyweight: true,
    training_intent: ["build"],
    sport_tags: [],
    plane_of_motion: ["sagittal"],
    joints_loaded: [],
  }
}

/** One day, one carry slot — enough to make the pattern-balance top-up fire. */
const skeleton = {
  weeks: [
    {
      week_number: 1,
      phase: "base",
      intensity_modifier: "moderate",
      days: [
        {
          day_of_week: 1,
          label: "Day 1",
          focus: "full body",
          slots: [
            {
              slot_id: "s1",
              role: "accessory",
              movement_pattern: "carry",
              target_muscles: ["core"],
              sets: 3,
              reps: "10",
              rest_seconds: 60,
              rpe_target: 7,
              tempo: null,
              group_tag: null,
              technique: "straight_set",
              intensity_pct: null,
            },
          ],
        },
      ],
    },
  ],
} as unknown as ProgramSkeleton

const analysis = { training_age_category: "intermediate" } as unknown as ProfileAnalysis

describe("blocks and the exercise filter", () => {
  it("ensurePatternBalance cannot backfill a blocked exercise", () => {
    // The skeleton demands a carry and the library holds only two, which is far
    // below MIN_PER_PATTERN — so the pattern-balance top-up WILL fire and go
    // looking for carries. It must still not resurrect the blocked one.
    //
    // This path is worth pinning because it is the one place in the filter that
    // ignores usage penalties entirely: it scores on equipment and difficulty
    // alone. If excludeIds were ever dropped from its input, a blocked exercise
    // would come straight back with nothing else to stop it.
    const library = [ex("carry-blocked", "carry"), ex("carry-ok", "carry"), ex("push-1", "push")]

    const out = scoreAndFilterExercises(library, skeleton, [], analysis, {
      excludeIds: new Set(["carry-blocked"]),
    })

    expect(out.map((e) => e.id)).not.toContain("carry-blocked")
    // Presence control: without this, an empty result would satisfy the
    // assertion above and prove nothing at all.
    expect(out.map((e) => e.id)).toContain("carry-ok")
  })

  it("returns the blocked exercise when it is NOT blocked", () => {
    // The control for the test above: it establishes that this exercise is
    // otherwise perfectly selectable, so its absence there is caused by the
    // block and not by some unrelated filter rejecting it.
    const library = [ex("carry-blocked", "carry"), ex("carry-ok", "carry"), ex("push-1", "push")]

    const out = scoreAndFilterExercises(library, skeleton, [], analysis, {})

    expect(out.map((e) => e.id)).toContain("carry-blocked")
  })
})
