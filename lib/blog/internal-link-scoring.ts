// lib/blog/internal-link-scoring.ts
// Tag-overlap heuristic for ranking blog posts as link candidates.
// Mirrors the function of the same name in functions/src/seo-enhance.ts —
// duplicated here because crossing the workspace boundary into functions/
// from the Next.js app is awkward and the function is small + pure.

export interface BlogSummary {
  id: string
  title: string
  slug: string
  tags: string[]
  category: string | null
}

export interface InternalLinkScore {
  blog_post_id: string
  title: string
  slug: string
  overlap_score: number
  reason: string
}

/**
 * Scores candidates by overlap with target. Score = (shared tags * 2) +
 * (1 if same category, 0 otherwise). Returns top 5 with score >= 1, sorted
 * descending. The target itself is always excluded.
 */
export function scoreInternalLinks(target: BlogSummary, candidates: BlogSummary[]): InternalLinkScore[] {
  const targetTags = new Set(target.tags ?? [])
  const results: InternalLinkScore[] = []

  for (const c of candidates) {
    if (c.id === target.id) continue
    const shared = (c.tags ?? []).filter((t) => targetTags.has(t))
    const tagScore = shared.length * 2
    const categoryMatch = target.category && target.category === c.category ? 1 : 0
    const score = tagScore + categoryMatch
    if (score < 1) continue

    const parts: string[] = []
    if (shared.length > 0) parts.push(`Shares tags: ${shared.join(", ")}`)
    if (categoryMatch) parts.push("same category")
    results.push({
      blog_post_id: c.id,
      title: c.title,
      slug: c.slug,
      overlap_score: score,
      reason: parts.join(" · "),
    })
  }

  results.sort((a, b) => b.overlap_score - a.overlap_score)
  return results.slice(0, 5)
}
