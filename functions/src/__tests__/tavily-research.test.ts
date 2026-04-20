import { describe, it, expect } from "vitest"
import { buildResearchBrief, shouldPersist } from "../tavily-research.js"

describe("tavily-research helpers", () => {
  it("buildResearchBrief shapes Tavily output into the stored brief", () => {
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

  it("buildResearchBrief handles null answer + empty extracts", () => {
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

  it("shouldPersist returns true only when blog_post_id is a non-empty string", () => {
    expect(shouldPersist({ topic: "x" })).toBe(false)
    expect(shouldPersist({ topic: "x", blog_post_id: "" })).toBe(false)
    expect(shouldPersist({ topic: "x", blog_post_id: "abc-123" })).toBe(true)
  })
})
