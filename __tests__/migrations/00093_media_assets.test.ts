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

    try {
      expect(error).toBeNull()
      expect(data?.id).toBeTruthy()
      expect(data?.kind).toBe("image")
      expect(data?.ai_alt_text).toBeNull()
      expect(data?.derived_from_video_id).toBeNull()
    } finally {
      if (data?.id) await supabase.from("media_assets").delete().eq("id", data.id)
    }
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

    try {
      expect(error).not.toBeNull()
    } finally {
      // Defensive cleanup in case the CHECK constraint is ever regressed
      if (data?.id) await supabase.from("media_assets").delete().eq("id", data.id)
    }
  })

  it("adds post_type column to social_posts with default 'video'", async () => {
    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "post_type default check", approval_status: "draft" })
      .select()
      .single()

    try {
      expect(post.error).toBeNull()
      expect((post.data as { post_type?: string } | null)?.post_type).toBe("video")
    } finally {
      if (post.data?.id) await supabase.from("social_posts").delete().eq("id", post.data.id)
    }
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

    try {
      expect(error).not.toBeNull()
    } finally {
      // Defensive cleanup in case the CHECK constraint is ever regressed
      if (data?.id) await supabase.from("social_posts").delete().eq("id", data.id)
    }
  })

  it("attaches a media asset to a social post via social_post_media", async () => {
    const asset = await supabase
      .from("media_assets")
      .insert({
        kind: "image",
        storage_path: "media-assets/test-00093-join.jpg",
        public_url: "https://example.invalid/test-00093-join.jpg",
        mime_type: "image/jpeg",
        bytes: 2048,
      })
      .select()
      .single()

    expect(asset.error).toBeNull()
    expect(asset.data?.id).toBeTruthy()
    const assetId = asset.data!.id

    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "join table test", approval_status: "draft" })
      .select()
      .single()

    expect(post.error).toBeNull()
    expect(post.data?.id).toBeTruthy()
    const postId = post.data!.id

    try {
      const join = await supabase
        .from("social_post_media")
        .insert({
          social_post_id: postId,
          media_asset_id: assetId,
          position: 0,
        })
        .select()
        .single()

      expect(join.error).toBeNull()
      expect((join.data as { social_post_id?: string } | null)?.social_post_id).toBe(postId)
      expect((join.data as { media_asset_id?: string } | null)?.media_asset_id).toBe(assetId)
      expect((join.data as { position?: number } | null)?.position).toBe(0)
    } finally {
      // Delete the post first so the ON DELETE CASCADE clears the join row,
      // freeing the media_assets row from the ON DELETE RESTRICT FK.
      await supabase.from("social_posts").delete().eq("id", postId)
      await supabase.from("media_assets").delete().eq("id", assetId)
    }
  })

  it("rejects social_post_media with negative position via CHECK constraint", async () => {
    const asset = await supabase
      .from("media_assets")
      .insert({
        kind: "image",
        storage_path: "media-assets/test-00093-negpos.jpg",
        public_url: "https://example.invalid/test-00093-negpos.jpg",
        mime_type: "image/jpeg",
        bytes: 2048,
      })
      .select()
      .single()

    expect(asset.error).toBeNull()
    expect(asset.data?.id).toBeTruthy()
    const assetId = asset.data!.id

    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "neg position test", approval_status: "draft" })
      .select()
      .single()

    expect(post.error).toBeNull()
    expect(post.data?.id).toBeTruthy()
    const postId = post.data!.id

    try {
      const join = await supabase
        .from("social_post_media")
        .insert({
          social_post_id: postId,
          media_asset_id: assetId,
          position: -1,
        })
        .select()
        .single()

      expect(join.error).not.toBeNull()
    } finally {
      await supabase.from("social_posts").delete().eq("id", postId)
      await supabase.from("media_assets").delete().eq("id", assetId)
    }
  })

  it("rejects inserting the same media asset twice on one post via UNIQUE constraint", async () => {
    const asset = await supabase
      .from("media_assets")
      .insert({
        kind: "image",
        storage_path: "media-assets/test-00093-unique.jpg",
        public_url: "https://example.invalid/test-00093-unique.jpg",
        mime_type: "image/jpeg",
        bytes: 2048,
      })
      .select()
      .single()

    expect(asset.error).toBeNull()
    expect(asset.data?.id).toBeTruthy()
    const assetId = asset.data!.id

    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "unique constraint test", approval_status: "draft" })
      .select()
      .single()

    expect(post.error).toBeNull()
    expect(post.data?.id).toBeTruthy()
    const postId = post.data!.id

    try {
      const firstInsert = await supabase
        .from("social_post_media")
        .insert({
          social_post_id: postId,
          media_asset_id: assetId,
          position: 0,
        })
        .select()
        .single()

      expect(firstInsert.error).toBeNull()

      const secondInsert = await supabase
        .from("social_post_media")
        .insert({
          social_post_id: postId,
          media_asset_id: assetId,
          position: 1,
        })
        .select()
        .single()

      expect(secondInsert.error).not.toBeNull()
    } finally {
      await supabase.from("social_posts").delete().eq("id", postId)
      await supabase.from("media_assets").delete().eq("id", assetId)
    }
  })
})
