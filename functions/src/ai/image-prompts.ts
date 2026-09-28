import { z } from "zod"
import { callAgent, MODEL_SONNET_5 } from "./anthropic.js"
import { getStyleModuleForPost } from "./category-style-modules.js"

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
export const PROMPT_VERSION = "v3"

// Brand treatment fed into every prompt so heroes have a consistent DJP look
// instead of looking like a different stock-photo studio per post.
//
// Images are rendered by GPT Image 2.5 through OpenRouter (see
// blog-image-generation.ts); fal Flux was retired on 2026-09-23. This string is
// the only brand lock there is, so it carries the whole look.
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
- Inline prompts MUST reference the specific section's content, not just the post topic. The text under each section heading in the user message is the start of that section — it tells you what to show. A section about a phase of rehab shows that phase being worked on, not a generic lifestyle moment.
- Use the EXACT h2 text supplied in the user message — do not paraphrase.
- If fewer qualifying sections are provided, emit fewer inline_prompts. Never invent sections.
- Vary camera/lens/lighting across the inline prompts so the post doesn't look like one shoot from one angle.
- Return ONLY the JSON object, no preamble, no markdown fence.`

export interface ExtractImagePromptsInput {
  title: string
  content: string
  category: string
  tags?: readonly string[]
  qualifyingSections: string[]
}

const INTRO_CHARS = 1500
const SECTION_EXCERPT_CHARS = 700

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * The opening of each section, keyed by its h2 text EXACTLY as
 * findQualifyingSections reports it (tags replaced by spaces, trimmed, entities
 * left alone). The key is what the model must echo back as section_h2, and a
 * normalised key would silently lose the excerpt.
 *
 * The prompt writer used to get the first 4000 characters of raw HTML, which
 * on a long post ends two or three sections in. Every later section was
 * illustrated from its heading alone — "Nutrition Belongs Inside the Rehab
 * Protocol" became a stock shot of someone eating a salad — even though the
 * system prompt tells the writer to read each section's first paragraph.
 */
export function sectionExcerpts(html: string): { intro: string; sections: Map<string, string> } {
  const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/g
  const heads: { text: string; start: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = h2.exec(html)) !== null) {
    heads.push({
      text: m[1]
        .trim()
        .replace(/<[^>]+>/g, " ")
        .trim(),
      start: m.index,
      end: m.index + m[0].length,
    })
  }
  const intro = plainText(html.slice(0, heads[0]?.start ?? html.length)).slice(0, INTRO_CHARS)
  const sections = new Map<string, string>()
  heads.forEach((h, i) => {
    const body = html.slice(h.end, heads[i + 1]?.start ?? html.length)
    if (!sections.has(h.text)) sections.set(h.text, plainText(body).slice(0, SECTION_EXCERPT_CHARS))
  })
  return { intro, sections }
}

export async function extractImagePrompts(input: ExtractImagePromptsInput): Promise<ImagePromptsResult> {
  const { intro, sections } = sectionExcerpts(input.content)
  const sectionList = input.qualifyingSections.length
    ? input.qualifyingSections
        .map((s) => {
          const excerpt = sections.get(s)
          return excerpt ? `## ${s}\n${excerpt}` : `## ${s}`
        })
        .join("\n\n")
    : "(none — emit empty inline_prompts array)"

  const categoryModule = getStyleModuleForPost({ category: input.category, title: input.title, tags: input.tags })

  const userMessage = [
    `# POST`,
    `Title: ${input.title}`,
    `Category: ${input.category}`,
    ...(input.tags?.length ? [`Tags: ${input.tags.join(", ")}`] : []),
    "",
    `# CATEGORY-SPECIFIC STYLE MODULE`,
    categoryModule,
    "",
    `# INTRO (the post's opening, before the first h2)`,
    intro || "(none)",
    "",
    `# QUALIFYING SECTIONS (each "## " line is an exact section_h2 string, followed by the start of that section)`,
    sectionList,
    "",
    `# INSTRUCTIONS`,
    `Generate one hero_prompt and one inline prompt per qualifying section. Use the exact h2 strings above for section_h2. Honor the category-specific style module above when choosing settings, equipment, casting, and mood.`,
  ].join("\n")

  const result = await callAgent(SYSTEM_PROMPT, userMessage, imagePromptsSchema, {
    model: MODEL_SONNET_5,
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
