import { afterEach, describe, expect, it } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"
import {
  createMediaAsset,
  getMediaAssetById,
  listMediaAssets,
  listAssetsWithPostCounts,
  updateMediaAssetAiMetadata,
  deleteMediaAsset,
} from "@/lib/db/media-assets"

describe("lib/db/media-assets", () => {
  const supabase = createServiceRoleClient()
  const createdIds: string[] = []

  afterEach(async () => {
    if (createdIds.length > 0) {
      await supabase.from("media_assets").delete().in("id", createdIds)
      createdIds.length = 0
    }
  })

  it("creates an image asset and returns the persisted row", async () => {
    const asset = await createMediaAsset({
      kind: "image",
      storage_path: "media-assets/dal-1.jpg",
      public_url: "https://example.invalid/dal-1.jpg",
      mime_type: "image/jpeg",
      bytes: 2048,
      width: 1080,
      height: 1080,
      duration_ms: null,
      derived_from_video_id: null,
      ai_alt_text: null,
      ai_analysis: null,
      created_by: null,
    })
    createdIds.push(asset.id)
    expect(asset.kind).toBe("image")
    expect(asset.public_url).toBe("https://example.invalid/dal-1.jpg")
  })

  it("reads an asset by id and returns null for unknown ids", async () => {
    const asset = await createMediaAsset({
      kind: "image",
      storage_path: "media-assets/dal-2.jpg",
      public_url: "https://example.invalid/dal-2.jpg",
      mime_type: "image/jpeg",
      bytes: 1,
      width: null,
      height: null,
      duration_ms: null,
      derived_from_video_id: null,
      ai_alt_text: null,
      ai_analysis: null,
      created_by: null,
    })
    createdIds.push(asset.id)

    const found = await getMediaAssetById(asset.id)
    expect(found?.id).toBe(asset.id)

    const missing = await getMediaAssetById("00000000-0000-0000-0000-000000000000")
    expect(missing).toBeNull()
  })

  it("lists media assets filtered by kind and ordered by created_at desc", async () => {
    const image = await createMediaAsset({
      kind: "image",
      storage_path: "media-assets/list-img.jpg",
      public_url: "https://example.invalid/list-img.jpg",
      mime_type: "image/jpeg",
      bytes: 1,
      width: null, height: null, duration_ms: null,
      derived_from_video_id: null, ai_alt_text: null, ai_analysis: null, created_by: null,
    })
    createdIds.push(image.id)

    const video = await createMediaAsset({
      kind: "video",
      storage_path: "media-assets/list-vid.mp4",
      public_url: "https://example.invalid/list-vid.mp4",
      mime_type: "video/mp4",
      bytes: 1,
      width: null, height: null, duration_ms: 5000,
      derived_from_video_id: null, ai_alt_text: null, ai_analysis: null, created_by: null,
    })
    createdIds.push(video.id)

    const imagesOnly = await listMediaAssets({ kind: "image" })
    expect(imagesOnly.some((a) => a.id === image.id)).toBe(true)
    expect(imagesOnly.some((a) => a.id === video.id)).toBe(false)
  })

  it("updates ai_alt_text and ai_analysis via updateMediaAssetAiMetadata", async () => {
    const asset = await createMediaAsset({
      kind: "image",
      storage_path: "media-assets/ai.jpg",
      public_url: "https://example.invalid/ai.jpg",
      mime_type: "image/jpeg",
      bytes: 1,
      width: null, height: null, duration_ms: null,
      derived_from_video_id: null, ai_alt_text: null, ai_analysis: null, created_by: null,
    })
    createdIds.push(asset.id)

    await updateMediaAssetAiMetadata(asset.id, {
      ai_alt_text: "A squat demonstration with a barbell",
      ai_analysis: { scene: "gym", objects: ["barbell", "rack"] },
    })

    const fresh = await getMediaAssetById(asset.id)
    expect(fresh?.ai_alt_text).toBe("A squat demonstration with a barbell")
    expect(fresh?.ai_analysis).toEqual({ scene: "gym", objects: ["barbell", "rack"] })
  })

  it("updateMediaAssetAiMetadata does a partial overwrite — unspecified fields are preserved", async () => {
    const asset = await createMediaAsset({
      kind: "image",
      storage_path: "media-assets/partial.jpg",
      public_url: "https://example.invalid/partial.jpg",
      mime_type: "image/jpeg",
      bytes: 1,
      width: null, height: null, duration_ms: null,
      derived_from_video_id: null, ai_alt_text: null, ai_analysis: null, created_by: null,
    })
    createdIds.push(asset.id)

    // Seed both fields.
    await updateMediaAssetAiMetadata(asset.id, {
      ai_alt_text: "original alt",
      ai_analysis: { scene: "gym" },
    })

    // Update only ai_alt_text. ai_analysis should be preserved.
    await updateMediaAssetAiMetadata(asset.id, { ai_alt_text: "updated alt" })

    const fresh = await getMediaAssetById(asset.id)
    expect(fresh?.ai_alt_text).toBe("updated alt")
    expect(fresh?.ai_analysis).toEqual({ scene: "gym" })
  })

  it("deletes a media asset that is not referenced by any post", async () => {
    const asset = await createMediaAsset({
      kind: "image",
      storage_path: "media-assets/del.jpg",
      public_url: "https://example.invalid/del.jpg",
      mime_type: "image/jpeg",
      bytes: 1,
      width: null, height: null, duration_ms: null,
      derived_from_video_id: null, ai_alt_text: null, ai_analysis: null, created_by: null,
    })
    // Don't push to createdIds — we're deleting explicitly.

    await deleteMediaAsset(asset.id)

    const fresh = await getMediaAssetById(asset.id)
    expect(fresh).toBeNull()
  })

  it("listAssetsWithPostCounts returns each asset with the count of posts referencing it", async () => {
    const assetA = await createMediaAsset({
      kind: "image",
      storage_path: "media-assets/pc-a.jpg",
      public_url: "https://example.invalid/pc-a.jpg",
      mime_type: "image/jpeg",
      bytes: 1,
      width: null, height: null, duration_ms: null,
      derived_from_video_id: null, ai_alt_text: null, ai_analysis: null, created_by: null,
    })
    createdIds.push(assetA.id)

    const assetB = await createMediaAsset({
      kind: "image",
      storage_path: "media-assets/pc-b.jpg",
      public_url: "https://example.invalid/pc-b.jpg",
      mime_type: "image/jpeg",
      bytes: 1,
      width: null, height: null, duration_ms: null,
      derived_from_video_id: null, ai_alt_text: null, ai_analysis: null, created_by: null,
    })
    createdIds.push(assetB.id)

    // Create 2 posts that reference assetA, zero that reference assetB
    const p1 = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "p1", approval_status: "draft", post_type: "image" })
      .select()
      .single()
    const p2 = await supabase
      .from("social_posts")
      .insert({ platform: "facebook", content: "p2", approval_status: "draft", post_type: "image" })
      .select()
      .single()

    try {
      await supabase.from("social_post_media").insert({
        social_post_id: p1.data!.id,
        media_asset_id: assetA.id,
        position: 0,
      })
      await supabase.from("social_post_media").insert({
        social_post_id: p2.data!.id,
        media_asset_id: assetA.id,
        position: 0,
      })

      const rows = await listAssetsWithPostCounts({})
      const rowA = rows.find((r) => r.id === assetA.id)
      const rowB = rows.find((r) => r.id === assetB.id)
      expect(rowA?.post_count).toBe(2)
      expect(rowB?.post_count).toBe(0)
    } finally {
      await supabase.from("social_posts").delete().in("id", [p1.data!.id, p2.data!.id])
    }
  })

  it("refuses to delete a media asset referenced by a social_post_media row", async () => {
    const asset = await createMediaAsset({
      kind: "image",
      storage_path: "media-assets/ref.jpg",
      public_url: "https://example.invalid/ref.jpg",
      mime_type: "image/jpeg",
      bytes: 1,
      width: null, height: null, duration_ms: null,
      derived_from_video_id: null, ai_alt_text: null, ai_analysis: null, created_by: null,
    })
    createdIds.push(asset.id)

    const post = await supabase
      .from("social_posts")
      .insert({ platform: "instagram", content: "ref", approval_status: "draft", post_type: "image" })
      .select()
      .single()
    await supabase.from("social_post_media").insert({
      social_post_id: post.data!.id,
      media_asset_id: asset.id,
      position: 0,
    })

    try {
      await expect(deleteMediaAsset(asset.id)).rejects.toBeDefined()
    } finally {
      await supabase.from("social_posts").delete().eq("id", post.data!.id)
    }
  })
})
