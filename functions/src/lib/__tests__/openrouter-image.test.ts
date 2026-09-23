import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import { generateOpenRouterImage, toSize } from "../openrouter-image.js"

const originalFetch = globalThis.fetch

function respond(status: number, body: unknown) {
  globalThis.fetch = vi.fn(async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch
}

const b64 = (bytes: number) => Buffer.alloc(bytes, 1).toString("base64")

describe("toSize", () => {
  // OpenAI 400s "2400x1260": both sides must be divisible by 16.
  it("rounds both sides to a multiple of 16", () => {
    expect(toSize(2400, 1260)).toBe("2400x1264")
    expect(toSize(2048, 1152)).toBe("2048x1152")
  })
})

describe("generateOpenRouterImage", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "or-test-key"
  })
  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  it("posts to /images/generations with model, prompt and a /16 size, and decodes b64_json", async () => {
    respond(200, { data: [{ b64_json: b64(6000), media_type: "image/png" }] })
    const result = await generateOpenRouterImage({
      model: "openai/gpt-image-2.5-sunburst",
      prompt: "a sled push",
      width: 2400,
      height: 1260,
    })

    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe("https://openrouter.ai/api/v1/images/generations")
    expect(init.headers.Authorization).toBe("Bearer or-test-key")
    expect(JSON.parse(init.body)).toEqual({
      model: "openai/gpt-image-2.5-sunburst",
      prompt: "a sled push",
      n: 1,
      size: "2400x1264",
    })
    expect(result.buffer.length).toBe(6000)
    expect(result.mime).toBe("image/png")
  })

  it("surfaces the provider's raw reason, not just 'Provider returned error'", async () => {
    respond(400, {
      error: { message: "Provider returned error", code: 400, metadata: { raw: "Invalid size '2400x1260'" } },
    })
    await expect(
      generateOpenRouterImage({ model: "openai/gpt-image-2.5-flare", prompt: "x", width: 2048, height: 1152 }),
    ).rejects.toThrow(/400.*Provider returned error.*Invalid size/)
  })

  it("rejects a placeholder-sized image", async () => {
    respond(200, { data: [{ b64_json: b64(1000), media_type: "image/png" }] })
    await expect(
      generateOpenRouterImage({ model: "openai/gpt-image-2.5-flare", prompt: "x", width: 2048, height: 1152 }),
    ).rejects.toThrow(/suspiciously small/)
  })

  it("throws when the response carries no image", async () => {
    respond(200, { data: [] })
    await expect(
      generateOpenRouterImage({ model: "openai/gpt-image-2.5-flare", prompt: "x", width: 2048, height: 1152 }),
    ).rejects.toThrow(/no image/)
  })

  it("refuses to call without a key", async () => {
    delete process.env.OPENROUTER_API_KEY
    await expect(
      generateOpenRouterImage({ model: "openai/gpt-image-2.5-flare", prompt: "x", width: 2048, height: 1152 }),
    ).rejects.toThrow(/OPENROUTER_API_KEY/)
  })
})
