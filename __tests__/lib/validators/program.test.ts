import { describe, it, expect } from "vitest"
import { programFormSchema } from "@/lib/validators/program"

// The shape of a real AI-generated program (prod, 2026-10-31). The Pricing & Access sheet and the
// Edit Program dialog both send the stored row back through this schema, so anything the AI writes
// has to pass it, or the coach cannot save that program's pricing at all.
const aiProgram = {
  name: "Leo Sayag's 12-Week Muscle Gain & Endurance & Sport Specific & Flexibility Program",
  description: "x".repeat(4844),
  category: ["hybrid"],
  difficulty: "elite",
  tier: "generalize",
  duration_weeks: 12,
  sessions_per_week: 1,
  split_type: "full_body",
  periodization: "undulating",
  billing_interval: null,
  is_public: false,
}

describe("programFormSchema", () => {
  it("accepts the long description the AI writes, so its pricing can be saved", () => {
    const result = programFormSchema.safeParse({ ...aiProgram, payment_type: "free", price_cents: null })
    expect(result.success).toBe(true)
  })

  it("still caps the description", () => {
    const result = programFormSchema.safeParse({
      ...aiProgram,
      description: "x".repeat(10001),
      payment_type: "free",
      price_cents: null,
    })
    expect(result.success).toBe(false)
  })

  it("still refuses a paid program with no price", () => {
    const result = programFormSchema.safeParse({ ...aiProgram, payment_type: "one_time", price_cents: null })
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.flatten().fieldErrors.price_cents).toEqual(["Price is required for paid programs"])
  })
})
