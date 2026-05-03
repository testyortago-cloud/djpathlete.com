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
  // Real fal-generated images at our sizes are well over 5KB. Tests that
  // exercise the happy path use a 6KB buffer so they pass the
  // MIN_REAL_IMAGE_BYTES guard. Tests that exercise the small-buffer guard
  // override fetch with a smaller buffer.
  const happyPathBuffer = new Uint8Array(6000).fill(1).buffer

  beforeEach(() => {
    mockSubscribe.mockReset()
    mockConfig.mockReset()
    process.env.FAL_KEY = "fal-test-key"
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => happyPathBuffer,
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
    expect(result.buffer.length).toBe(6000)
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

  it("throws when has_nsfw_concepts[0] is true (safety checker fired)", async () => {
    mockSubscribe.mockResolvedValueOnce({
      data: {
        images: [{ url: "https://fal.media/files/abc.png", content_type: "image/png" }],
        has_nsfw_concepts: [true],
      },
    })
    await expect(
      generateFalImage({
        model: "fal-ai/flux/schnell",
        prompt: "close-up of athlete's quadriceps muscles",
        width: 1024,
        height: 576,
      }),
    ).rejects.toThrow(/safety checker/i)
  })

  it("does NOT throw when has_nsfw_concepts[0] is false", async () => {
    mockSubscribe.mockResolvedValueOnce({
      data: {
        images: [{ url: "https://fal.media/files/abc.png", content_type: "image/png" }],
        has_nsfw_concepts: [false],
      },
    })
    const result = await generateFalImage({
      model: "fal-ai/flux/schnell",
      prompt: "an athlete sprinting",
      width: 1024,
      height: 576,
    })
    expect(result.buffer.length).toBe(6000)
  })

  it("throws when downloaded buffer is suspiciously small (likely a safety placeholder)", async () => {
    mockSubscribe.mockResolvedValueOnce({
      data: { images: [{ url: "https://fal.media/files/abc.png", content_type: "image/png" }] },
    })
    // 1110-byte response, matching the real-world all-black placeholder size.
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array(1110).buffer,
      headers: { get: () => "image/webp" },
    })) as unknown as typeof fetch
    await expect(
      generateFalImage({ model: "fal-ai/flux/schnell", prompt: "x", width: 1024, height: 576 }),
    ).rejects.toThrow(/suspiciously small/i)
  })
})
