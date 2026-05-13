import { describe, it, expect } from "vitest"
import { injuryFormSchema, rehabMilestoneSchema, BODY_REGIONS, BODY_REGION_LABELS } from "@/lib/validators/injury"

describe("injuryFormSchema", () => {
  const valid = {
    body_region: "hamstring" as const,
    side: "right" as const,
    injury_type: "strain",
    severity: "moderate" as const,
    mechanism: "sprinting",
    description: "grade 2 strain mid-belly",
    date_occurred: "2026-05-10",
    date_resolved: null,
    status: "active" as const,
    rehab_milestones: [],
  }

  it("accepts valid input", () => {
    expect(injuryFormSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects invalid body_region", () => {
    expect(injuryFormSchema.safeParse({ ...valid, body_region: "spleen" }).success).toBe(false)
  })

  it("rejects resolved status without date_resolved", () => {
    expect(injuryFormSchema.safeParse({ ...valid, status: "resolved", date_resolved: null }).success).toBe(false)
  })

  it("BODY_REGIONS has labels for every key", () => {
    BODY_REGIONS.forEach((r) => expect(BODY_REGION_LABELS[r]).toBeTruthy())
  })

  it("rehabMilestoneSchema accepts minimal milestone", () => {
    expect(
      rehabMilestoneSchema.safeParse({
        name: "Pain-free ROM",
        target_date: null,
        completed_date: null,
        notes: null,
      }).success,
    ).toBe(true)
  })
})
