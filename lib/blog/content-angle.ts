// lib/blog/content-angle.ts
// Cheap Claude call that converts a Tavily summary into a "mainstream framing
// vs DJP counter-frame" pair. Injected into the system prompt as a #
// CONTENT ANGLE block so the generator leads with the contrarian take
// instead of writing generic informational content.
//
// Falls back to null on any error — never blocks generation. The handler
// skips the # CONTENT ANGLE block when input.content_angle is missing.

const SYSTEM_PROMPT = `You are reading a topic summary and producing a contrarian content angle for a strength & conditioning coaching blog.

Output two single-line strings:
1. "mainstream": One sentence summarizing how mainstream fitness content typically frames this topic. Be specific about what most articles claim.
2. "counterframe": One sentence stating where Darren Paul's view differs — the contrarian or under-discussed angle. Should be defensible from coaching evidence, not edgy for its own sake.

Examples:
- Topic: "Static stretching before a workout"
  → mainstream: "Most fitness blogs say static stretching warms up muscles and prevents injury."
    counterframe: "Static stretching before lifting reduces force output for up to 30 minutes — dynamic warm-ups are better."

- Topic: "Soreness as a sign of a good workout"
  → mainstream: "Articles equate post-workout soreness with effective training."
    counterframe: "Chronic soreness is a sign of insufficient recovery, not progress — repeated bouts produce less soreness even when stimulus is the same."

Output ONLY a JSON object: { "mainstream": "<sentence>", "counterframe": "<sentence>" }. Both fields must be 60-200 chars each.`

export interface ContentAngle {
  mainstream: string
  counterframe: string
}

export async function extractContentAngle(input: {
  title: string
  summary?: string
}): Promise<ContentAngle | null> {
  if (!input.title) return null

  const { default: Anthropic } = await import("@anthropic-ai/sdk")
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn("[content-angle] ANTHROPIC_API_KEY missing, returning null")
    return null
  }

  const client = new Anthropic({ apiKey })
  const userMessage = [
    `Topic title: ${input.title}`,
    input.summary ? `Topic summary: ${input.summary}` : "",
    "",
    "Return the JSON object now.",
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    })
    const block = response.content.find((b) => b.type === "text")
    if (!block || block.type !== "text") return null
    const match = block.text.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as Partial<ContentAngle>
    if (
      typeof parsed.mainstream === "string" &&
      typeof parsed.counterframe === "string" &&
      parsed.mainstream.length >= 20 &&
      parsed.counterframe.length >= 20
    ) {
      return { mainstream: parsed.mainstream, counterframe: parsed.counterframe }
    }
    return null
  } catch (err) {
    console.warn(`[content-angle] Claude call failed: ${(err as Error).message}`)
    return null
  }
}
