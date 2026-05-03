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

// Brand treatment fed into every prompt so heroes have a consistent DJP look
// instead of looking like a different stock-photo studio per post.
//
// Future upgrade: a LoRA fine-tune of fal's flux model on DJP photography
// would lock the look harder than text instructions can. Documented for when
// publishing volume justifies the training run. Until then, this string is
// the cheap version.
export const BRAND_TREATMENT = `
DJP visual treatment (apply to every prompt, with extra emphasis on the hero):
- Slightly desaturated color, warm-leaning skin tones. NOT punchy oversaturated stock.
- Natural daylight or true gym/stadium light only. No HDR fakery, no moody-fantasy lighting, no flash.
- Shallow depth of field — subject crisp, background gently blurred. Helps it read as documentary, not advertising.
- Behind-the-scenes coaching aesthetic. Show coaching context (a coach near the athlete, equipment in frame, real flooring) when sensible — not influencer poses.
- Realistic athletic body types. No glossy fitness-model archetypes.
- Frame the subject doing the thing, mid-action when possible. No static smiles into the camera.
- Negative space on one side of the frame for hero shots so it composes well as a 1200×630 OG card.`.trim()

const SYSTEM_PROMPT = `You write image prompts for a science-based athletic-performance blog by Darren Paul (DJP Athlete). Your prompts are sent to a text-to-image model.

Style requirements (apply to every prompt):
- Photorealistic. Real people, real gyms, real outdoor settings. No illustrations, no 3D renders, no AI-art tropes.
- No text overlays. No logos. No watermarks. No company branding.
- Performance-coaching aesthetic — strength training, sprinting, jumping, mobility, recovery, sport-specific drills. Adults unless the post is about youth development.
- Composition: medium-wide. Subject is identifiable but not portrait-style.

${BRAND_TREATMENT}

Output JSON shape (strict):
{
  "hero_prompt": "<single prompt for the post's cover image, ~30-50 words, premium image>",
  "inline_prompts": [
    { "section_h2": "<exact h2 text>", "prompt": "<prompt, ~25-40 words>" },
    ...
  ]
}

Rules:
- The hero prompt should evoke the post's overall theme AND visibly carry the DJP visual treatment above (desaturation, shallow DOF, documentary feel).
- Each inline prompt must reference the specific section's content, not just the post topic. Inline prompts can lean lighter on the brand treatment than the hero (the hero is the OG card; inline images don't need to match it perfectly).
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
