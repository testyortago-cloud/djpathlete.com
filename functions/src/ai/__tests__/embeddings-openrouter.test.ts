import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Embeddings come from OpenRouter (openai/text-embedding-3-small at 384 dimensions) since
 * 2026-10-01. Before that the model was downloaded from the Hugging Face Hub at runtime, and
 * the Hub's anonymous rate limit (429) turned vector search off on most slots every day from
 * at least 2026-09-24 — the failure stayed cached for the life of the instance.
 *
 * 384 is not a free choice: exercises.embedding, ai_conversation_history.embedding and
 * ai_program_feedback.embedding are vector(384), and match_exercises takes vector(384).
 */
const fetchMock = vi.fn()

function okResponse(vectors: number[][], shuffle = false) {
  const data = vectors.map((embedding, index) => ({ object: "embedding", index, embedding }))
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: shuffle ? [...data].reverse() : data }),
    text: async () => "",
  }
}
const vec = (n: number) => Array.from({ length: 384 }, () => n)

describe("OpenRouter embeddings", () => {
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

  it("asks for text-embedding-3-small at the 384 dimensions the vector columns store", async () => {
    fetchMock.mockResolvedValue(okResponse([vec(0.1)]))
    const { embedText } = await import("../embeddings.js")

    const out = await embedText("primary_compound lunge targeting quadriceps")

    expect(out).toHaveLength(384)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://openrouter.ai/api/v1/embeddings")
    expect(init.headers.Authorization).toBe("Bearer sk-or-test")
    expect(JSON.parse(init.body)).toMatchObject({
      model: "openai/text-embedding-3-small",
      input: ["primary_compound lunge targeting quadriceps"],
      dimensions: 384,
    })
  })

  it("batches many texts and returns vectors in input order even when the API reorders them", async () => {
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
      const { input } = JSON.parse(init.body) as { input: string[] }
      return okResponse(
        input.map((t) => vec(Number(t))),
        true,
      )
    })
    const { embedTexts } = await import("../embeddings.js")

    const texts = Array.from({ length: 130 }, (_, i) => String(i))
    const out = await embedTexts(texts)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(out.map((v) => v[0])).toEqual(texts.map(Number))
  })

  it("retries a rate limit, then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}), text: async () => "rate limited" })
      .mockResolvedValueOnce(okResponse([vec(0.2)]))
    const { embedText } = await import("../embeddings.js")

    await expect(embedText("x")).resolves.toHaveLength(384)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("fails loudly on a vector of the wrong size instead of writing it to a vector(384) column", async () => {
    fetchMock.mockResolvedValue(okResponse([[0.1, 0.2]]))
    const { embedText } = await import("../embeddings.js")
    await expect(embedText("x")).rejects.toThrow(/384/)
  })

  it("fails loudly on an error body that arrives with status 200", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: { message: "No endpoints found" } }),
      text: async () => "",
    })
    const { embedText } = await import("../embeddings.js")
    await expect(embedText("x")).rejects.toThrow(/No endpoints found/)
  })

  it("says the key is missing rather than sending an unauthenticated request", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "")
    const { embedText } = await import("../embeddings.js")
    await expect(embedText("x")).rejects.toThrow(/OPENROUTER_API_KEY/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
