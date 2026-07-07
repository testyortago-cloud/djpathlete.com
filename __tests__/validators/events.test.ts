import { describe, it, expect } from "vitest"
import { createEventSchema } from "@/lib/validators/events"

const campBase = {
  type: "camp" as const,
  title: "Summer Camp",
  slug: "summer-camp",
  summary: "S",
  description: "D",
  location_name: "L",
  capacity: 10,
}

describe("createEventSchema — camp schedule", () => {
  it("accepts a camp with an ordered daily window", () => {
    const result = createEventSchema.safeParse({
      ...campBase,
      start_date: "2026-07-13T09:00:00.000Z",
      end_date: "2026-07-17T11:00:00.000Z",
    })
    expect(result.success).toBe(true)
  })

  it("accepts a legacy date-only camp (midnight on both)", () => {
    const result = createEventSchema.safeParse({
      ...campBase,
      start_date: "2026-07-13T00:00:00.000Z",
      end_date: "2026-07-17T00:00:00.000Z",
    })
    expect(result.success).toBe(true)
  })

  it("rejects an end date before the start date", () => {
    const result = createEventSchema.safeParse({
      ...campBase,
      start_date: "2026-07-17T00:00:00.000Z",
      end_date: "2026-07-13T00:00:00.000Z",
    })
    expect(result.success).toBe(false)
  })

  it("rejects a daily end time at or before the daily start time", () => {
    const result = createEventSchema.safeParse({
      ...campBase,
      start_date: "2026-07-13T09:00:00.000Z",
      end_date: "2026-07-17T08:00:00.000Z",
    })
    expect(result.success).toBe(false)
  })

  it("clinics are unaffected (end_date optional, no daily-window rule)", () => {
    const result = createEventSchema.safeParse({
      ...campBase,
      type: "clinic" as const,
      start_date: "2026-07-13T15:00:00.000Z",
    })
    expect(result.success).toBe(true)
  })
})
