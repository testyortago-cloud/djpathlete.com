import { describe, it, expect } from "vitest"
import { getCategoryFields, withPopulatedFields } from "@/lib/exercise-fields"

describe("withPopulatedFields", () => {
  const flexibility = getCategoryFields(["flexibility"])

  it("is a no-op when the row carries nothing the category hides", () => {
    expect(withPopulatedFields(flexibility, {})).toEqual(flexibility)
  })

  it("turns on each field the row has a value for", () => {
    const widened = withPopulatedFields(flexibility, {
      reps: "8",
      rest_seconds: 45,
      rpe_target: 7,
      intensity_pct: 75,
      suggested_weight_kg: 20,
    })

    expect(widened.showReps).toBe(true)
    expect(widened.showRest).toBe(true)
    expect(widened.showRpe).toBe(true)
    expect(widened.showIntensity).toBe(true)
    expect(widened.showWeight).toBe(true)
  })

  it("widens only the fields that have values, leaving the empty ones hidden", () => {
    const widened = withPopulatedFields(flexibility, { reps: "8" })

    expect(widened.showReps).toBe(true)
    expect(widened.showRest).toBe(false)
    expect(widened.showRpe).toBe(false)
    expect(widened.showWeight).toBe(false)
    expect(widened.showIntensity).toBe(false)
  })

  it("keeps a prominent duration prominent rather than flattening it to true", () => {
    expect(flexibility.showDuration).toBe("prominent")
    expect(withPopulatedFields(flexibility, { duration_seconds: 30 }).showDuration).toBe("prominent")
  })

  it("promotes a hidden duration to shown when the row has one", () => {
    const strength = getCategoryFields(["strength"])
    expect(strength.showDuration).toBe(false)
    expect(withPopulatedFields(strength, { duration_seconds: 30 }).showDuration).toBe(true)
  })

  it("never turns a field OFF that the category already shows", () => {
    const strength = getCategoryFields(["strength"])
    const widened = withPopulatedFields(strength, {})

    expect(widened.showReps).toBe(true)
    expect(widened.showRest).toBe(true)
    expect(widened.showRpe).toBe(true)
    expect(widened.showWeight).toBe(true)
    expect(widened.showTempo).toBe(true)
    expect(widened.showIntensity).toBe(true)
  })

  it("treats zero and empty string as not set, matching what ExerciseCard prints", () => {
    const widened = withPopulatedFields(flexibility, { rest_seconds: 0, reps: "", tempo: "" })

    expect(widened.showRest).toBe(false)
    expect(widened.showReps).toBe(false)
  })
})
