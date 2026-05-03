// functions/src/blog/internal-link-anchors.ts
// One Claude Sonnet call (~80 tokens out) that picks an anchor phrase + h2
// section for each internal-link suggestion. Used by seo-enhance to splice
// real <a href="/blog/{slug}"> tags into the post body.
//
// Falls back to an empty array on any error — never blocks SEO enhancement.

import { z } from "zod"
import { callAgent, MODEL_SONNET } from "../ai/anthropic.js"

const MAX_ANCHORS = 3
const CONTENT_PREVIEW_CHARS = 4000

export interface InternalLinkSuggestion {
  slug: string
  title: string
}

export interface InternalLinkAnchor {
  slug: string
  anchor_text: string
  section_h2: string
}

const anchorsSchema = z.object({
  anchors: z
    .array(
      z.object({
        slug: z.string().min(1).max(200),
        anchor_text: z.string().min(2).max(60),
        section_h2: z.string().min(2).max(200),
      }),
    )
    .max(20),
})

const SYSTEM_PROMPT = `You pick internal-link anchor phrases for a fitness/coaching blog post. For each related-post suggestion, choose:
1. A 2-5 word phrase from the TARGET post's body that is naturally related to the suggested post's topic. The phrase MUST appear verbatim in the body.
2. The h2 section (use the EXACT heading text) where that phrase appears.

Rules:
- Pick at most 3 suggestions total — the most natural fits.
- Anchor phrases should read naturally as link text — not "click here" or generic words like "this".
- If a suggestion can't be anchored well anywhere in the body, skip it.
- Use the exact h2 heading text as it appears in the body.

Output ONLY a JSON object: { "anchors": [ { "slug": "...", "anchor_text": "...", "section_h2": "..." }, ... ] }.`

export interface GetAnchorsInput {
  targetPost: { title: string; content: string }
  suggestions: InternalLinkSuggestion[]
}

export async function getAnchorsForSuggestions(input: GetAnchorsInput): Promise<InternalLinkAnchor[]> {
  if (input.suggestions.length === 0) return []

  const userMessage = [
    `# TARGET POST`,
    `Title: ${input.targetPost.title}`,
    "",
    `Body (first ${CONTENT_PREVIEW_CHARS} chars):`,
    input.targetPost.content.slice(0, CONTENT_PREVIEW_CHARS),
    "",
    `# SUGGESTED RELATED POSTS`,
    ...input.suggestions.map((s, i) => `${i + 1}. slug="${s.slug}" — ${s.title}`),
    "",
    "Return the JSON object now.",
  ].join("\n")

  try {
    const result = await callAgent(SYSTEM_PROMPT, userMessage, anchorsSchema, {
      model: MODEL_SONNET,
      maxTokens: 600,
    })

    const allowedSlugs = new Set(input.suggestions.map((s) => s.slug))
    return result.content.anchors.filter((a) => allowedSlugs.has(a.slug)).slice(0, MAX_ANCHORS)
  } catch (err) {
    console.warn(`[internal-link-anchors] Claude call failed, returning empty array: ${(err as Error).message}`)
    return []
  }
}
