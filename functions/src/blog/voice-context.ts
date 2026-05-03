// functions/src/blog/voice-context.ts
// Loads brand voice + blog structure prompts from prompt_templates.
// Falls back to in-code skeletons if rows are missing or DB call fails.
//
// Pattern mirrors functions/src/voice-drift-monitor.ts but loads two rows
// (voice_profile + blog_generation) in a single round-trip.

import type { SupabaseClient } from "@supabase/supabase-js"

export type Register = "formal" | "casual"

export interface SeoTarget {
  primary_keyword: string
  secondary_keywords: string[]
  search_intent: "informational" | "commercial" | "transactional" | null
}

export interface BlogFewShotExample {
  prompt?: string
  title: string
  excerpt: string
  content_excerpt?: string
}

export interface VoiceContext {
  voiceProfile: string
  blogStructure: string
  fewShots: BlogFewShotExample[]
  usedFallback: { voice: boolean; structure: boolean }
}

export interface ComposeArgs {
  voiceProfile: string
  blogStructure: string
  programsBlock: string
  register: Register
  seoTarget?: SeoTarget
}

// ─── Fallbacks ──────────────────────────────────────────────────────────────
// Used only when the DB rows are missing. Coach should edit the live rows
// rather than these constants.

export const FALLBACK_VOICE_PROFILE = `You are Darren Paul, a strength & conditioning coach with 20+ years of experience working with athletes at every level. You write the way you coach: direct, evidence-based, and unwilling to traffic in fads.

Voice traits:
- Speak in second person ("you").
- Reference training principles by name (specificity, progressive overload, supercompensation).
- One contrarian take per post.
- Numbers > adjectives. "3x bodyweight squats" beats "very strong squats".
- No empty hype words: "amazing", "incredible", "game-changer", "the secret to". Cut them.`

export const FALLBACK_BLOG_STRUCTURE = `# OUTPUT SCHEMA
Output a JSON object: { title, slug, excerpt, content (HTML), category, tags, meta_description }.

# HTML RULES
Allowed tags: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <blockquote>, <strong>, <em>, <u>, <a href="...">.
No <h1>, no inline styles, no <br>.

# LENGTH
short ~500 words, medium ~1000, long ~1500. Categories: Performance | Recovery | Coaching | Youth Development.

# SOURCING
Cite 3-4 inline <a> references using ONLY URLs you were given. Never fabricate DOI/PubMed URLs. End with a References section.

Output ONLY the JSON object, no preamble.`

// ─── Few-shot parser ────────────────────────────────────────────────────────
// The few_shot_examples column is shared across categories. social_caption
// rows have a different shape — we filter to entries that look like blog
// examples (have title + excerpt).

export function parseBlogFewShots(raw: unknown): BlogFewShotExample[] {
  if (!Array.isArray(raw)) return []
  const result: BlogFewShotExample[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    if (typeof row.title !== "string" || typeof row.excerpt !== "string") continue
    result.push({
      title: row.title,
      excerpt: row.excerpt,
      prompt: typeof row.prompt === "string" ? row.prompt : undefined,
      content_excerpt: typeof row.content_excerpt === "string" ? row.content_excerpt : undefined,
    })
  }
  return result
}

// ─── DB load ────────────────────────────────────────────────────────────────

interface PromptTemplateRow {
  category: string
  prompt: unknown
  few_shot_examples: unknown
}

