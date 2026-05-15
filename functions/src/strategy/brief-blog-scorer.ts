// functions/src/strategy/brief-blog-scorer.ts
// Pure helper: scores a blog post against a strategy brief.
//
// Used by the social agent's strategist step. Returns -1 if the blog matches
// any dont_do phrase (case-insensitive, word-boundary). Otherwise sums
// theme/keyword/hook weights. Pure function — no Supabase, no IO — so it's
// trivially testable.

export interface BriefScoringContext {
  themes: Array<{ tag: string; weight: number }>
  keywords_to_chase: string[]
  hooks_to_test: string[]
  dont_do: string[]
}

export interface ScoreableBlog {
  title: string
  content: string | null
  excerpt?: string | null
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Word-boundary case-insensitive substring check. */
function wordBoundaryMatch(haystack: string, phrase: string): boolean {
  if (phrase.length === 0) return false
  const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "i")
  return re.test(haystack)
}

export const DONT_DO_REJECTED = -1

export function scoreBlogVsBrief(
  blog: ScoreableBlog,
  brief: BriefScoringContext,
): number {
  const haystack = `${blog.title} ${blog.excerpt ?? ""} ${blog.content ?? ""}`
  for (const phrase of brief.dont_do ?? []) {
    if (wordBoundaryMatch(haystack, phrase)) return DONT_DO_REJECTED
  }
  const lowered = haystack.toLowerCase()
  let score = 0
  for (const t of brief.themes) {
    const tag = t.tag.toLowerCase().replace(/-/g, " ")
    if (lowered.includes(tag)) score += 2 * (t.weight ?? 1)
  }
  for (const kw of brief.keywords_to_chase) {
    if (lowered.includes(kw.toLowerCase())) score += 3
  }
  for (const hook of brief.hooks_to_test) {
    if (lowered.includes(hook.toLowerCase().slice(0, 32))) score += 1
  }
  return score
}
