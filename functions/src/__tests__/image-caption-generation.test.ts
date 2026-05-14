import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUpdate = vi.fn()
const mockGet = vi.fn()
const mockDoc = vi.fn(() => ({ update: mockUpdate, get: mockGet }))
const mockCollection = vi.fn(() => ({ doc: mockDoc }))
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "ts" },
  getFirestore: () => ({ collection: mockCollection }),
}))

const mockFile = { download: vi.fn() }
const mockBucket = { file: () => mockFile }
vi.mock("firebase-admin/storage", () => ({
  getStorage: () => ({ bucket: () => mockBucket }),
}))

// Supabase mock: from('media_assets').select(...).eq(...).in(...) returns assets;
// from('social_posts').update(...).eq(...) writes the caption.
const mockMediaAssetIn = vi.fn()
const mockSocialPostUpdateEq = vi.fn().mockResolvedValue({ error: null })

vi.mock("../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === "media_assets") {
        return {
          select: () => ({
            eq: () => ({ in: mockMediaAssetIn }),
          }),
        }
      }
      if (table === "social_posts") {
        return {
          update: () => ({ eq: mockSocialPostUpdateEq }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }),
}))

const mockCreateMessage = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreateMessage }
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = "sk-test"
})

import { handleImageCaptionGeneration } from "../image-caption-generation.js"

describe("handleImageCaptionGeneration", () => {
  it("writes caption + hashtags to social_posts on success", async () => {
    mockGet.mockResolvedValueOnce({
      data: () => ({
        type: "image_caption_generation",
        input: { socialPostId: "post1", platform: "instagram", mediaAssetIds: ["a1"] },
      }),
    })
    mockMediaAssetIn.mockResolvedValueOnce({
      data: [{ id: "a1", storage_path: "p", mime_type: "image/jpeg" }],
      error: null,
    })
    mockFile.download.mockResolvedValueOnce([Buffer.from("img")])
    mockCreateMessage.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"caption":"Hook line\\n\\nBody.","hashtags":["squat","reps"],"cta":null}' }],
    })

    await handleImageCaptionGeneration("job1")

    expect(mockSocialPostUpdateEq).toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }))
  })

  it("fails the job when input.socialPostId is missing", async () => {
    mockGet.mockResolvedValueOnce({
      data: () => ({ type: "image_caption_generation", input: { platform: "instagram", mediaAssetIds: ["a1"] } }),
    })
    await handleImageCaptionGeneration("job1")
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }))
  })
})
