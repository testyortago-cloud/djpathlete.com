// __tests__/migrations/00080_blog_posts_ai_extensions.test.ts
import { describe, it, expect, afterAll } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

const TEST_TAG = "__TEST_BLOG_00080__"
// Admin user seeded in users table; safe to reuse across tests as FK target.
const adminUserId = "00000000-0000-0000-0000-000000000001"

describe("migration 00080 — blog_posts AI extensions", () => {
  const supabase = createServiceRoleClient()

  async function cleanup() {
    await supabase.from("blog_posts").delete().like("slug", `${TEST_TAG}%`)
  }

  afterAll(cleanup)

  it("accepts new AI columns on blog_posts", async () => {
    const slug = `${TEST_TAG}-${Date.now()}`
    const { data, error } = await supabase
      .from("blog_posts")
      .insert({
        title: "test-00080",
        slug,
        category: "Performance",
        status: "draft",
        content: "test body",
        author_id: adminUserId,
        source_video_id: null,
        seo_metadata: { meta_title: "x", keywords: ["a"] },
        tavily_research: { summary: "s" },
        fact_check_status: "passed",
      })
      .select()
      .single()

    expect(error).toBeNull()
    expect(data?.seo_metadata).toEqual({ meta_title: "x", keywords: ["a"] })
    expect(data?.fact_check_status).toBe("passed")

    if (data?.id) await supabase.from("blog_posts").delete().eq("id", data.id)
  })

  it("rejects invalid fact_check_status via CHECK", async () => {
    const slug = `${TEST_TAG}-bad-${Date.now()}`
    const { data, error } = await supabase
      .from("blog_posts")
      .insert({
        title: "test-00080-bad",
        slug,
        category: "Performance",
        status: "draft",
        content: "x",
        author_id: adminUserId,
        fact_check_status: "made-up-value",
      })
      .select()
      .single()
    expect(error).not.toBeNull()
    if (data?.id) await supabase.from("blog_posts").delete().eq("id", data.id)
  })

  it("defaults seo_metadata to empty object when not provided", async () => {
    const slug = `${TEST_TAG}-default-${Date.now()}`
    const { data, error } = await supabase
      .from("blog_posts")
      .insert({
        title: "test-00080-default",
        slug,
        category: "Performance",
        status: "draft",
        content: "x",
        author_id: adminUserId,
      })
      .select()
      .single()

    expect(error).toBeNull()
    expect(data?.seo_metadata).toEqual({})
    expect(data?.tavily_research).toBeNull()
    expect(data?.fact_check_status).toBeNull()

    if (data?.id) await supabase.from("blog_posts").delete().eq("id", data.id)
  })
})
