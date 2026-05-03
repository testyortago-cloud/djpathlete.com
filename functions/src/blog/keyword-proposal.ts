// functions/src/blog/keyword-proposal.ts
// Cheap Claude call (Sonnet, ~50 tokens out) that extracts a 2-6 word
// search-intent noun phrase from a topic title + optional Tavily summary.
// Falls back to a deterministic title-stripping function on any error.

import { z } from "zod"
import { callAgent, MODEL_SONNET } from "../ai/anthropic.js"

const SYSTEM_PROMPT = `You extract the primary search keyword from a blog topic. Return a 2-6 word noun phrase that someone would type into Google to find this content. Lowercase, no punctuation, no quotes. Skip stopwords like "the", "how to", "best".

Examples:
- Title: "How young pitchers can throw harder safely" → "youth pitching velocity"
- Title: "The 6-week return-to-play protocol after ACL surgery" → "acl return to play protocol"
- Title: "Why progressive overload still works in 2026" → "progressive overload training"

Output ONLY a JSON object: { "primary_keyword": "<the phrase>" }.`

const proposalSchema = z.object({
  primary_keyword: z.string().max(120),
})

const STOPWORD_PREFIXES = ["the ", "a ", "an ", "how to "]

/**
 * Title-derived fallback: strip punctuation, lowercase, drop a common
 * stopword prefix, clamp to 6 words. Deterministic — runs on any title
 * even when Claude is unavailable.
 */
export function fallbackKeywordFromTitle(title: string): string {
  if (!title) return ""
  let t = title.toLowerCase().replace(/[^\w\s]/g, "").trim()
  for (const prefix of STOPWORD_PREFIXES) {
    if (t.startsWith(prefix) && t.split(/\s+/).length > prefix.trim().split(/\s+/).length) {
      t = t.slice(prefix.length).trim()
      break
    }
  }
  return t.split(/\s+/).slice(0, 6).join(" ")
}

export interface ProposeKeywordInput {
  title: string
  summary?: string
}

export async function proposePrimaryKeyword(input: ProposeKeywordInput): Promise<string> {
  const userMessage = [
    `Title: ${input.title}`,
    input.summary ? `Summary: ${input.summary}` : "",
    "",
    "Return the JSON object now.",
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const result = await callAgent(SYSTEM_PROMPT, userMessage, proposalSchema, {
      model: MODEL_SONNET,
      maxTokens: 200,
    })
    const proposed = result.content.primary_keyword.trim()
    if (proposed.length > 0) return proposed
    return fallbackKeywordFromTitle(input.title)
  } catch (err) {
    console.warn(
      `[keyword-proposal] Claude call failed, falling back to title strip: ${(err as Error).message}`,
    )
    return fallbackKeywordFromTitle(input.title)
  }
}
