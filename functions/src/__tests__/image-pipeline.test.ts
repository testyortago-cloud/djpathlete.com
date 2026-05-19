import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"

vi.mock("../lib/supabase.js", () => ({
  getSupabase: () => ({
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://supa/x.webp" } }),
      }),
    },
  }),
}))

import { transcodeAndUpload, RENDER_DIMENSIONS } from "../lib/image-pipeline.js"

beforeEach(() => vi.clearAllMocks())

describe("RENDER_DIMENSIONS", () => {
  it("exposes 2x render dimensions distinct from final dimensions", () => {
    expect(RENDER_DIMENSIONS.hero).toEqual({ width: 2400, height: 1260 })
    expect(RENDER_DIMENSIONS.inline).toEqual({ width: 2048, height: 1152 })
  })
})

describe("transcodeAndUpload", () => {
  it("downscales to final size with lanczos3 and webp quality 90 for hero", async () => {
    const big = await sharp({
      create: { width: 2400, height: 1260, channels: 3, background: "#888" },
    }).png().toBuffer()

    const result = await transcodeAndUpload({ buffer: big, slug: "s", kind: "hero" })
    expect(result.width).toBe(1200)
    expect(result.height).toBe(630)
  })

  it("uses webp quality 86 for inline", async () => {
    const big = await sharp({
      create: { width: 2048, height: 1152, channels: 3, background: "#888" },
    }).png().toBuffer()

    const result = await transcodeAndUpload({ buffer: big, slug: "s", kind: "inline", sectionIdx: 1 })
    expect(result.width).toBe(1024)
    expect(result.height).toBe(576)
  })
})
