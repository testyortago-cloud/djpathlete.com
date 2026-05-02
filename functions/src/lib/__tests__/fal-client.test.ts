import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"

vi.mock("@fal-ai/client", () => {
  return {
    fal: {
      config: vi.fn(),
      subscribe: vi.fn(),
    },
  }
})

const originalFetch = globalThis.fetch

import { generateFalImage } from "../fal-client.js"
import { fal } from "@fal-ai/client"

const mockConfig = fal.config as ReturnType<typeof vi.fn>
const mockSubscribe = fal.subscribe as ReturnType<typeof vi.fn>

describe("generateFalImage", () => {
  beforeEach(() => {
    mockSubscribe.mockReset()
    mockConfig.mockReset()
    process.env.FAL_KEY = "fal-test-key"
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      headers: { get: (k: string) => (k === "content-type" ? "image/png" : null) },
    })) as unknown as typeof fetch
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  it("calls fal.subscribe with correct model and dimensions, downloads and returns buffer", async () => {
    mockSubscribe.mockResolvedValueOnce({
      data: { images: [{ url: "https://fal.media/files/abc.png", content_type: "image/png" }] },
    })

    const result = await generateFalImage({
      model: "fal-ai/flux/schnell",
      prompt: "an athlete sprinting",
      width: 1024,
      height: 576,
    })

    expect(mockConfig).toHaveBeenCalledWith({ credentials: "fal-test-key" })
    expect(mockSubscribe).toHaveBeenCalledWith(
      "fal-ai/flux/schnell",
      expect.objectContaining({
        input: expect.objectContaining({
          prompt: "an athlete sprinting",
          image_size: { width: 1024, height: 576 },
        }),
      }),
    )
    expect(result.buffer).toBeInstanceOf(Buffer)
    expect(result.buffer.length).toBe(4)
    expect(result.mime).toBe("image/png")
  })

  it("throws when fal returns no images", async () => {
    mockSubscribe.mockResolvedValueOnce({ data: { images: [] } })
    await expect(
      generateFalImage({ model: "fal-ai/flux/schnell", prompt: "x", width: 1024, height: 576 }),
    ).rejects.toThrow(/no images/i)
  })

  it("throws when image download fails", async () => {
    mockSubscribe.mockResolvedValueOnce({
      data: { images: [{ url: "https://fal.media/files/abc.png", content_type: "image/png" }] },
    })
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch
    await expect(
      generateFalImage({ model: "fal-ai/flux/schnell", prompt: "x", width: 1024, height: 576 }),
    ).rejects.toThrow(/download/i)
  })
})
