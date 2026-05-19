import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./anthropic.js"

export const imagePromptsSchema = z.object({
  hero_prompt: z.string().min(10).max(800),
  inline_prompts: z
    .array(
      z.object({
        section_h2: z.string().min(1).max(200),
        prompt: z.string().min(10).max(800),
      }),
    )
    .max(5),
})

export type ImagePromptsResult = z.infer<typeof imagePromptsSchema>

// Bump this when BRAND_TREATMENT or SYSTEM_PROMPT changes. Persisted per
// image so we can compare quality across prompt revisions later.
export const PROMPT_VERSION = "v2"

// Brand treatment fed into every prompt so heroes have a consistent DJP look
// instead of looking like a different stock-photo studio per post.
//
// Future upgrade: a LoRA fine-tune of fal's flux model on DJP photography
// would lock the look harder than text instructions can. Documented for when
// publishing volume justifies the training run. Until then, this string is
// the cheap version.
export const BRAND_TREATMENT = `
DJP visual treatment — apply to every prompt, harder on the hero:

CAMERA GRAMMAR (pick one combo per shot, vary across the post):
- Canon R5 + 35mm f/1.4, eye-level — for full-body action and gym-wide shots
- Sony A7IV + 50mm f/1.8, slight low angle — for portrait-leaning training shots
- Leica Q3 + 28mm fixed, hip level — for documentary, behind-the-scenes feel
- Canon R6 + 85mm f/1.8, three-quarter — for tight, intimate coaching moments

LIGHTING:
- Natural daylight through gym windows, or true overhead gym halide.
- Outdoor: golden hour or open shade. Never midday flat sun.
- Never: ring lights, beauty dishes, on-camera flash, neon rim light, lens flares.

COLOR + GRADE:
- Kodak Portra 400 color science, or Fuji Pro 400H. Muted, warm-leaning skin tones.
- Slightly lifted shadows, gentle highlight rolloff. Editorial, not Instagram.
- Avoid teal-and-orange Hollywood grade. Avoid HDR. Avoid clarity-slider grunge.

COMPOSITION:
- Subject crisp, background gently blurred (f/1.4–f/2.8 look).
- Rule of thirds. Hero shots: leave negative space on one side for 1200×630 OG framing.
- Mid-action, not posed. Show the athlete doing the thing.
- Behind-the-scenes coaching context when natural — coach in frame, equipment, real flooring.

REFERENCE EYE:
- Editorial sports documentary in the lineage of Walter Iooss Jr., Annie Leibovitz's
  athlete portraits, and Platon's tight character work. Honest, not glossy.

CASTING + DIVERSITY:
- Realistic athletic body types. NOT fitness-model archetypes, NOT bodybuilder physiques.
- Across a single post's images, show a varying mix of athletes by gender, ethnicity,
  and age unless the topic explicitly dictates a specific demographic (e.g. youth
  development → adolescents).
- Coaches in frame should read as practitioners, not models. Real clothes, real
  builds.

HARD ANTI-AI LIST (do NOT produce):
- No plastic skin, no porcelain doll faces, no airbrushed pores.
- No extra fingers, deformed hands, fused limbs, asymmetric eyes.
- No oversaturated colors, no HDR halos, no over-sharpened "AI photo" look.
- No symmetric front-facing studio portrait poses.
- No text, no logos, no watermarks, no jersey branding, no company labels.
- No CGI/3D-render aesthetic, no illustration, no painterly style.
- No fantasy lighting, no godrays, no lens flares, no bokeh balls.`.trim()

const SYSTEM_PROMPT = `You are a senior photo editor writing prompts for a text-to-image model. Your client is Darren Paul (DJP Athlete), a science-based athletic-performance blog. Output IS what gets generated — be specific, visual, and concrete.

PROMPT GRAMMAR (every prompt you write must follow this shape):
[SUBJECT — who, body type, clothing, mid-action verb], [SETTING — gym/track/field, time of day, weather], shot on [CAMERA + LENS + APERTURE from BRAND_TREATMENT], [LIGHTING], [COLOR GRADE], [COMPOSITION + NEGATIVE SPACE NOTE], in the editorial documentary style of [REFERENCE PHOTOGRAPHER from BRAND_TREATMENT].

EXAMPLES of the bar you are clearing:

Good hero (carries the brand treatment hard):
"Black female sprinter in worn training shorts and a faded crew neck, mid-stride accelerating out of blocks on a weathered outdoor track, early morning light, shot on Canon R5 with 35mm f/1.4, golden-hour side light, Kodak Portra 400 color science with muted warm skin tones, low-angle three-quarter view with negative space camera-left, editorial sports documentary in the lineage of Walter Iooss Jr."

Good inline:
"Hands gripping a knurled barbell mid-deadlift, chalk dust suspended in window light, shot on Canon R6 with 85mm f/1.8, natural overhead gym halide, Fuji Pro 400H grade, tight crop with shallow depth of field, behind-the-scenes coaching aesthetic."

Bad (do not write these):
"A fit athlete training hard in a gym." — vague, generic, no grammar.
"Beautiful muscular fitness model posing." — wrong casting language, posed.
"Photorealistic action shot of a runner." — meta-language, not visual.

${BRAND_TREATMENT}

OUTPUT (strict JSON, nothing else):
{
  "hero_prompt": "<single prompt for the cover image, 40-70 words, full grammar above>",
  "inline_prompts": [
    { "section_h2": "<exact h2 text>", "prompt": "<35-55 words, full grammar above>" }
  ]
}

RULES:
- The hero prompt MUST hit every slot of the grammar above. It's the OG card.
- Inline prompts MUST reference the specific section's content, not just the post topic. Reading the section's first paragraph tells you what to show.
- Use the EXACT h2 text supplied in the user message — do not paraphrase.
- If fewer qualifying sections are provided, emit fewer inline_prompts. Never invent sections.
- Vary camera/lens/lighting across the inline prompts so the post doesn't look like one shoot from one angle.
- Return ONLY the JSON object, no preamble, no markdown fence.`

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
