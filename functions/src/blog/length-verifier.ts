// functions/src/blog/length-verifier.ts
// Word-count utilities for blog generation. Used by handleBlogGeneration to
// decide whether the first AI pass came in too short and a single expansion
// re-prompt should run.

export const LENGTH_PRESETS = {
  short: 500,
  medium: 1000,
  long: 1500,
} as const

export type LengthPreset = keyof typeof LENGTH_PRESETS

const SHORTFALL_THRESHOLD = 0.75 // accept anything ≥ 75% of target

/**
 * Strip HTML tags and count whitespace-separated tokens. Cheap and good
 * enough — we don't need linguistic precision, just an order-of-magnitude
 * check.
 */
export function countWords(html: string): number {
  if (!html) return 0
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return 0
  return text.split(" ").length
}

export function resolveTargetWordCount(input: {
  target_word_count?: number
  length?: string
}): number {
  if (typeof input.target_word_count === "number" && input.target_word_count > 0) {
    return input.target_word_count
  }
  const preset = input.length as LengthPreset | undefined
  if (preset && preset in LENGTH_PRESETS) return LENGTH_PRESETS[preset]
  return LENGTH_PRESETS.medium
}

export function isTooShort(actualWordCount: number, targetWordCount: number): boolean {
  if (targetWordCount <= 0) return false
  return actualWordCount / targetWordCount < SHORTFALL_THRESHOLD
}

export interface ExpansionPromptArgs {
  currentHtml: string
  actualWordCount: number
  targetWordCount: number
  h2List: string[]
}

export function buildExpansionPrompt(args: ExpansionPromptArgs): string {
  const sections =
    args.h2List.length > 0
      ? args.h2List.map((s) => `- ${s}`).join("\n")
      : "- (use the existing h2 sections in the draft)"
  return `The draft below is too short — ${args.actualWordCount} words against a ${args.targetWordCount}-word target. Expand the following sections with deeper coaching detail, an additional concrete example, or a sub-point that adds value (not filler):

${sections}

Constraints:
- Do not change the title, slug, excerpt, category, tags, or meta_description fields. Output the same JSON shape with all those fields identical to the draft.
- Only expand the content field.
- Maintain the existing voice and structural rules.

Current draft:
${args.currentHtml}`
}
