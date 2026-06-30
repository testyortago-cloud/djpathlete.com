import { describe, it, expect } from "vitest"
import { exerciseFavoriteToggleSchema, adminExerciseFavoriteSchema } from "@/lib/validators/exercise-favorite"

const UUID = "11111111-1111-1111-8111-111111111111"

describe("exerciseFavoriteToggleSchema", () => {
  it("accepts a valid uuid + boolean", () => {
    expect(exerciseFavoriteToggleSchema.parse({ exerciseId: UUID, favorited: true })).toEqual({
      exerciseId: UUID,
      favorited: true,
    })
  })
  it("rejects a non-uuid exerciseId", () => {
    expect(exerciseFavoriteToggleSchema.safeParse({ exerciseId: "nope", favorited: true }).success).toBe(false)
  })
  it("rejects a missing favorited flag", () => {
    expect(exerciseFavoriteToggleSchema.safeParse({ exerciseId: UUID }).success).toBe(false)
  })
})

describe("adminExerciseFavoriteSchema", () => {
  it("accepts a valid uuid", () => {
    expect(adminExerciseFavoriteSchema.parse({ exerciseId: UUID })).toEqual({ exerciseId: UUID })
  })
})
