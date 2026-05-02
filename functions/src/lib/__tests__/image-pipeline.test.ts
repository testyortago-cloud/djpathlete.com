import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"

// Build a real 200x100 PNG fixture so sharp has actual bytes to work on
async function makePngFixture(): Promise<Buffer> {
  return await sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 30, g: 60, b: 90 } },
  })
    .png()
    .toBuffer()
}

const mockUpload = vi.fn()
const mockGetPublicUrl = vi.fn()
vi.mock("../supabase.js", () => ({
  getSupabase: () => ({
    storage: {
      from: vi.fn(() => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      })),
    },
  }),
}))

import { transcodeAndUpload } from "../image-pipeline.js"

describe("transcodeAndUpload", () => {
  beforeEach(() => {
    mockUpload.mockReset()
    mockGetPublicUrl.mockReset()
    mockUpload.mockResolvedValue({ data: { path: "x" }, error: null })
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: "https://supabase.example/blog-images/x.webp" } })
  })

  it("transcodes hero to webp at exactly 1200x630 and uploads with hero filename", async () => {
    const fixture = await makePngFixture()
    const result = await transcodeAndUpload({
      buffer: fixture,
      slug: "my-test-post",
      kind: "hero",
    })

    expect(mockUpload).toHaveBeenCalledTimes(1)
    const [path, body, opts] = mockUpload.mock.calls[0] as [string, Buffer, { contentType: string; upsert: boolean }]
    expect(path).toBe("my-test-post-hero.webp")
    expect(opts.contentType).toBe("image/webp")
    expect(opts.upsert).toBe(true)

    // Verify body is webp at 1200x630
    const meta = await sharp(body).metadata()
    expect(meta.format).toBe("webp")
    expect(meta.width).toBe(1200)
    expect(meta.height).toBe(630)
    expect(result.url).toBe("https://supabase.example/blog-images/x.webp")
    expect(result.width).toBe(1200)
    expect(result.height).toBe(630)
  })

  it("transcodes inline section to 1024x576 with section filename", async () => {
    const fixture = await makePngFixture()
    const result = await transcodeAndUpload({
      buffer: fixture,
      slug: "my-test-post",
      kind: "inline",
      sectionIdx: 2,
    })

    const [path, body] = mockUpload.mock.calls[0] as [string, Buffer]
    expect(path).toBe("my-test-post-section-2.webp")
    const meta = await sharp(body).metadata()
    expect(meta.width).toBe(1024)
    expect(meta.height).toBe(576)
    expect(result.width).toBe(1024)
  })

  it("throws when supabase upload fails", async () => {
    const fixture = await makePngFixture()
    mockUpload.mockResolvedValueOnce({ data: null, error: { message: "bucket missing" } })
    await expect(
      transcodeAndUpload({ buffer: fixture, slug: "x", kind: "hero" }),
    ).rejects.toThrow(/bucket missing/)
  })
})
