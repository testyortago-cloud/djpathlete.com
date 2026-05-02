import Anthropic from "@anthropic-ai/sdk"

const MODEL = "claude-sonnet-4-6"
const ALT_TEXT_MAX_CHARS = 180

const SYSTEM_PROMPT = `You are writing accessibility alt-text for an image on a fitness/coaching blog. Output ONLY a JSON object with this shape:
{ "alt_text": "<one concrete sentence, <= 125 chars, describes what a blind reader needs to know>" }

Rules:
- Be specific. Use fitness terminology when an exercise or piece of equipment is identifiable.
- No filler ("photo of", "image shows").
- If the image is unusable, return alt_text="".
- Output nothing except the JSON object — no preamble, no markdown fence.`

export async function generateAltText(buffer: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type:
                (mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif") ?? "image/webp",
              data: buffer.toString("base64"),
            },
          },
          { type: "text", text: "Generate alt text for this image per the system instructions." },
        ],
      },
    ],
  })

  const textBlock = response.content.find((b: { type: string }) => b.type === "text") as
    | { type: "text"; text: string }
    | undefined
  if (!textBlock) return ""

  const cleaned = textBlock.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
  try {
    const parsed = JSON.parse(cleaned) as { alt_text?: unknown }
    if (typeof parsed.alt_text !== "string") return ""
    return parsed.alt_text.slice(0, ALT_TEXT_MAX_CHARS)
  } catch {
    return ""
  }
}
