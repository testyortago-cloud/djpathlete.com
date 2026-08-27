import { describe, it, expect } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

describe("Migration 00232: exercise blocks", () => {
  const supabase = createServiceRoleClient()

  it("exercise_blocks table exists with required columns", async () => {
    const { data, error } = await supabase
      .from("exercise_blocks")
      .select("id,coach_id,client_id,exercise_id,reason,created_by,created_at")
      .limit(0)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("rejects a block referencing an exercise that does not exist", async () => {
    const { error } = await supabase.from("exercise_blocks").insert({
      coach_id: "00000000-0000-0000-0000-000000000001",
      exercise_id: "00000000-0000-0000-0000-000000000002",
      created_by: "00000000-0000-0000-0000-000000000001",
    })
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).toMatch(/foreign key|violates/)
  })
})
