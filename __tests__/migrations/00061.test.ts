import { describe, it, expect } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

describe("Migration 00061: exercise usage + coach policy", () => {
  const supabase = createServiceRoleClient()

  it("generated_exercise_usage table exists with required columns", async () => {
    const { data, error } = await supabase
      .from("generated_exercise_usage")
      .select("id,coach_id,client_id,exercise_id,program_id,week_number,day_number,assigned_at")
      .limit(0)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("coach_ai_policy table exists with required columns and defaults", async () => {
    const { data, error } = await supabase
      .from("coach_ai_policy")
      .select(
        "coach_id,disallowed_techniques,preferred_techniques,technique_progression_enabled,programming_notes,updated_at",
      )
      .limit(0)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("rejects coach_ai_policy rows with invalid technique in disallowed_techniques", async () => {
    const { error } = await supabase.from("coach_ai_policy").insert({
      coach_id: "00000000-0000-0000-0000-000000000001",
      disallowed_techniques: ["not_a_real_technique"],
    })
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).toMatch(/check|constraint/)
  })
})
