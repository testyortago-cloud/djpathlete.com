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

  it("mirrors media_url from social_post_media at position 0 on insert", async () => {
    const asset = await supabase
      .from("media_assets")
      .insert({
        kind: "image",
        storage_path: "media-assets/mirror-1.jpg",
        public_url: "https://example.invalid/mirror-1.jpg",
        mime_type: "image/jpeg",
        bytes: 10,
      })
      .select()
      .single()
    expect(asset.error).toBeNull()

    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "mirror test", approval_status: "draft", post_type: "image" })
      .select()
      .single()
    expect(post.error).toBeNull()

    try {
      const join = await supabase.from("social_post_media").insert({
        social_post_id: post.data!.id,
        media_asset_id: asset.data!.id,
        position: 0,
      })
      expect(join.error).toBeNull()

      const after = await supabase
        .from("social_posts")
        .select("media_url")
        .eq("id", post.data!.id)
        .single()
      expect(after.data?.media_url).toBe("https://example.invalid/mirror-1.jpg")
    } finally {
      await supabase.from("social_posts").delete().eq("id", post.data!.id)
      await supabase.from("media_assets").delete().eq("id", asset.data!.id)
    }
  })

  it("leaves media_url untouched when only non-zero-position media changes", async () => {
    const a0 = await supabase
      .from("media_assets")
      .insert({
        kind: "image",
        storage_path: "media-assets/mirror-2a.jpg",
        public_url: "https://example.invalid/mirror-2a.jpg",
        mime_type: "image/jpeg",
        bytes: 10,
      })
      .select()
      .single()
    const a1 = await supabase
      .from("media_assets")
      .insert({
        kind: "image",
        storage_path: "media-assets/mirror-2b.jpg",
        public_url: "https://example.invalid/mirror-2b.jpg",
        mime_type: "image/jpeg",
        bytes: 10,
      })
      .select()
      .single()

    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "nonzero", approval_status: "draft", post_type: "carousel" })
      .select()
      .single()

    try {
      await supabase.from("social_post_media").insert([
        { social_post_id: post.data!.id, media_asset_id: a0.data!.id, position: 0 },
        { social_post_id: post.data!.id, media_asset_id: a1.data!.id, position: 1 },
      ])

      const detach1 = await supabase
        .from("social_post_media")
        .delete()
        .eq("social_post_id", post.data!.id)
        .eq("position", 1)
      expect(detach1.error).toBeNull()

      const after = await supabase
        .from("social_posts")
        .select("media_url")
        .eq("id", post.data!.id)
        .single()
      expect(after.data?.media_url).toBe("https://example.invalid/mirror-2a.jpg")
    } finally {
      await supabase.from("social_posts").delete().eq("id", post.data!.id)
      await supabase.from("media_assets").delete().in("id", [a0.data!.id, a1.data!.id])
    }
  })

  it("clears media_url when position 0 is detached and no other media exist", async () => {
    const asset = await supabase
      .from("media_assets")
      .insert({
        kind: "image",
        storage_path: "media-assets/mirror-3.jpg",
        public_url: "https://example.invalid/mirror-3.jpg",
        mime_type: "image/jpeg",
        bytes: 10,
      })
      .select()
      .single()

    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "detach", approval_status: "draft", post_type: "image" })
      .select()
      .single()

    try {
      await supabase.from("social_post_media").insert({
        social_post_id: post.data!.id,
        media_asset_id: asset.data!.id,
        position: 0,
      })

      // Sanity: mirror populated media_url on insert.
      const mid = await supabase
        .from("social_posts")
        .select("media_url")
        .eq("id", post.data!.id)
        .single()
      expect(mid.data?.media_url).toBe("https://example.invalid/mirror-3.jpg")

      await supabase
        .from("social_post_media")
        .delete()
        .eq("social_post_id", post.data!.id)
        .eq("position", 0)

      const after = await supabase
        .from("social_posts")
        .select("media_url")
        .eq("id", post.data!.id)
        .single()
      expect(after.data?.media_url).toBeNull()
    } finally {
      await supabase.from("social_posts").delete().eq("id", post.data!.id)
      await supabase.from("media_assets").delete().eq("id", asset.data!.id)
    }
  })

  it("recomputes media_url for both posts when a social_post_media row's social_post_id changes", async () => {
    const asset = await supabase
      .from("media_assets")
      .insert({
        kind: "image",
        storage_path: "media-assets/mirror-move.jpg",
        public_url: "https://example.invalid/mirror-move.jpg",
        mime_type: "image/jpeg",
        bytes: 10,
      })
      .select()
      .single()

    const p1 = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "origin", approval_status: "draft", post_type: "image" })
      .select()
      .single()
    const p2 = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "destination", approval_status: "draft", post_type: "image" })
      .select()
      .single()

    try {
      await supabase.from("social_post_media").insert({
        social_post_id: p1.data!.id,
        media_asset_id: asset.data!.id,
        position: 0,
      })

      // Confirm p1.media_url populated, p2.media_url null.
      const before1 = await supabase.from("social_posts").select("media_url").eq("id", p1.data!.id).single()
      const before2 = await supabase.from("social_posts").select("media_url").eq("id", p2.data!.id).single()
      expect(before1.data?.media_url).toBe("https://example.invalid/mirror-move.jpg")
      expect(before2.data?.media_url).toBeNull()

      // Move the join row to the other post.
      const move = await supabase
        .from("social_post_media")
        .update({ social_post_id: p2.data!.id })
        .eq("social_post_id", p1.data!.id)
        .eq("media_asset_id", asset.data!.id)
      expect(move.error).toBeNull()

      // Both posts should now reflect the move: p1 cleared, p2 populated.
      const after1 = await supabase.from("social_posts").select("media_url").eq("id", p1.data!.id).single()
      const after2 = await supabase.from("social_posts").select("media_url").eq("id", p2.data!.id).single()
      expect(after1.data?.media_url).toBeNull()
      expect(after2.data?.media_url).toBe("https://example.invalid/mirror-move.jpg")
    } finally {
      await supabase.from("social_posts").delete().in("id", [p1.data!.id, p2.data!.id])
      await supabase.from("media_assets").delete().eq("id", asset.data!.id)
    }
  })

  it("backfills a legacy post with an image media_url into media_assets + social_post_media", async () => {
    const post = await supabase
      .from("social_posts")
      .insert({
        platform: "instagram",
        content: "legacy image",
        approval_status: "draft",
        media_url: "https://example.invalid/legacy.jpg",
      })
      .select()
      .single()
    expect(post.error).toBeNull()

    // Clear any join rows the normal flow would create. Legacy rows had none.
    await supabase.from("social_post_media").delete().eq("social_post_id", post.data!.id)

    let assetId: string | undefined
    try {
      const rpc = await supabase.rpc("backfill_social_post_media")
      expect(rpc.error).toBeNull()

      const join = await supabase
        .from("social_post_media")
        .select("media_asset_id, position")
        .eq("social_post_id", post.data!.id)
        .single()
      expect(join.error).toBeNull()
      expect(join.data?.position).toBe(0)
      assetId = join.data?.media_asset_id

      const asset = await supabase
        .from("media_assets")
        .select("kind, public_url")
        .eq("id", assetId!)
        .single()
      expect(asset.data?.kind).toBe("image")
      expect(asset.data?.public_url).toBe("https://example.invalid/legacy.jpg")

      const sp = await supabase
        .from("social_posts")
        .select("post_type")
        .eq("id", post.data!.id)
        .single()
      expect((sp.data as { post_type?: string })?.post_type).toBe("image")
    } finally {
      await supabase.from("social_posts").delete().eq("id", post.data!.id)
      if (assetId) await supabase.from("media_assets").delete().eq("id", assetId)
    }
  })

  it("backfill is idempotent — running twice yields a single join row", async () => {
    const post = await supabase
      .from("social_posts")
      .insert({
        platform: "instagram",
        content: "idempotent",
        approval_status: "draft",
        media_url: "https://example.invalid/idem.mp4",
      })
      .select()
      .single()
    await supabase.from("social_post_media").delete().eq("social_post_id", post.data!.id)

    let assetId: string | undefined
    try {
      await supabase.rpc("backfill_social_post_media")
      await supabase.rpc("backfill_social_post_media")

      const rows = await supabase
        .from("social_post_media")
        .select("position, media_asset_id")
        .eq("social_post_id", post.data!.id)
      expect(rows.data?.length).toBe(1)
      assetId = rows.data?.[0]?.media_asset_id

      const sp = await supabase
        .from("social_posts")
        .select("post_type")
        .eq("id", post.data!.id)
        .single()
      expect((sp.data as { post_type?: string })?.post_type).toBe("video")
    } finally {
      await supabase.from("social_posts").delete().eq("id", post.data!.id)
      if (assetId) await supabase.from("media_assets").delete().eq("id", assetId)
    }
  })

  it("backfills a text-only post (no media_url) by setting post_type to 'text'", async () => {
    const post = await supabase
      .from("social_posts")
      .insert({
        platform: "linkedin",
        content: "text-only post",
        approval_status: "draft",
      })
      .select()
      .single()

    try {
      await supabase.rpc("backfill_social_post_media")

      const sp = await supabase
        .from("social_posts")
        .select("post_type, media_url")
        .eq("id", post.data!.id)
        .single()
      expect((sp.data as { post_type?: string })?.post_type).toBe("text")
      expect(sp.data?.media_url).toBeNull()

      const rows = await supabase
        .from("social_post_media")
        .select("position")
        .eq("social_post_id", post.data!.id)
      expect(rows.data?.length).toBe(0)
    } finally {
      await supabase.from("social_posts").delete().eq("id", post.data!.id)
    }
  })
})
