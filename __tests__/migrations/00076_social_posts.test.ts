import { describe, it, expect } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

describe("migration 00076 — social_posts + social_captions", () => {
  const supabase = createServiceRoleClient()

  it("creates a social_posts row with expected columns", async () => {
    const { data, error } = await supabase
      .from("social_posts")
      .insert({
        platform: "instagram",
        content: "test",
        approval_status: "draft",
      })
      .select()
      .single()

    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    expect(data?.platform).toBe("instagram")
    expect(data?.approval_status).toBe("draft")
    expect(data?.scheduled_at).toBeNull()

    if (data?.id) {
      await supabase.from("social_posts").delete().eq("id", data.id)
    }
  })

  it("creates a social_captions row linked to a social_post", async () => {
    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "parent", approval_status: "draft" })
      .select()
      .single()

    expect(post.error).toBeNull()
    expect(post.data?.id).toBeTruthy()
    const postId = post.data!.id

    try {
      const caption = await supabase
        .from("social_captions")
        .insert({
          social_post_id: postId,
          caption_text: "hello world",
          hashtags: ["#fit", "#dj"],
        })
        .select()
        .single()

      expect(caption.error).toBeNull()
      expect(caption.data?.caption_text).toBe("hello world")
      expect(caption.data?.hashtags).toEqual(["#fit", "#dj"])
    } finally {
      await supabase.from("social_posts").delete().eq("id", postId)
    }
  })

  it("rejects invalid platform value via CHECK constraint", async () => {
    const { data, error } = await supabase
      .from("social_posts")
      .insert({ platform: "myspace", content: "x", approval_status: "draft" })
      .select()
      .single()

    expect(error).not.toBeNull()

    // Defensive cleanup in case the CHECK constraint is ever regressed
    if (data?.id) {
      await supabase.from("social_posts").delete().eq("id", data.id)
    }
  })
})
