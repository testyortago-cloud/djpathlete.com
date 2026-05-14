// functions/src/strategy/brief-blog-scorer.ts
// Pure helper: scores a blog post against a strategy brief's themes/keywords/hooks.
//
// Used by the social agent's strategist step to pick the published blog post
// whose title/excerpt/content best aligns with the current week's approved
// strategy brief. Pure function — no Supabase, no IO — so it's trivially
// testable.

export interface BriefScoringContext {
  themes: Array<{ tag: string; weight: number }>
  keywords_to_chase: string[]
  hooks_to_test: string[]
}

export interface ScoreableBlog {
  title: string
  content: string | null
  excerpt?: string | null
}

export function scoreBlogVsBrief(
  blog: ScoreableBlog,
  brief: BriefScoringContext,
): number {
  const haystack = `${blog.title} ${blog.excerpt ?? ""} ${blog.content ?? ""}`.toLowerCase()
  let score = 0
  for (const t of brief.themes) {
    const tag = t.tag.toLowerCase().replace(/-/g, " ")
    if (haystack.includes(tag)) score += 2 * (t.weight ?? 1)
  }
  for (const kw of brief.keywords_to_chase) {
    if (haystack.includes(kw.toLowerCase())) score += 3
  }
  for (const hook of brief.hooks_to_test) {
    if (haystack.includes(hook.toLowerCase().slice(0, 32))) score += 1
  }
  return score
}
