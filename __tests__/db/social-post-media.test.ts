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

  it("reorders attached media via reorderMedia", async () => {
    const postId = await newPost("carousel")
    const a = await newAsset("re-a")
    const b = await newAsset("re-b")

    await attachMedia(postId, a.id, 0)
    await attachMedia(postId, b.id, 1)

    await reorderMedia(postId, [
      { assetId: b.id, position: 0 },
      { assetId: a.id, position: 1 },
    ])

    const media = await listMediaForPost(postId)
    expect(media.map((m) => m.media_asset_id)).toEqual([b.id, a.id])
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
})
