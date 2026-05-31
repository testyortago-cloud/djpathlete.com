// __tests__/db/media-assets-cut-ids.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { createVideoUpload } from "@/lib/db/video-uploads"
import { createMediaAsset, listCaptionedCutVideoIds } from "@/lib/db/media-assets"
import { createServiceRoleClient } from "@/lib/supabase"

const TAG = "__TEST_CUT_IDS__"

describe("listCaptionedCutVideoIds", () => {
  const supabase = createServiceRoleClient()
  const cleanup = async () => {
    await supabase.from("media_assets").delete().like("storage_path", `${TAG}%`)
    await supabase.from("video_uploads").delete().like("original_filename", `${TAG}%`)
  }
  beforeEach(cleanup)
  afterAll(cleanup)

  async function makeVideo(suffix: string) {
    return createVideoUpload({
      storage_path: `videos/${TAG}${suffix}.mp4`,
      original_filename: `${TAG}${suffix}.mp4`,
      duration_seconds: 10,
      size_bytes: 1,
      mime_type: "video/mp4",
      title: null,
      uploaded_by: null,
      status: "transcribed",
    })
  }

  async function makeAsset(videoId: string, origin: string | null, suffix: string) {
    return createMediaAsset({
      kind: "video",
      storage_path: `${TAG}${suffix}.mp4`,
      public_url: `${TAG}${suffix}.mp4`,
      mime_type: "video/mp4",
      bytes: 1,
      width: 1080,
      height: 1920,
      duration_ms: 1000,
      derived_from_video_id: videoId,
      ai_alt_text: null,
      ai_analysis: origin ? { origin } : null,
      created_by: null,
    })
  }

  it("includes the video id of a captioned-cut asset", async () => {
    const v = await makeVideo("a")
    await makeAsset(v.id, "captioned_cut", "a")
    const ids = await listCaptionedCutVideoIds()
    expect(ids.has(v.id)).toBe(true)
  })

  it("excludes a video whose only asset has a different origin", async () => {
    const v = await makeVideo("b")
    await makeAsset(v.id, "quote_card", "b")
    const ids = await listCaptionedCutVideoIds()
    expect(ids.has(v.id)).toBe(false)
  })

  it("excludes a video whose asset has no ai_analysis origin", async () => {
    const v = await makeVideo("c")
    await makeAsset(v.id, null, "c")
    const ids = await listCaptionedCutVideoIds()
    expect(ids.has(v.id)).toBe(false)
  })

  it("returns a Set (deduped) — one id even with two cut assets", async () => {
    const v = await makeVideo("d")
    await makeAsset(v.id, "captioned_cut", "d1")
    await makeAsset(v.id, "captioned_cut", "d2")
    const ids = await listCaptionedCutVideoIds()
    expect(ids.has(v.id)).toBe(true)
    expect([...ids].filter((id) => id === v.id)).toHaveLength(1)
  })
})
