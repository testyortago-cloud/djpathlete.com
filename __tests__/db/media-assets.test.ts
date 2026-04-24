import { afterEach, describe, expect, it } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"
import {
  createMediaAsset,
  getMediaAssetById,
  listMediaAssets,
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
})
