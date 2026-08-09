import { describe, it, expect } from "vitest"
import { buildTopicResearchPrompt } from "../topic-research-scan.js"

describe("buildTopicResearchPrompt", () => {
  it("embeds the requested topic and Tavily results as numbered entries", () => {
    const prompt = buildTopicResearchPrompt("blood flow restriction training", [
      { title: "BFR and hypertrophy", url: "https://a.example", content: "snippet A" },
      { title: "BFR safety thresholds", url: "https://b.example", content: "snippet B" },
    ])
    expect(prompt).toContain("blood flow restriction training")
    expect(prompt).toContain("BFR and hypertrophy")
    expect(prompt).toContain("https://a.example")
    expect(prompt).toContain("snippet A")
    expect(prompt).toMatch(/3\s*[-–]\s*6\s+topics?/i)
  })

  it("handles empty search results gracefully", () => {
    const prompt = buildTopicResearchPrompt("an obscure niche topic", [])
    expect(prompt).toContain("an obscure niche topic")
    expect(prompt.toLowerCase()).toContain("no search results")
  })
})
