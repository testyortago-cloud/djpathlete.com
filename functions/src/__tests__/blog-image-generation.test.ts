import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  extractImagePrompts: vi.fn(),
  generateFalImage: vi.fn(),
  transcodeAndUpload: vi.fn(),
  generateAltText: vi.fn(),
  judgeImageQuality: vi.fn(),
  getFirestore: vi.fn(),
  getSupabase: vi.fn(),
}))

vi.mock("../ai/image-prompts.js", () => ({
  extractImagePrompts: mocks.extractImagePrompts,
  PROMPT_VERSION: "v2",
}))
vi.mock("../lib/fal-client.js", () => ({ generateFalImage: mocks.generateFalImage }))
vi.mock("../lib/image-pipeline.js", () => ({
  transcodeAndUpload: mocks.transcodeAndUpload,
  RENDER_DIMENSIONS: {
    hero: { width: 2400, height: 1260 },
    inline: { width: 2048, height: 1152 },
  },
  FINAL_DIMENSIONS: {
    hero: { width: 1200, height: 630 },
    inline: { width: 1024, height: 576 },
  },
}))
vi.mock("../lib/image-alt-text.js", () => ({ generateAltText: mocks.generateAltText }))
vi.mock("../lib/image-quality-judge.js", () => ({
  judgeImageQuality: mocks.judgeImageQuality,
  QUALITY_RETRY_THRESHOLD: 7,
}))
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
    mocks.generateFalImage.mockResolvedValue({
      buffer: Buffer.from("png"),
      mime: "image/png",
      seed: 1234,
    })
    mocks.transcodeAndUpload.mockImplementation(async ({ kind, sectionIdx }) => ({
      url: kind === "hero" ? "https://supa/x-hero.webp" : `https://supa/x-section-${sectionIdx}.webp`,
      width: kind === "hero" ? 1200 : 1024,
      height: kind === "hero" ? 630 : 576,
      path: kind === "hero" ? "x-hero.webp" : `x-section-${sectionIdx}.webp`,
    }))
    mocks.generateAltText.mockResolvedValue("Athlete training")
    mocks.judgeImageQuality.mockResolvedValue({ score: 9, reasons: ["sharp"], judge_failed: false })
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
        cover_image_meta: expect.objectContaining({
          seed: 1234,
          model: "fal-ai/flux-pro/v1.1-ultra",
          prompt_version: expect.stringMatching(/^v\d+$/),
          quality_score: 9,
          judge_failed: false,
          attempts: 1,
        }),
        inline_images: expect.arrayContaining([
          expect.objectContaining({
            url: "https://supa/x-section-1.webp",
            seed: 1234,
            model: "fal-ai/flux-pro/v1.1",
            prompt_version: expect.stringMatching(/^v\d+$/),
            quality_score: 9,
            judge_failed: false,
          }),
        ]),
        content: expect.stringContaining('<img src="https://supa/x-section-1.webp"'),
      }),
    )

    const completedCall = jobUpdate.mock.calls.find((c) => c[0]?.status === "completed")
    expect(completedCall).toBeDefined()
  })

  it("survives a single inline-image failure: hero proceeds, post is updated with cover only", async () => {
    mocks.generateFalImage
      .mockResolvedValueOnce({ buffer: Buffer.from("hero"), mime: "image/png", seed: 11 })
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

  it("retries once on a fresh seed when the judge scores below threshold", async () => {
    mocks.judgeImageQuality
      .mockResolvedValueOnce({ score: 4, reasons: ["plastic skin"], judge_failed: false })
      .mockResolvedValueOnce({ score: 8, reasons: ["fixed"], judge_failed: false })
      .mockResolvedValueOnce({ score: 8, reasons: ["fine"], judge_failed: false })
    mocks.generateFalImage
      .mockResolvedValueOnce({ buffer: Buffer.from("a"), mime: "image/png", seed: 1 })
      .mockResolvedValueOnce({ buffer: Buffer.from("b"), mime: "image/png", seed: 2 })
      .mockResolvedValueOnce({ buffer: Buffer.from("c"), mime: "image/png", seed: 3 })

    await handleBlogImageGeneration("job-1")

    // Hero was generated twice (initial + 1 retry), inline once
    expect(mocks.generateFalImage).toHaveBeenCalledTimes(3)
    expect(mocks.transcodeAndUpload).toHaveBeenCalledTimes(3)
    expect(mocks.judgeImageQuality).toHaveBeenCalledTimes(3)

    const completedCall = jobUpdate.mock.calls.find((c) => c[0]?.status === "completed")
    expect(completedCall).toBeDefined()
  })

  it("does not retry more than once even if the second attempt also scores low", async () => {
    mocks.judgeImageQuality.mockResolvedValue({ score: 3, reasons: ["still bad"], judge_failed: false })

    await handleBlogImageGeneration("job-1")

    // Hero: 2 attempts (initial + 1 retry) — never a 3rd. Inline: 1.
    expect(mocks.generateFalImage).toHaveBeenCalledTimes(3)
    expect(mocks.transcodeAndUpload).toHaveBeenCalledTimes(3)
    expect(mocks.judgeImageQuality).toHaveBeenCalledTimes(3)
  })

  it("does not retry when judge itself failed (judge_failed=true)", async () => {
    mocks.judgeImageQuality.mockResolvedValue({ score: 0, reasons: ["unparseable"], judge_failed: true })

    await handleBlogImageGeneration("job-1")

    // Hero: 1 attempt (no retry because judge_failed). Inline: 1.
    expect(mocks.generateFalImage).toHaveBeenCalledTimes(2)
    expect(mocks.transcodeAndUpload).toHaveBeenCalledTimes(2)
    expect(mocks.judgeImageQuality).toHaveBeenCalledTimes(2)
  })
})
