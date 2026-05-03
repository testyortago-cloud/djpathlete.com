import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./anthropic.js"

export const imagePromptsSchema = z.object({
  hero_prompt: z.string().min(10).max(500),
  inline_prompts: z
    .array(
      z.object({
        section_h2: z.string().min(1).max(200),
        prompt: z.string().min(10).max(500),
      }),
    )
    .max(5),
})

export type ImagePromptsResult = z.infer<typeof imagePromptsSchema>

const SYSTEM_PROMPT = `You write image prompts for a science-based athletic-performance blog by Darren Paul (DJP Athlete). Your prompts are sent to a text-to-image model.

Style requirements (apply to every prompt):
- Photorealistic. Real people, real gyms, real outdoor settings. No illustrations, no 3D renders, no AI-art tropes.
- No text overlays. No logos. No watermarks. No company branding.
- Performance-coaching aesthetic — strength training, sprinting, jumping, mobility, recovery, sport-specific drills. Adults unless the post is about youth development.
- Lighting: natural daylight, gym fluorescent, or stadium light. No moody fantasy lighting.
- Composition: medium-wide. Subject is identifiable but not portrait-style.

Output JSON shape (strict):
{
  "hero_prompt": "<single prompt for the post's cover image, ~30-50 words, premium image>",
  "inline_prompts": [
    { "section_h2": "<exact h2 text>", "prompt": "<prompt, ~25-40 words>" },
    ...
  ]
}

Rules:
- The hero prompt should evoke the post's overall theme.
- Each inline prompt must reference the specific section's content, not just the post topic.
- Use the EXACT h2 text supplied in the user message — do not paraphrase or generate new section names.
- If fewer qualifying sections are provided, emit fewer inline_prompts. Never invent sections.

Return ONLY the JSON object, no preamble.`

export interface ExtractImagePromptsInput {
  title: string
  content: string
  category: string
  qualifyingSections: string[]
}

export async function extractImagePrompts(input: ExtractImagePromptsInput): Promise<ImagePromptsResult> {
  const sectionList = input.qualifyingSections.length
    ? input.qualifyingSections.map((s) => `- ${s}`).join("\n")
    : "(none — emit empty inline_prompts array)"

  const userMessage = [
    `# POST`,
    `Title: ${input.title}`,
    `Category: ${input.category}`,
    "",
    `# QUALIFYING SECTIONS (use these exact strings as section_h2)`,
    sectionList,
    "",
    `# CONTENT (first 4000 chars)`,
    input.content.slice(0, 4000),
    "",
    `# INSTRUCTIONS`,
    `Generate one hero_prompt and one inline prompt per qualifying section. Use the exact h2 strings above for section_h2.`,
  ].join("\n")

  const result = await callAgent(SYSTEM_PROMPT, userMessage, imagePromptsSchema, {
    model: MODEL_SONNET,
    maxTokens: 2000,
  })

  // Filter inline_prompts to only those whose section_h2 matches a qualifying section.
  // This guards against the model hallucinating section names despite instructions.
  const allowed = new Set(input.qualifyingSections)
  const filteredInline = result.content.inline_prompts.filter((p) => allowed.has(p.section_h2))

  return {
    hero_prompt: result.content.hero_prompt,
    inline_prompts: filteredInline,
  }
}
