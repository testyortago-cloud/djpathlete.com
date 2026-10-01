import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Twin of functions/src/ai/__tests__/embeddings-openrouter.test.ts. The app embeds an
 * exercise on create/update (lib/db/exercises.ts) and program feedback; the functions
 * search against those vectors. If the two embedders ever disagree on model or size,
 * every search silently compares vectors from different spaces — so both are pinned.
 */
const fetchMock = vi.fn()
const vec = (n: number) => Array.from({ length: 384 }, () => n)

describe("lib/ai/embeddings — OpenRouter", () => {
  beforeEach(() => {
    vi.resetModules()
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test")
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("asks for the same model and size as the functions embedder", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ index: 0, embedding: vec(0.3) }] }),
      text: async () => "",
    })
    const { embedText, EMBEDDING_DIMS } = await import("@/lib/ai/embeddings")

    await expect(embedText("Ab squats_Core")).resolves.toHaveLength(384)
    expect(EMBEDDING_DIMS).toBe(384)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://openrouter.ai/api/v1/embeddings")
    expect(JSON.parse(init.body)).toMatchObject({
      model: "openai/text-embedding-3-small",
      input: ["Ab squats_Core"],
      dimensions: 384,
    })
  })

  it("refuses a vector of the wrong size", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ index: 0, embedding: [1, 2, 3] }] }),
      text: async () => "",
    })
    const { embedText } = await import("@/lib/ai/embeddings")
    await expect(embedText("x")).rejects.toThrow(/384/)
  })
})
