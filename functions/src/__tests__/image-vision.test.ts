import { describe, it, expect, vi, beforeEach } from "vitest"

// --- Mock firebase-admin/firestore ---
interface JobDoc {
  status?: string
  type: string
  input: { mediaAssetId: string }
}
const jobDocMock: JobDoc = { status: "pending", type: "image_vision", input: { mediaAssetId: "asset-1" } }
const jobUpdateMock = vi.fn()
const jobGetMock: ReturnType<typeof vi.fn> = vi.fn(async () => ({ data: () => jobDocMock }))

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "TIMESTAMP" },
  getFirestore: () => ({
    collection: () => ({
      doc: () => ({ get: jobGetMock, update: jobUpdateMock }),
    }),
  }),
}))

// --- Mock firebase-admin/storage ---
const storageFileBufferMock = vi.fn(async () => [Buffer.from([0xff, 0xd8, 0xff, 0xe0])]) // minimal jpeg magic
vi.mock("firebase-admin/storage", () => ({
  getStorage: () => ({
    bucket: () => ({
      file: () => ({ download: storageFileBufferMock }),
    }),
  }),
}))

// --- Mock Supabase client ---
const assetSelectMock = vi.fn()
const assetUpdateMock = vi.fn()
vi.mock("../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === "media_assets") {
        return {
          select: () => ({
            eq: () => ({ single: assetSelectMock }),
          }),
          update: (patch: unknown) => {
            assetUpdateMock(patch)
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }),
}))

// --- Mock Anthropic SDK ---
const anthropicCreateMock = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: anthropicCreateMock }
  },
}))

describe("handleImageVision", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobGetMock.mockResolvedValue({
      data: () => ({ type: "image_vision", input: { mediaAssetId: "asset-1" } }),
    })
    assetSelectMock.mockResolvedValue({
      data: { id: "asset-1", storage_path: "images/u/1-photo.jpg", mime_type: "image/jpeg" },
      error: null,
    })
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            alt_text: "Athlete performing a barbell back squat with straight spine in a gym.",
            scene: "gym",
            objects: ["barbell", "squat rack", "athlete"],
            suggested_hashtags: ["strength", "squats", "training"],
          }),
        },
      ],
    })
    process.env.ANTHROPIC_API_KEY = "test-key"
  })

  it("downloads image, calls Claude vision, writes ai_alt_text + ai_analysis", async () => {
    const { handleImageVision } = await import("../image-vision.js")
    await handleImageVision("job-123")

    // Asset was fetched
    expect(assetSelectMock).toHaveBeenCalled()

    // Claude was called with an image content block
    expect(anthropicCreateMock).toHaveBeenCalledOnce()
    const call = anthropicCreateMock.mock.calls[0][0]
    expect(call.model).toBe("claude-sonnet-4-6")
    const userContent = call.messages[0].content
    const imageBlock = userContent.find((b: { type: string }) => b.type === "image")
    expect(imageBlock).toBeDefined()
    expect(imageBlock.source.type).toBe("base64")
    expect(imageBlock.source.media_type).toBe("image/jpeg")

    // Asset row updated with parsed alt_text and analysis
    expect(assetUpdateMock).toHaveBeenCalledOnce()
    const patch = assetUpdateMock.mock.calls[0][0]
    expect(patch.ai_alt_text).toBe("Athlete performing a barbell back squat with straight spine in a gym.")
    expect(patch.ai_analysis).toEqual({
      scene: "gym",
      objects: ["barbell", "squat rack", "athlete"],
      suggested_hashtags: ["strength", "squats", "training"],
    })

    // Job marked completed
    const finalStatusUpdate = jobUpdateMock.mock.calls.find((c) => c[0].status === "completed")
    expect(finalStatusUpdate).toBeDefined()
  })

  it("marks the job failed when the asset row is missing", async () => {
    assetSelectMock.mockResolvedValue({ data: null, error: { message: "not found" } })

    const { handleImageVision } = await import("../image-vision.js")
    await handleImageVision("job-missing-asset")

    expect(assetUpdateMock).not.toHaveBeenCalled()
    const failUpdate = jobUpdateMock.mock.calls.find((c) => c[0].status === "failed")
    expect(failUpdate).toBeDefined()
  })

  it("gracefully degrades when Claude returns non-JSON text", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "sorry, i can't parse this image" }],
    })

    const { handleImageVision } = await import("../image-vision.js")
    await handleImageVision("job-bad-json")

    // No asset update when parsing fails; job still marked failed (not completed)
    expect(assetUpdateMock).not.toHaveBeenCalled()
    const failUpdate = jobUpdateMock.mock.calls.find((c) => c[0].status === "failed")
    expect(failUpdate).toBeDefined()
  })
})
