import { describe, it, expect } from "vitest"
import { programImportSchema } from "../schemas.js"

describe("programImportSchema", () => {
  it("parses a complete plan", () => {
    const plan = {
      program: {
        name: "Test Block",
        duration_weeks: 4,
        sessions_per_week: 3,
        difficulty: "intermediate",
        category: ["strength"],
        tier: "premium",
      },
      days: [
        {
          week_number: 1,
          day_of_week: 1,
          exercises: [{ raw_name: "Back Squat", order_index: 0, sets: 4, reps: "6-8", technique: "straight_set" }],
        },
      ],
      gaps_filled: ["assumed 4 weeks from the sheet"],
    }
    const parsed = programImportSchema.parse(plan)
    expect(parsed.program.name).toBe("Test Block")
    expect(parsed.days[0].exercises[0].raw_name).toBe("Back Squat")
  })

  it("accepts lower-cased enum values (as the model layer normalizes them)", () => {
    const plan = {
      program: {
        name: "x",
        duration_weeks: 1,
        sessions_per_week: 1,
        difficulty: "intermediate",
        category: ["strength"],
        tier: "premium",
      },
      days: [{ week_number: 1, day_of_week: 1, exercises: [{ raw_name: "Ex", order_index: 0, technique: "straight_set" }] }],
    }
    expect(programImportSchema.safeParse(plan).success).toBe(true)
  })

  it("applies defaults for optional program fields", () => {
    const plan = {
      program: { name: "y", duration_weeks: 2, sessions_per_week: 2 },
      days: [{ week_number: 1, day_of_week: 1, exercises: [{ raw_name: "Ex", order_index: 0 }] }],
    }
    const parsed = programImportSchema.parse(plan)
    expect(parsed.program.difficulty).toBe("intermediate")
    expect(parsed.program.tier).toBe("premium")
    expect(parsed.program.category).toEqual(["strength"])
    expect(parsed.gaps_filled).toEqual([])
  })
})
