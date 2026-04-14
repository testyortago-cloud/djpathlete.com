import { describe, it, expect, beforeEach } from "vitest"
import { getCoachPolicy, upsertCoachPolicy } from "@/lib/db/coach-ai-policy"
import { createServiceRoleClient } from "@/lib/supabase"

const TEST_COACH = "00000000-0000-0000-0000-0000000cc001"

describe("coach-ai-policy DAL", () => {
  const supabase = createServiceRoleClient()

  beforeEach(async () => {
    await supabase.from("coach_ai_policy").delete().eq("coach_id", TEST_COACH)
  })

  it("getCoachPolicy returns null when no policy set", async () => {
    const policy = await getCoachPolicy(TEST_COACH)
    expect(policy).toBeNull()
  })

  it("upsertCoachPolicy creates then updates a policy", async () => {
    await upsertCoachPolicy(TEST_COACH, {
      disallowed_techniques: ["circuit", "emom"],
      preferred_techniques: ["straight_set"],
      technique_progression_enabled: true,
      programming_notes: "never use circuits; athletes do sport conditioning outside the gym",
    })
    const p1 = await getCoachPolicy(TEST_COACH)
    expect(p1?.disallowed_techniques).toEqual(["circuit", "emom"])
    expect(p1?.programming_notes).toMatch(/never use circuits/)

    await upsertCoachPolicy(TEST_COACH, {
      disallowed_techniques: ["circuit"],
      preferred_techniques: [],
      technique_progression_enabled: false,
      programming_notes: "",
    })
    const p2 = await getCoachPolicy(TEST_COACH)
    expect(p2?.disallowed_techniques).toEqual(["circuit"])
    expect(p2?.technique_progression_enabled).toBe(false)
  })
})
