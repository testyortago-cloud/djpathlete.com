import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSubscribe = vi.fn()
const mockConfig = vi.fn()

vi.mock("@fal-ai/client", () => ({
  fal: {
    config: mockConfig,
    subscribe: mockSubscribe,
  },
}))

// fetch is mocked per-test so we can return a real-sized buffer
const fakeImageBuffer = Buffer.alloc(20_000, 0xab)
global.fetch = vi.fn(async () =>
  new Response(fakeImageBuffer, { headers: { "content-type": "image/png" } }),
) as unknown as typeof fetch

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FAL_KEY = "test-key"
  mockSubscribe.mockResolvedValue({
    data: {
      images: [{ url: "https://fal.example/img.png", content_type: "image/png" }],
      has_nsfw_concepts: [false],
      seed: 4242,
    },
  })
})

describe("generateFalImage", () => {
  it("passes seed, num_inference_steps, and guidance_scale to fal when provided", async () => {
    const { generateFalImage } = await import("../lib/fal-client.js")
    await generateFalImage({
      model: "fal-ai/flux-pro/v1.1-ultra",
      prompt: "p",
      width: 2400,
      height: 1260,
      seed: 4242,
      numInferenceSteps: 40,
      guidanceScale: 3.5,
    })
    expect(mockSubscribe).toHaveBeenCalledWith(
      "fal-ai/flux-pro/v1.1-ultra",
      expect.objectContaining({
        input: expect.objectContaining({
          prompt: "p",
          image_size: { width: 2400, height: 1260 },
          seed: 4242,
          num_inference_steps: 40,
          guidance_scale: 3.5,
        }),
      }),
    )
  })

  it("returns the seed fal used so callers can persist it for regeneration", async () => {
    const { generateFalImage } = await import("../lib/fal-client.js")
    const result = await generateFalImage({
      model: "fal-ai/flux-pro/v1.1",
      prompt: "p",
      width: 1024,
      height: 576,
    })
    expect(result.seed).toBe(4242)
  })
})
