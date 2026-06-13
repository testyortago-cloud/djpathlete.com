// __tests__/migrations/00078_platform_connections.test.ts
import { describe, it, expect } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

describe("migration 00078 — platform_connections", () => {
  const supabase = createServiceRoleClient()

  it("has all expected plugins seeded", async () => {
    const { data, error } = await supabase
      .from("platform_connections")
      .select("plugin_name, status")
      .order("plugin_name", { ascending: true })

    expect(error).toBeNull()
    const names = (data ?? []).map((r) => r.plugin_name).sort()
    // Plugin set as it stands after later migrations added google_ads + gmail.
    // (Per-plugin `status` is live, mutable connection state — not asserted here.)
    expect(names).toEqual([
      "facebook",
      "gmail",
      "google_ads",
      "instagram",
      "linkedin",
      "tiktok",
      "youtube",
      "youtube_shorts",
    ])
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
