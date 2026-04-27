import { describe, it, expect } from "vitest"
import {
  buildRankingPrompt,
  EXCLUDED_DOMAINS,
  nextMondayISO,
  TRENDING_QUERIES,
} from "../tavily-trending-scan.js"

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

  it("buildRankingPrompt targets both coaching and sport science audiences", () => {
    const prompt = buildRankingPrompt([
      { title: "Sample", url: "https://x.example", content: "x" },
    ]).toLowerCase()
    expect(prompt).toContain("strength & conditioning")
    expect(prompt).toContain("sport science")
    expect(prompt).toContain("performance")
  })

  it("buildRankingPrompt enforces science-rigor inclusion criteria", () => {
    const prompt = buildRankingPrompt([
      { title: "Sample", url: "https://x.example", content: "x" },
    ]).toLowerCase()
    // Must require evidence-grade sourcing
    expect(prompt).toMatch(/peer-reviewed|meta-analysis|applied sport-science/)
    // Must require a quantifiable mechanism / metric
    expect(prompt).toMatch(/mechanism|methodology|quantifiable/)
    // Must explicitly reject gen-pop / clickbait content
    expect(prompt).toMatch(/exclude/)
    expect(prompt).toMatch(/weight loss|aesthetics|fitness fads|clickbait/)
  })

  it("buildRankingPrompt handles empty input gracefully", () => {
    const prompt = buildRankingPrompt([])
    expect(prompt.toLowerCase()).toContain("no search results")
  })

  it("TRENDING_QUERIES covers coaching, sport science, performance, and youth development", () => {
    expect(TRENDING_QUERIES.length).toBeGreaterThanOrEqual(3)
    const joined = TRENDING_QUERIES.join(" | ").toLowerCase()
    expect(joined).toMatch(/strength|conditioning|coach/)
    expect(joined).toContain("sport science")
    expect(joined).toContain("performance")
    expect(joined).toContain("youth")
  })

  it("TRENDING_QUERIES use science-rigor vocabulary, not generalist fitness terms", () => {
    const joined = TRENDING_QUERIES.join(" | ").toLowerCase()
    // At least one query must signal evidence-grade sourcing
    expect(joined).toMatch(/peer-reviewed|meta-analysis|research/)
    // At least one query must reference a modern S&C methodology
    expect(joined).toMatch(/velocity-based|force-velocity|hrv|workload|rate of force|plyometrics|ltad/)
    // No generalist fitness vocabulary in the query set
    expect(joined).not.toMatch(/weight loss|fat loss|six-pack|beginner workout|toning/)
  })

  it("EXCLUDED_DOMAINS hard-filters generalist fitness and lifestyle sites", () => {
    expect(EXCLUDED_DOMAINS.length).toBeGreaterThan(0)
    expect(EXCLUDED_DOMAINS).toContain("menshealth.com")
    expect(EXCLUDED_DOMAINS).toContain("healthline.com")
    expect(EXCLUDED_DOMAINS).toContain("bodybuilding.com")
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
