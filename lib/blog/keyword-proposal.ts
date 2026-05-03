// lib/blog/keyword-proposal.ts
// Next.js-side mirror of functions/src/blog/keyword-proposal.ts.
// Both call the same Claude API with the same system prompt; we duplicate
// because functions/ and lib/ are separate TS projects that can't share
// imports. Keep the system prompt identical between the two files.

const STOPWORD_PREFIXES = ["the ", "a ", "an ", "how to "]

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

const SYSTEM_PROMPT = `You extract the primary search keyword from a blog topic. Return a 2-6 word noun phrase that someone would type into Google to find this content. Lowercase, no punctuation, no quotes. Skip stopwords like "the", "how to", "best".

Examples:
- Title: "How young pitchers can throw harder safely" → "youth pitching velocity"
- Title: "The 6-week return-to-play protocol after ACL surgery" → "acl return to play protocol"
- Title: "Why progressive overload still works in 2026" → "progressive overload training"

Output ONLY a JSON object: { "primary_keyword": "<the phrase>" }.`

export async function proposePrimaryKeyword(input: { title: string; summary?: string }): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk")
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn("[keyword-proposal] ANTHROPIC_API_KEY missing, falling back to title strip")
    return fallbackKeywordFromTitle(input.title)
  }

  const client = new Anthropic({ apiKey })
  const userMessage = [
    `Title: ${input.title}`,
    input.summary ? `Summary: ${input.summary}` : "",
    "",
    "Return the JSON object now.",
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    })
    const block = response.content.find((b) => b.type === "text")
    if (!block || block.type !== "text") return fallbackKeywordFromTitle(input.title)
    const match = block.text.match(/\{[\s\S]*\}/)
    if (!match) return fallbackKeywordFromTitle(input.title)
    const parsed = JSON.parse(match[0]) as { primary_keyword?: string }
    const proposed = (parsed.primary_keyword ?? "").trim()
    if (proposed.length > 0) return proposed
    return fallbackKeywordFromTitle(input.title)
  } catch (err) {
    console.warn(`[keyword-proposal] Claude call failed, fallback: ${(err as Error).message}`)
    return fallbackKeywordFromTitle(input.title)
  }
}
