import { describe, expect, it } from "vitest"
import { scoreInternalLinks } from "@/lib/blog/internal-link-scoring"

describe("scoreInternalLinks", () => {
  const target = {
    id: "tgt",
    title: "Target",
    slug: "target",
    tags: ["deadlift", "strength", "form"],
    category: "Performance",
  }

  it("scores candidates by shared tags * 2 + category match", () => {
    const candidates = [
      // 2 shared tags + same category = 5
      { id: "a", title: "A", slug: "a", tags: ["deadlift", "strength"], category: "Performance" },
      // 1 shared tag + different category = 2
      { id: "b", title: "B", slug: "b", tags: ["deadlift", "recovery"], category: "Recovery" },
      // 0 shared, same category = 1
      { id: "c", title: "C", slug: "c", tags: ["mobility"], category: "Performance" },
      // 0 shared, different category = 0 (excluded by score < 1)
      { id: "d", title: "D", slug: "d", tags: ["unrelated"], category: "Recovery" },
    ]
    const out = scoreInternalLinks(target, candidates)
    expect(out.map((s) => s.blog_post_id)).toEqual(["a", "b", "c"])
    expect(out[0].overlap_score).toBe(5)
    expect(out[1].overlap_score).toBe(2)
    expect(out[2].overlap_score).toBe(1)
  })

  it("excludes the target itself from results", () => {
    const out = scoreInternalLinks(target, [
      { id: "tgt", title: "Target", slug: "target", tags: ["deadlift", "strength", "form"], category: "Performance" },
      { id: "x", title: "X", slug: "x", tags: ["deadlift"], category: "Performance" },
    ])
    expect(out.map((s) => s.blog_post_id)).toEqual(["x"])
  })

  it("caps results at 5", () => {
    const candidates = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      title: `C${i}`,
      slug: `c${i}`,
      tags: ["deadlift"],
      category: "Performance",
    }))
    expect(scoreInternalLinks(target, candidates)).toHaveLength(5)
  })

  it("returns the reason field populated", () => {
    const out = scoreInternalLinks(target, [
      { id: "a", title: "A", slug: "a", tags: ["deadlift", "form"], category: "Performance" },
    ])
    expect(out[0].reason).toContain("Shares tags: deadlift, form")
    expect(out[0].reason).toContain("same category")
  })

  it("handles candidates with null tags or category gracefully", () => {
    const out = scoreInternalLinks(target, [
      { id: "a", title: "A", slug: "a", tags: [], category: null },
    ])
    expect(out).toEqual([])
  })
})
