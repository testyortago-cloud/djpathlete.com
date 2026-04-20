// __tests__/migrations/00078_platform_connections.test.ts
import { describe, it, expect } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

describe("migration 00078 — platform_connections", () => {
  const supabase = createServiceRoleClient()

  it("has all 6 plugins seeded with status=not_connected", async () => {
    const { data, error } = await supabase
      .from("platform_connections")
      .select("plugin_name, status")
      .order("plugin_name", { ascending: true })

    expect(error).toBeNull()
    const names = (data ?? []).map((r) => r.plugin_name).sort()
    expect(names).toEqual(["instagram", "linkedin", "meta", "tiktok", "youtube", "youtube_shorts"])
    for (const row of data ?? []) {
      expect(row.status).toBe("not_connected")
    }
  })

  it("rejects invalid plugin_name via CHECK constraint", async () => {
    const { data, error } = await supabase
      .from("platform_connections")
      .insert({ plugin_name: "bogus" })
      .select()
      .single()
    expect(error).not.toBeNull()
    if (data?.id) await supabase.from("platform_connections").delete().eq("id", data.id)
  })

  it("enforces unique plugin_name (cannot double-insert a seeded plugin)", async () => {
    const { data, error } = await supabase
      .from("platform_connections")
      .insert({ plugin_name: "tiktok" })
      .select()
      .single()
    expect(error).not.toBeNull()
    if (data?.id) await supabase.from("platform_connections").delete().eq("id", data.id)
  })
})
