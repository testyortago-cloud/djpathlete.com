import { describe, it, expect } from "vitest"
import {
  buildFactCheckPrompt,
  classifyStatus,
  type FactCheckFlaggedClaim,
} from "../tavily-fact-check.js"

describe("tavily-fact-check helpers", () => {
  it("buildFactCheckPrompt embeds content + brief URLs under clear headings", () => {
    const prompt = buildFactCheckPrompt({
      content: "<p>Shoulder rehab takes 6 weeks.</p>",
      brief: {
        topic: "shoulder rehab",
        summary: "6-12 week timeline common",
        results: [
          { title: "PubMed", url: "https://pubmed.example/a", snippet: "s", score: 0.9, published_date: null },
        ],
        extracted: [{ url: "https://pubmed.example/a", content: "typical timeline is 8-12 weeks" }],
        generated_at: "2026-04-20T10:00:00.000Z",
      },
      maxClaims: 10,
    })
    expect(prompt).toContain("CONTENT TO FACT-CHECK")
    expect(prompt).toContain("Shoulder rehab takes 6 weeks.")
    expect(prompt).toContain("RESEARCH BRIEF")
    expect(prompt).toContain("https://pubmed.example/a")
    expect(prompt).toContain("typical timeline is 8-12 weeks")
    expect(prompt).toMatch(/max(imum)?\s+\d+\s+claims?/i)
  })

  it("classifyStatus returns 'passed' for empty, 'flagged' for 1-5, 'failed' for 6+", () => {
    expect(classifyStatus(0)).toBe("passed")
    expect(classifyStatus(1)).toBe("flagged")
    expect(classifyStatus(5)).toBe("flagged")
    expect(classifyStatus(6)).toBe("failed")
    expect(classifyStatus(99)).toBe("failed")
  })

  it("FactCheckFlaggedClaim shape: verdict is 'unverifiable' or 'contradicted' only", () => {
    const flagged: FactCheckFlaggedClaim = {
      claim: "x",
      span_start: null,
      span_end: null,
      source_urls_checked: [],
      verdict: "unverifiable",
      notes: "no matching source",
    }
    expect(flagged.verdict).toBe("unverifiable")
  })
})
