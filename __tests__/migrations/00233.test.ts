import { describe, it, expect } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

/**
 * Pins the OUTCOME of the re-tag, not the statements. Reading the rows back is
 * the only thing that proves the UPDATE matched — a migration keyed on a name
 * that does not exist applies cleanly and changes nothing.
 */
describe("Migration 00233: mis-tagged carries", () => {
  const supabase = createServiceRoleClient()

  async function patternOf(name: string): Promise<string | null> {
    const { data, error } = await supabase
      .from("exercises")
      .select("movement_pattern")
      .eq("name", name)
      .maybeSingle()
    expect(error).toBeNull()
    return (data as { movement_pattern: string | null } | null)?.movement_pattern ?? null
  }

  it("re-tags the press-out that was called a carry", async () => {
    expect(await patternOf("Barbell shoulder take outs_Shoulder")).toBe("isometric")
  })

  it("re-tags the hip abduction that was called a carry", async () => {
    expect(await patternOf("Cable rear hip abduction_Hip")).toBe("hinge")
  })

  it("leaves the two genuine carries alone", async () => {
    // The control. Without it, a migration that stripped `carry` from every row
    // would satisfy both assertions above.
    expect(await patternOf("Suitcase carry-Core")).toBe("carry")
    expect(await patternOf("Offset cable steps_Core")).toBe("carry")
  })

  it("leaves the carry pattern populated rather than empty", async () => {
    // An empty pattern would make every carry slot fall through the re-route,
    // which is a bigger behaviour change than this migration intends.
    const { count, error } = await supabase
      .from("exercises")
      .select("*", { count: "exact", head: true })
      .eq("movement_pattern", "carry")
    expect(error).toBeNull()
    expect(count).toBe(2)
  })
})
