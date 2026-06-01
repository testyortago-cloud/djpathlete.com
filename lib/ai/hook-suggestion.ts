// lib/ai/hook-suggestion.ts
// Suggests a single short, punchy hook title from a video transcript, for the
// captioned-cut opening card. Uses Claude Haiku (fast + cheap — this is an
// interactive "Suggest" click, not a batch job) and returns plain text capped
// at 80 chars to match the render-worker's hook cap. Returns null on an empty
// transcript or any parsing/connectivity issue so the caller degrades to the
// manual input.

import Anthropic from "@anthropic-ai/sdk"

const MODEL = "claude-haiku-4-5-20251001"
// Mirror the render-worker's hook cap (functions/render-worker slice(0, 80)).
const MAX_HOOK_LENGTH = 80

const SYSTEM_PROMPT = `You write the opening hook title that gets burned onto the first frame of a short vertical fitness/athletic coaching reel. Given a video transcript, return ONE hook — and nothing else.

The hook:
- Is ≤ 80 characters (counting spaces)
- Is a scroll-stopping promise, bold claim, or curiosity gap drawn from the transcript's core idea
- Uses concrete, punchy language — no filler, no hedging
- Is Title Case or a short sentence; NO hashtags, NO emoji, NO surrounding quotes, NO markdown
- Reads as a headline a viewer would stop scrolling for

Return only the hook text on a single line — no preamble, no alternatives, no explanation.`

/**
 * Strip a model's reply down to a single clean hook line: drop any markdown
 * fence, surrounding quotes, and trailing whitespace; take the first line; cap
 * at 80 chars. Exported for unit testing.
 */
export function sanitizeHook(raw: string): string {
  const firstLine = raw
    .trim()
    .replace(/^```(?:\w+)?/i, "")
    .replace(/```$/, "")
    .trim()
    .split(/\r?\n/)[0]
    .trim()
    // Strip a single pair of surrounding quotes (straight or curly).
    .replace(/^["'“”‘’]+/, "")
    .replace(/["'“”‘’]+$/, "")
    .trim()
  return firstLine.slice(0, MAX_HOOK_LENGTH).trim()
}

export async function suggestHookFromTranscript(transcript: string): Promise<string | null> {
  if (!transcript || transcript.trim().length === 0) return null

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
  const client = new Anthropic({ apiKey })

  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Write the single best opening hook for a reel based on this transcript.\n\nTranscript:\n${transcript}`,
            },
          ],
        },
      ],
    })
  } catch {
    return null
  }

  const textBlock = response.content.find((b) => b.type === "text")
  if (!textBlock || textBlock.type !== "text") return null

  const hook = sanitizeHook(textBlock.text)
  return hook.length > 0 ? hook : null
}
