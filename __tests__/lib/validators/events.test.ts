import { describe, it, expect } from "vitest"
import { createEventSchema, updateEventSchema } from "@/lib/validators/events"

describe("createEventSchema", () => {
  const baseClinic = {
    type: "clinic" as const,
    slug: "spring-agility",
    title: "Spring Agility Clinic",
    summary: "Two-hour clinic",
    description: "Focus on acceleration + deceleration.",
    focus_areas: ["acceleration"],
    start_date: "2026-05-15T15:00:00.000Z",
    location_name: "Richmond Sports Complex",
    capacity: 12,
    status: "draft" as const,
  }

  it("accepts a minimal valid clinic", () => {
    const result = createEventSchema.safeParse(baseClinic)
    expect(result.success).toBe(true)
  })

  it("rejects an invalid slug", () => {
    const result = createEventSchema.safeParse({ ...baseClinic, slug: "Spring Agility!" })
    expect(result.success).toBe(false)
  })

  it("rejects a capacity of 0", () => {
    const result = createEventSchema.safeParse({ ...baseClinic, capacity: 0 })
    expect(result.success).toBe(false)
  })

  it("rejects age_max less than age_min", () => {
    const result = createEventSchema.safeParse({ ...baseClinic, age_min: 16, age_max: 12 })
    expect(result.success).toBe(false)
  })

  it("requires end_date and start_date on camp", () => {
    const baseCamp = {
      ...baseClinic,
      type: "camp" as const,
      slug: "summer-camp",
      title: "Summer Camp",
      end_date: "2026-05-28T23:00:00.000Z",
      price_dollars: 249,
    }
    expect(createEventSchema.safeParse(baseCamp).success).toBe(true)

    const noEnd = { ...baseCamp, end_date: undefined }
    expect(createEventSchema.safeParse(noEnd).success).toBe(false)
  })

  it("rejects camp with negative price", () => {
    const result = createEventSchema.safeParse({
      ...baseClinic,
      type: "camp" as const,
      slug: "neg-camp",
      title: "x",
      end_date: "2026-05-28T23:00:00.000Z",
      price_dollars: -10,
    })
    expect(result.success).toBe(false)
  })
})

describe("updateEventSchema", () => {
  it("accepts a partial update without type", () => {
    const result = updateEventSchema.safeParse({ title: "Updated Title" })
    expect(result.success).toBe(true)
  })

  it("accepts a status-only update", () => {
    const result = updateEventSchema.safeParse({ status: "published" })
    expect(result.success).toBe(true)
  })
})
