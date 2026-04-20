import { describe, it, expect, vi, beforeEach } from "vitest"
import { tavilySearch, tavilyExtract } from "../tavily.js"

describe("tavily client", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.TAVILY_API_KEY = "test-key"
  })

  it("tavilySearch POSTs to /search with query + api_key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        query: "rotational training",
        results: [{ title: "x", url: "https://x", content: "c", score: 0.9 }],
        answer: "summary",
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await tavilySearch({ query: "rotational training", max_results: 3 })

    expect(result.results.length).toBe(1)
    expect(result.answer).toBe("summary")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.tavily.com/search")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      api_key: "test-key",
      query: "rotational training",
      max_results: 3,
    })
  })

  it("tavilyExtract POSTs to /extract with urls list", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ url: "https://a", raw_content: "body text" }],
        failed_results: [],
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await tavilyExtract({ urls: ["https://a"] })
    expect(result.results.length).toBe(1)
    expect(result.results[0].raw_content).toBe("body text")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.tavily.com/extract")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.urls).toEqual(["https://a"])
    expect(body.api_key).toBe("test-key")
  })

  it("throws when TAVILY_API_KEY is not set", async () => {
    delete process.env.TAVILY_API_KEY
    await expect(tavilySearch({ query: "x" })).rejects.toThrow(/TAVILY_API_KEY/)
  })
})
