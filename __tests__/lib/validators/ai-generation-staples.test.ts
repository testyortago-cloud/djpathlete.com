import { describe, it, expect } from "vitest"
import { aiGenerationRequestSchema, MAX_STAPLES } from "@/lib/validators/ai-generation"

const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
const base = { goals: ["muscle_gain"], duration_weeks: 12, sessions_per_week: 3 }

describe("aiGenerationRequestSchema staple_exercises", () => {
  it("accepts a staple that is in the pool, and keeps it (Zod strips unknown keys)", () => {
    const r = aiGenerationRequestSchema.safeParse({
      ...base,
      pool_exercise_ids: [A, B],
      staple_exercises: [{ exercise_id: A, every_weeks: 3 }],
    })
    expect(r.success).toBe(true)
    expect(r.data?.staple_exercises).toEqual([{ exercise_id: A, every_weeks: 3 }])
  })
  it("refuses a staple that is not in the pool", () => {
    const r = aiGenerationRequestSchema.safeParse({
      ...base,
      pool_exercise_ids: [B],
      staple_exercises: [{ exercise_id: A, every_weeks: 3 }],
    })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0].path).toEqual(["staple_exercises"])
  })
  it("refuses a staple with no pool at all", () => {
    const r = aiGenerationRequestSchema.safeParse({ ...base, staple_exercises: [{ exercise_id: A, every_weeks: 1 }] })
    expect(r.success).toBe(false)
  })
  it("refuses a schedule outside every 1 to 4 weeks", () => {
    for (const every_weeks of [0, 5]) {
      const r = aiGenerationRequestSchema.safeParse({
        ...base,
        pool_exercise_ids: [A],
        staple_exercises: [{ exercise_id: A, every_weeks }],
      })
      expect(r.success).toBe(false)
    }
  })
  it(`refuses more than ${MAX_STAPLES} staples`, () => {
    const ids = Array.from(
      { length: MAX_STAPLES + 1 },
      (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
    )
    const r = aiGenerationRequestSchema.safeParse({
      ...base,
      pool_exercise_ids: ids,
      staple_exercises: ids.map((exercise_id) => ({ exercise_id, every_weeks: 1 })),
    })
    expect(r.success).toBe(false)
  })
  it("a request with no staples still parses as before", () => {
    expect(aiGenerationRequestSchema.safeParse(base).success).toBe(true)
  })
})
