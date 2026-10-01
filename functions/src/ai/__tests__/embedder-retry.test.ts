import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Production logs, every day since at least 2026-09-24: "Embedding search failed ... Error (429)
 * occurred while trying to load file: huggingface.co/.../tokenizer.json". The loader cached its
 * load promise, so ONE rate-limited download left a rejected promise in place for the life of
 * the instance and every later search on it failed without trying again.
 */
const pipelineMock = vi.fn()
vi.mock("@huggingface/transformers", () => ({ pipeline: (...args: unknown[]) => pipelineMock(...args) }))

const extractor = async () => ({ data: new Float32Array([0.5, 0.5]), dims: [1, 2] })

describe("embedding model loader", () => {
  beforeEach(() => {
    vi.resetModules()
    pipelineMock.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("tries the download again after a failure instead of failing forever", async () => {
    pipelineMock
      .mockRejectedValueOnce(new Error("Error (429) occurred while trying to load file"))
      .mockResolvedValue(extractor)
    const { embedText } = await import("../embeddings.js")

    await expect(embedText("a")).rejects.toThrow("429")
    vi.setSystemTime(new Date("2026-10-01T00:01:01Z"))
    await expect(embedText("b")).resolves.toEqual([0.5, 0.5])
    expect(pipelineMock).toHaveBeenCalledTimes(2)
  })

  it("does not hammer the host: calls inside the cooldown fail fast without a download", async () => {
    pipelineMock.mockRejectedValue(new Error("Error (429)"))
    const { embedText } = await import("../embeddings.js")

    await expect(embedText("a")).rejects.toThrow("429")
    vi.setSystemTime(new Date("2026-10-01T00:00:10Z"))
    await expect(embedText("b")).rejects.toThrow("429")
    expect(pipelineMock).toHaveBeenCalledTimes(1)
  })

  it("loads once and reuses the model when the download works", async () => {
    pipelineMock.mockResolvedValue(extractor)
    const { embedText } = await import("../embeddings.js")
    await embedText("a")
    await embedText("b")
    expect(pipelineMock).toHaveBeenCalledTimes(1)
  })
})
