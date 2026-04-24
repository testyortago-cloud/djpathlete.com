import { afterEach, describe, expect, it } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"
import { createMediaAsset, deleteMediaAsset } from "@/lib/db/media-assets"
import {
  attachMedia,
  listMediaForPost,
  reorderMedia,
  detachMedia,
} from "@/lib/db/social-post-media"

describe("lib/db/social-post-media", () => {
  const supabase = createServiceRoleClient()
  const postIds: string[] = []
  const assetIds: string[] = []

  afterEach(async () => {
    if (postIds.length > 0) {
      await supabase.from("social_posts").delete().in("id", postIds)
      postIds.length = 0
    }
    for (const id of assetIds) {
      try { await deleteMediaAsset(id) } catch { /* asset may still be referenced */ }
    }
    assetIds.length = 0
  })

  async function newPost(post_type: string = "image"): Promise<string> {
    const res = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "t", approval_status: "draft", post_type })
      .select()
      .single()
    postIds.push(res.data!.id)
    return res.data!.id
  }

  async function newAsset(label: string) {
    const a = await createMediaAsset({
      kind: "image",
      storage_path: `media-assets/${label}.jpg`,
      public_url: `https://example.invalid/${label}.jpg`,
      mime_type: "image/jpeg",
      bytes: 1,
      width: null, height: null, duration_ms: null,
      derived_from_video_id: null, ai_alt_text: null, ai_analysis: null, created_by: null,
    })
    assetIds.push(a.id)
    return a
  }

  it("attaches an asset at position 0 and mirrors media_url", async () => {
    const postId = await newPost("image")
    const a = await newAsset("attach-1")

    await attachMedia(postId, a.id, 0)

    const media = await listMediaForPost(postId)
    expect(media).toHaveLength(1)
    expect(media[0].media_asset_id).toBe(a.id)
    expect(media[0].position).toBe(0)
  })

  it("lists media ordered by position ascending", async () => {
    const postId = await newPost("carousel")
    const a = await newAsset("order-a")
    const b = await newAsset("order-b")
    const c = await newAsset("order-c")

    await attachMedia(postId, b.id, 1)
    await attachMedia(postId, c.id, 2)
    await attachMedia(postId, a.id, 0)

    const media = await listMediaForPost(postId)
    expect(media.map((m) => m.media_asset_id)).toEqual([a.id, b.id, c.id])
  })

  it("reorders attached media via reorderMedia (4-item reverse)", async () => {
    const postId = await newPost("carousel")
    const a = await newAsset("re-a")
    const b = await newAsset("re-b")
    const c = await newAsset("re-c")
    const d = await newAsset("re-d")

    await attachMedia(postId, a.id, 0)
    await attachMedia(postId, b.id, 1)
    await attachMedia(postId, c.id, 2)
    await attachMedia(postId, d.id, 3)

    await reorderMedia(postId, [
      { assetId: d.id, position: 0 },
      { assetId: c.id, position: 1 },
      { assetId: b.id, position: 2 },
      { assetId: a.id, position: 3 },
    ])

    const media = await listMediaForPost(postId)
    expect(media.map((m) => m.media_asset_id)).toEqual([d.id, c.id, b.id, a.id])
  }, 15000)

  it("reorderMedia rejects a partial positions array", async () => {
    const postId = await newPost("carousel")
    const a = await newAsset("partial-a")
    const b = await newAsset("partial-b")
    await attachMedia(postId, a.id, 0)
    await attachMedia(postId, b.id, 1)

    await expect(
      reorderMedia(postId, [{ assetId: a.id, position: 0 }]),
    ).rejects.toThrow(/positions\.length.*must equal attached media count/)

    // Sanity: original order untouched.
    const media = await listMediaForPost(postId)
    expect(media.map((m) => m.media_asset_id)).toEqual([a.id, b.id])
  })

  it("reorderMedia rejects positions referencing unattached assets", async () => {
    const postId = await newPost("carousel")
    const a = await newAsset("ref-a")
    const b = await newAsset("ref-b")
    const stranger = await newAsset("ref-stranger")
    await attachMedia(postId, a.id, 0)
    await attachMedia(postId, b.id, 1)

    await expect(
      reorderMedia(postId, [
        { assetId: a.id, position: 0 },
        { assetId: stranger.id, position: 1 },
      ]),
    ).rejects.toThrow(/currently-attached assets/)

    const media = await listMediaForPost(postId)
    expect(media.map((m) => m.media_asset_id)).toEqual([a.id, b.id])
  })

  it("reorderMedia rejects duplicate target positions", async () => {
    const postId = await newPost("carousel")
    const a = await newAsset("dup-pos-a")
    const b = await newAsset("dup-pos-b")
    await attachMedia(postId, a.id, 0)
    await attachMedia(postId, b.id, 1)

    await expect(
      reorderMedia(postId, [
        { assetId: a.id, position: 0 },
        { assetId: b.id, position: 0 },
      ]),
    ).rejects.toThrow(/unique/)

    const media = await listMediaForPost(postId)
    expect(media.map((m) => m.media_asset_id)).toEqual([a.id, b.id])
  })

  it("attachMedia persists overlayText and overlayMetadata when provided", async () => {
    const postId = await newPost("story")
    const a = await newAsset("overlay")

    await attachMedia(postId, a.id, 0, {
      overlayText: "STRONGER",
      overlayMetadata: { x: 0.5, y: 0.9, color: "#fff" },
    })

    const media = await listMediaForPost(postId)
    expect(media).toHaveLength(1)
    expect(media[0].overlay_text).toBe("STRONGER")
    expect(media[0].overlay_metadata).toEqual({ x: 0.5, y: 0.9, color: "#fff" })
  })

  it("detaches an asset from a post", async () => {
    const postId = await newPost("image")
    const a = await newAsset("detach")
    await attachMedia(postId, a.id, 0)

    await detachMedia(postId, a.id)

    const media = await listMediaForPost(postId)
    expect(media).toHaveLength(0)
  })

  it("rejects attaching the same asset twice to one post", async () => {
    const postId = await newPost("carousel")
    const a = await newAsset("dup")

    await attachMedia(postId, a.id, 0)
    await expect(attachMedia(postId, a.id, 1)).rejects.toBeDefined()
  })

  it("getSocialPostWithMedia returns the post together with ordered media rows", async () => {
    const { getSocialPostWithMedia } = await import("@/lib/db/social-posts")

    const postId = await newPost("carousel")
    const a = await newAsset("with-a")
    const b = await newAsset("with-b")
    await attachMedia(postId, a.id, 0)
    await attachMedia(postId, b.id, 1)

    const result = await getSocialPostWithMedia(postId)
    expect(result?.id).toBe(postId)
    expect(result?.post_type).toBe("carousel")
    expect(result?.media.map((m) => m.media_asset_id)).toEqual([a.id, b.id])
    expect(result?.media[0].asset?.public_url).toBe("https://example.invalid/with-a.jpg")
  })
})
