import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  extractImagePrompts: vi.fn(),
  generateFalImage: vi.fn(),
  transcodeAndUpload: vi.fn(),
  generateAltText: vi.fn(),
  getFirestore: vi.fn(),
  getSupabase: vi.fn(),
}))

vi.mock("../ai/image-prompts.js", () => ({ extractImagePrompts: mocks.extractImagePrompts }))
vi.mock("../lib/fal-client.js", () => ({ generateFalImage: mocks.generateFalImage }))
vi.mock("../lib/image-pipeline.js", () => ({ transcodeAndUpload: mocks.transcodeAndUpload }))
vi.mock("../lib/image-alt-text.js", () => ({ generateAltText: mocks.generateAltText }))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: mocks.getFirestore,
  FieldValue: { serverTimestamp: () => "TS" },
}))
vi.mock("../lib/supabase.js", () => ({ getSupabase: mocks.getSupabase }))

import { handleBlogImageGeneration } from "../blog-image-generation.js"

describe("handleBlogImageGeneration", () => {
  let jobUpdate: ReturnType<typeof vi.fn>
  let postSelectSingle: ReturnType<typeof vi.fn>
  let postUpdate: ReturnType<typeof vi.fn>
  const longPara = `<p>${"word ".repeat(160)}</p>`

  beforeEach(() => {
    vi.clearAllMocks()
    jobUpdate = vi.fn().mockResolvedValue(undefined)
    postSelectSingle = vi.fn().mockResolvedValue({
      data: {
        id: "post-1",
        title: "Test",
        slug: "test-slug",
        content: `<h2>Section A</h2>${longPara}`,
        category: "Performance",
      },
      error: null,
    })
    postUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }))

    mocks.getFirestore.mockReturnValue({
      collection: () => ({
        doc: () => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ input: { blog_post_id: "post-1" } }),
          }),
          update: jobUpdate,
        }),
      }),
    })
    mocks.getSupabase.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: postSelectSingle }) }),
        update: postUpdate,
      }),
    })

    mocks.extractImagePrompts.mockResolvedValue({
      hero_prompt: "hero prompt",
      inline_prompts: [{ section_h2: "Section A", prompt: "a prompt" }],
    })
    mocks.generateFalImage.mockResolvedValue({ buffer: Buffer.from("png"), mime: "image/png" })
    mocks.transcodeAndUpload.mockImplementation(async ({ kind, sectionIdx }) => ({
      url: kind === "hero" ? "https://supa/x-hero.webp" : `https://supa/x-section-${sectionIdx}.webp`,
      width: kind === "hero" ? 1200 : 1024,
      height: kind === "hero" ? 630 : 576,
      path: kind === "hero" ? "x-hero.webp" : `x-section-${sectionIdx}.webp`,
    }))
    mocks.generateAltText.mockResolvedValue("Athlete training")
  })

  it("generates hero + inline images, uploads, splices, and updates blog_posts", async () => {
    await handleBlogImageGeneration("job-1")

    expect(mocks.extractImagePrompts).toHaveBeenCalledTimes(1)
    expect(mocks.generateFalImage).toHaveBeenCalledTimes(2)
    expect(mocks.transcodeAndUpload).toHaveBeenCalledTimes(2)
    expect(mocks.generateAltText).toHaveBeenCalledTimes(2)

    expect(postUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        cover_image_url: "https://supa/x-hero.webp",
        inline_images: expect.arrayContaining([
          expect.objectContaining({ url: "https://supa/x-section-1.webp", section_h2: "Section A" }),
        ]),
        content: expect.stringContaining('<img src="https://supa/x-section-1.webp"'),
      }),
    )

    const completedCall = jobUpdate.mock.calls.find((c) => c[0]?.status === "completed")
    expect(completedCall).toBeDefined()
  })

  it("survives a single inline-image failure: hero proceeds, post is updated with cover only", async () => {
    mocks.generateFalImage
      .mockResolvedValueOnce({ buffer: Buffer.from("hero"), mime: "image/png" })
      .mockRejectedValueOnce(new Error("fal 503"))

    await handleBlogImageGeneration("job-1")

    expect(postUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        cover_image_url: "https://supa/x-hero.webp",
        inline_images: [],
      }),
    )
    const completedCall = jobUpdate.mock.calls.find((c) => c[0]?.status === "completed")
    expect(completedCall?.[0]?.result?.failed_inline_count).toBe(1)
  })

  it("fails the job when hero generation fails", async () => {
    mocks.generateFalImage.mockRejectedValueOnce(new Error("fal 500 hero"))

    await handleBlogImageGeneration("job-1")

    const failedCall = jobUpdate.mock.calls.find((c) => c[0]?.status === "failed")
    expect(failedCall).toBeDefined()
    expect(failedCall?.[0]?.error).toContain("hero")
  })
})
