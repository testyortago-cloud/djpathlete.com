// lib/ai/quote-extraction.ts
// Takes a full video transcript and returns N short, punchy quotes suitable
// for quote-card carousel slides. Uses Claude Sonnet 4.6 with structured JSON
// output. Gracefully returns [] on any parsing/connectivity issue so the
// caller's orchestration can decide how to surface the failure.

import Anthropic from "@anthropic-ai/sdk"

const MODEL = "claude-sonnet-4-6"
const MAX_QUOTE_LENGTH = 140

const SYSTEM_PROMPT = `You are a social-media editor pulling quotable lines from a video transcript for a fitness/athletic coaching audience. Return ONLY a JSON array of strings — no preamble, no markdown fence, nothing else.

Each quote:
- Stands alone without the transcript context
- Is ≤ 140 characters (counting spaces, including punctuation)
- Is a punchy hook, bold claim, or memorable insight — NOT a mundane sentence
- Uses concrete language, avoids filler ("well, you know", "so basically")
- Uses the speaker's voice — first person, declarative, present tense when possible
- No hashtags, no emoji, no quote marks

Order: strongest quote first. If the transcript doesn't contain N strong quotes, return fewer — do not invent filler.`

export async function extractQuotesFromTranscript(
  transcript: string,
  count: number,
): Promise<string[]> {
  if (!transcript || transcript.trim().length === 0) return []

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
  const client = new Anthropic({ apiKey })

  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract up to ${count} of the strongest quotable lines from this transcript.\n\nTranscript:\n${transcript}`,
            },
          ],
        },
      ],
    })
  } catch {
    return []
  }

  const textBlock = response.content.find((b) => b.type === "text")
  if (!textBlock || textBlock.type !== "text") return []

  try {
    const cleaned = textBlock.text
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim()
    const parsed = JSON.parse(cleaned) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((s) => s.trim().slice(0, MAX_QUOTE_LENGTH))
      .slice(0, count)
  } catch {
    return []
  }
}
