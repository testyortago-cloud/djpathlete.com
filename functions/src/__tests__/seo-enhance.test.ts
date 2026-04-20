import { describe, it, expect } from "vitest"
import { scoreInternalLinks, buildSeoPrompt } from "../seo-enhance.js"

describe("seo-enhance helpers", () => {
  const target = {
    id: "target",
    title: "Shoulder Rehab for Overhead Athletes",
    slug: "shoulder-rehab",
    tags: ["shoulder", "rehab", "throwing"],
    category: "Recovery" as const,
  }

  it("scoreInternalLinks returns empty for zero overlap", () => {
    const result = scoreInternalLinks(target, [
      { id: "a", title: "Leg day basics", slug: "leg-day", tags: ["legs", "squat"], category: "Performance" },
    ])
    expect(result).toEqual([])
  })

  it("scoreInternalLinks scores by tag overlap (x2) + category match (+1)", () => {
    const result = scoreInternalLinks(target, [
      { id: "a", title: "Rotator cuff drills", slug: "rotator-cuff", tags: ["shoulder", "rehab"], category: "Recovery" }, // 2*2 + 1 = 5
      { id: "b", title: "Return to throwing", slug: "return-throw", tags: ["throwing"], category: "Performance" },         // 1*2 + 0 = 2
      { id: "c", title: "No overlap post", slug: "unrelated", tags: ["nutrition"], category: "Performance" },              // 0
    ])
    expect(result).toHaveLength(2)
    expect(result[0].blog_post_id).toBe("a")
    expect(result[0].overlap_score).toBe(5)
    expect(result[1].blog_post_id).toBe("b")
    expect(result[1].overlap_score).toBe(2)
    expect(result[0].reason).toMatch(/shares tags: shoulder, rehab/i)
    expect(result[0].reason).toMatch(/same category/i)
  })

  it("scoreInternalLinks caps results at 5", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      title: `t${i}`,
      slug: `s${i}`,
      tags: ["shoulder"],
      category: "Recovery" as const,
    }))
    const result = scoreInternalLinks(target, candidates)
    expect(result).toHaveLength(5)
  })

  it("buildSeoPrompt includes title + excerpt + tags + category + truncated content", () => {
    const prompt = buildSeoPrompt({
      title: "Shoulder Rehab",
      excerpt: "A 6-12 week framework.",
      content: "x".repeat(10000),
      tags: ["shoulder", "rehab"],
      category: "Recovery",
    })
    expect(prompt).toContain("Shoulder Rehab")
    expect(prompt).toContain("6-12 week framework")
    expect(prompt).toContain("shoulder")
    expect(prompt).toContain("Recovery")
    // Content should be truncated to ~4000 chars
    expect(prompt.length).toBeLessThan(6500)
  })
})
