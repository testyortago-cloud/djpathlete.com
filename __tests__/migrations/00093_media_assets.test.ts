import { describe, it, expect } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

describe("migration 00093 — media_assets + social_post_media + post_type", () => {
  const supabase = createServiceRoleClient()

  it("creates a media_assets row with expected columns", async () => {
    const { data, error } = await supabase
      .from("media_assets")
      .insert({
        kind: "image",
        storage_path: "media-assets/test-00093.jpg",
        public_url: "https://example.invalid/test-00093.jpg",
        mime_type: "image/jpeg",
        bytes: 1024,
      })
      .select()
      .single()

    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    expect(data?.kind).toBe("image")
    expect(data?.ai_alt_text).toBeNull()
    expect(data?.derived_from_video_id).toBeNull()

    if (data?.id) await supabase.from("media_assets").delete().eq("id", data.id)
  })

  it("rejects invalid media kind via CHECK constraint", async () => {
    const { data, error } = await supabase
      .from("media_assets")
      .insert({
        kind: "audio",
        storage_path: "media-assets/bogus.mp3",
        public_url: "https://example.invalid/bogus.mp3",
        mime_type: "audio/mpeg",
        bytes: 1,
      })
      .select()
      .single()

    expect(error).not.toBeNull()
    if (data?.id) await supabase.from("media_assets").delete().eq("id", data.id)
  })

  it("adds post_type column to social_posts with default 'video'", async () => {
    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "post_type default check", approval_status: "draft" })
      .select()
      .single()

    expect(post.error).toBeNull()
    expect((post.data as { post_type?: string } | null)?.post_type).toBe("video")

    if (post.data?.id) await supabase.from("social_posts").delete().eq("id", post.data.id)
  })

  it("rejects invalid post_type via CHECK constraint", async () => {
    const { data, error } = await supabase
      .from("social_posts")
      .insert({
        platform: "instagram",
        content: "bad type",
        approval_status: "draft",
        post_type: "livestream",
      })
      .select()
      .single()

    expect(error).not.toBeNull()
    if (data?.id) await supabase.from("social_posts").delete().eq("id", data.id)
  })
})
