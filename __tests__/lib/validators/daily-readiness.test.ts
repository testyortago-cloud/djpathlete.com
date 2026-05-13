import { describe, it, expect } from "vitest"
import { readinessFormSchema, READINESS_FIELDS } from "@/lib/validators/daily-readiness"

describe("readinessFormSchema", () => {
  const validInput = {
    date: "2026-05-13",
    sleep_hours: 7.5,
    sleep_quality: 4,
    soreness_overall: 2,
    soreness_by_region: { hamstring: 3 },
    fatigue: 2,
    mood: 4,
    stress: 2,
    hydration: 4,
    resting_hr: 58,
    hrv_ms: 65,
    notes: "felt fresh",
  }

  it("accepts a valid input", () => {
    const result = readinessFormSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it("rejects ratings outside 1-5", () => {
    const r = readinessFormSchema.safeParse({ ...validInput, fatigue: 6 })
    expect(r.success).toBe(false)
  })

  it("accepts null optional fields", () => {
    const r = readinessFormSchema.safeParse({
      ...validInput,
      sleep_hours: null,
      resting_hr: null,
      hrv_ms: null,
      notes: null,
    })
    expect(r.success).toBe(true)
  })

  it("READINESS_FIELDS exposes all 1-5 fields with inverted flags", () => {
    expect(READINESS_FIELDS.some((f) => f.key === "soreness_overall" && f.inverted)).toBe(true)
    expect(READINESS_FIELDS.some((f) => f.key === "sleep_quality" && !f.inverted)).toBe(true)
  })
})
