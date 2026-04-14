import { describe, it, expect } from "vitest"
import { createEventSignupSchema } from "@/lib/validators/event-signups"

describe("createEventSignupSchema", () => {
  const base = {
    parent_name: "Alex Doe",
    parent_email: "alex@example.com",
    athlete_name: "Sam Doe",
    athlete_age: 14,
  }

  it("accepts a minimal valid signup", () => {
    expect(createEventSignupSchema.safeParse(base).success).toBe(true)
  })

  it("rejects an invalid email", () => {
    expect(createEventSignupSchema.safeParse({ ...base, parent_email: "not-an-email" }).success).toBe(false)
  })

  it("rejects athlete_age below 6", () => {
    expect(createEventSignupSchema.safeParse({ ...base, athlete_age: 5 }).success).toBe(false)
  })

  it("rejects athlete_age above 21", () => {
    expect(createEventSignupSchema.safeParse({ ...base, athlete_age: 25 }).success).toBe(false)
  })
})
