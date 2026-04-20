import { describe, it, expect } from "vitest"
import { buildResearchBrief } from "../lib/research-brief.js"

describe("buildResearchBrief", () => {
  it("shapes Tavily output into the stored brief", () => {
    const brief = buildResearchBrief({
      topic: "shoulder rehab",
      search: {
        answer: "Top shoulder-rehab protocols mention...",
        results: [
          { title: "PubMed", url: "https://pubmed.example/a", content: "abc", score: 0.9, published_date: "2025-01-01" },
          { title: "JOSPT", url: "https://jospt.example/b", content: "def", score: 0.8, published_date: null },
        ],
      },
      extractedContent: [
        { url: "https://pubmed.example/a", content: "full page text" },
      ],
      generatedAt: "2026-04-20T10:00:00.000Z",
    })

    expect(brief.topic).toBe("shoulder rehab")
    expect(brief.summary).toBe("Top shoulder-rehab protocols mention...")
    expect(brief.results).toHaveLength(2)
    expect(brief.results[0]).toEqual({
      title: "PubMed",
      url: "https://pubmed.example/a",
      snippet: "abc",
      score: 0.9,
      published_date: "2025-01-01",
    })
    expect(brief.extracted).toEqual([{ url: "https://pubmed.example/a", content: "full page text" }])
    expect(brief.generated_at).toBe("2026-04-20T10:00:00.000Z")
  })

  it("handles null answer + empty extracts", () => {
    const brief = buildResearchBrief({
      topic: "x",
      search: { answer: null, results: [] },
      extractedContent: [],
      generatedAt: "2026-04-20T10:00:00.000Z",
    })
    expect(brief.summary).toBeNull()
    expect(brief.results).toEqual([])
    expect(brief.extracted).toEqual([])
  })
})
