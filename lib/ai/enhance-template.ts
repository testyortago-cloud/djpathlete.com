import { z } from "zod"
import { callAgent, MODEL_HAIKU } from "@/lib/ai/anthropic"
import { TEMPLATE_CATEGORIES, TEMPLATE_SCOPES } from "@/lib/validators/prompt-template"

// ─── System prompts (house style) ────────────────────────────────────────────

const HOUSE_STYLE = `The DJP Athlete AI generates training weeks and days from coach instructions. The coach instructions you produce must be concrete and actionable — the downstream AI architect will follow them literally.

Canonical slot roles: warm_up, primary_compound, secondary_compound, accessory, isolation, cool_down, power, conditioning, activation, testing.
Canonical techniques: straight_set, superset, dropset, giant_set, circuit, rest_pause, amrap, cluster_set, complex, emom, wave_loading.

Style requirements:
- Short imperative headline (e.g., "HOTEL GYM — limited equipment (dumbbells and bodyweight only):")
- Bulleted list of specific directives with concrete sets/reps/RPE/rest/tempo numbers
- Reference canonical roles/techniques by name when prescribing structure
- State overrides explicitly ("use straight sets only", "4 power exercises", "no supersets")
- Keep under ~400 words
- No fluff, no preamble, no sign-off`

const POLISH_SYSTEM = `You polish draft coach instructions for DJP Athlete's AI program generator.

${HOUSE_STYLE}

Take the coach's rough draft and rewrite it in the house style. Preserve every concrete constraint the coach wrote — add specificity (numbers, canonical terms), do not invent new constraints the coach did not imply.`

const GENERATE_SYSTEM = `You create reusable coach-instruction templates for DJP Athlete's AI program generator library.

${HOUSE_STYLE}

Given a short seed idea from an admin, output a complete template with:
- name: short, title-case, 2-5 words (e.g., "Hotel Gym", "Lower Leg Focus Week")
- description: one-line hook under 100 chars
- category: one of ${TEMPLATE_CATEGORIES.join(", ")}
- scope: one of ${TEMPLATE_SCOPES.join(", ")} — pick "week" for multi-day themes, "day" for single-session focuses, "both" for constraints that work at either level
- prompt: the full house-style coach instructions

Choose the most specific category. If no category fits well, use "structure".`

// ─── Schemas ────────────────────────────────────────────────────────────────

const polishSchema = z.object({
  prompt: z.string().min(1).max(4000),
})

const generateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(200),
  category: z.enum(TEMPLATE_CATEGORIES),
  scope: z.enum(TEMPLATE_SCOPES),
  prompt: z.string().min(1).max(4000),
})

export type PolishResult = z.infer<typeof polishSchema>
export type GenerateResult = z.infer<typeof generateSchema>

// ─── Public API ─────────────────────────────────────────────────────────────

export async function polishPrompt(
  input: string,
  targetScope?: "week" | "day",
): Promise<PolishResult> {
  const userMessage = [
    targetScope ? `Context: this is for a generate-${targetScope} dialog.` : "",
    "Rough draft from the coach:",
    input,
    "",
    "Rewrite in the house style. Output only the polished prompt text in the JSON `prompt` field.",
  ]
    .filter(Boolean)
    .join("\n")

  const { content } = await callAgent(POLISH_SYSTEM, userMessage, polishSchema, {
    model: MODEL_HAIKU,
    maxTokens: 2000,
    cacheSystemPrompt: true,
  })
  return content
}

export async function generateTemplate(
  seed: string,
  targetScope?: "week" | "day",
): Promise<GenerateResult> {
  const userMessage = [
    targetScope
      ? `Hint: the admin is working in a generate-${targetScope} context (bias scope accordingly, but override if the seed clearly indicates otherwise).`
      : "",
    "Seed idea from admin:",
    seed,
    "",
    "Output a complete template in the JSON schema.",
  ]
    .filter(Boolean)
    .join("\n")

  const { content } = await callAgent(GENERATE_SYSTEM, userMessage, generateSchema, {
    model: MODEL_HAIKU,
    maxTokens: 2000,
    cacheSystemPrompt: true,
  })
  return content
}