export async function loadVoiceContext(supabase: SupabaseClient): Promise<VoiceContext> {
  const { data, error } = await supabase
    .from("prompt_templates")
    .select("category, prompt, few_shot_examples")
    .in("category", ["voice_profile", "blog_generation"])

  if (error || !data) {
    if (error) console.warn(`[voice-context] prompt_templates fetch failed: ${error.message}`)
    return {
      voiceProfile: FALLBACK_VOICE_PROFILE,
      blogStructure: FALLBACK_BLOG_STRUCTURE,
      fewShots: [],
      usedFallback: { voice: true, structure: true },
    }
  }

  const rows = data as PromptTemplateRow[]
  const voiceRow = rows.find((r) => r.category === "voice_profile")
  const structureRow = rows.find((r) => r.category === "blog_generation")

  const voiceProfile =
    voiceRow && typeof voiceRow.prompt === "string" && voiceRow.prompt.length > 0
      ? voiceRow.prompt
      : FALLBACK_VOICE_PROFILE
  const blogStructure =
    structureRow && typeof structureRow.prompt === "string" && structureRow.prompt.length > 0
      ? structureRow.prompt
      : FALLBACK_BLOG_STRUCTURE

  // Few-shots come from the blog_generation row only.
  const fewShots = parseBlogFewShots(structureRow?.few_shot_examples)

  return {
    voiceProfile,
    blogStructure,
    fewShots,
    usedFallback: {
      voice: voiceProfile === FALLBACK_VOICE_PROFILE,
      structure: blogStructure === FALLBACK_BLOG_STRUCTURE,
    },
  }
}

// ─── System prompt composer ─────────────────────────────────────────────────

function formatSeoTargetBlock(target: SeoTarget | undefined): string {
  if (!target || !target.primary_keyword) return ""
  const lines = [
    "# SEO TARGET",
    `Primary keyword: ${target.primary_keyword}`,
  ]
  if (target.secondary_keywords.length > 0) {
    lines.push(`Secondary keywords: ${target.secondary_keywords.join(", ")}`)
  }
  if (target.search_intent) {
    lines.push(`Search intent: ${target.search_intent}`)
  }
  lines.push("")
  lines.push("Rules:")
  lines.push("- Primary keyword MUST appear in: title (within first 60 chars), the first 100 words of intro, exactly one h2, and the conclusion.")
  lines.push("- Secondary keywords distributed across body sections — no stuffing.")
  lines.push("- Title formula: pick numbered list, how-to, vs/comparison, year-stamped, or contrarian-take based on intent.")
  lines.push("- Title length: 50-60 chars.")
  lines.push("- Excerpt length: 140-180 chars and MUST include the primary keyword.")
  return lines.join("\n")
}

export function composeBlogSystemPrompt(args: ComposeArgs): string {
  const registerBlock =
    args.register === "formal"
      ? "# REGISTER\nFormal. Tighten contractions. Lean on data and citations. Fewer first-person interjections."
      : "# REGISTER\nCasual. Use contractions. Conversational asides allowed. Address the reader directly. Default."

  const seoBlock = formatSeoTargetBlock(args.seoTarget)

  const sections: string[] = [
    "# VOICE",
    args.voiceProfile,
    "",
    args.programsBlock,
  ]
  if (seoBlock) {
    sections.push("", seoBlock)
  }
  sections.push("", registerBlock, "", args.blogStructure)
  return sections.join("\n")
}

// ─── Few-shot formatter for user message ────────────────────────────────────
// Few-shots are appended to the user message (not to system prompt) so they
// show up as context, not as instructions. callAgent doesn't accept extra
// turns, so this is the simplest path that doesn't require touching the
// Anthropic wrapper.

export function formatFewShotsForUserMessage(examples: BlogFewShotExample[]): string {
  if (examples.length === 0) return ""
  const lines: string[] = ["", "# REFERENCE EXAMPLES (output style only — do not copy content)"]
  examples.slice(0, 3).forEach((ex, idx) => {
    lines.push("")
    lines.push(`[Example ${idx + 1}]`)
    if (ex.prompt) lines.push(`Original prompt: ${ex.prompt}`)
    lines.push(`Title: ${ex.title}`)
    lines.push(`Excerpt: ${ex.excerpt}`)
    if (ex.content_excerpt) {
      lines.push(`Content sample: ${ex.content_excerpt.slice(0, 500)}`)
    }
  })
  return lines.join("\n")
}
