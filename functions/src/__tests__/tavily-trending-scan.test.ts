import { describe, it, expect } from "vitest"
import { buildRankingPrompt, nextMondayISO } from "../tavily-trending-scan.js"

describe("tavily-trending-scan helpers", () => {
  it("buildRankingPrompt embeds Tavily results as numbered entries", () => {
    const prompt = buildRankingPrompt([
      { title: "Creatine in youth athletes", url: "https://a.example", content: "snippet A" },
      { title: "Sleep debt and recovery", url: "https://b.example", content: "snippet B" },
    ])
    expect(prompt).toContain("Creatine in youth athletes")
    expect(prompt).toContain("https://a.example")
    expect(prompt).toContain("snippet A")
    expect(prompt).toContain("Sleep debt and recovery")
    expect(prompt).toMatch(/5\s*[-–]\s*10\s+topics?/i)
  })

  it("buildRankingPrompt handles empty input gracefully", () => {
    const prompt = buildRankingPrompt([])
    expect(prompt.toLowerCase()).toContain("no search results")
  })

  it("nextMondayISO returns a Monday (day-of-week = 1) in YYYY-MM-DD format", () => {
    const iso = nextMondayISO(new Date("2026-04-22T00:00:00.000Z")) // Wednesday
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const d = new Date(iso + "T00:00:00.000Z")
    expect(d.getUTCDay()).toBe(1) // Monday
    // And it should be AFTER the input date
    expect(d.getTime()).toBeGreaterThan(new Date("2026-04-22T00:00:00.000Z").getTime())
  })
})
