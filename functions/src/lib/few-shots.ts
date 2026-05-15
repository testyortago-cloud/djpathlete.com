// functions/src/lib/few-shots.ts
// Helper for reading the `few_shot_examples` JSONB column off a
// prompt_templates row and rendering it as a "Recent winners" block that
// can be prepended to an agent's user message.
//
// The performance-learning-loop populates this column. Today it writes
// `FewShotExample` objects (caption + meta) for the social_caption
// scopes; the chief/seo/ads carrier rows start as empty arrays and may
// be backfilled with object-shaped examples later. This reader accepts
// both strings and { caption: string } objects so callers don't have to
// branch.

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Read the `few_shot_examples` array off the prompt_templates row
 * identified by (scope, category). Returns a flattened list of
 * caption-style strings, dropping anything that isn't usable.
 *
 * Returns `[]` for: missing row, null column, non-array column, all
 * entries unusable, or any Supabase error. Never throws — few-shots are
 * advisory; the caller should keep running with no examples.
 */
export async function readFewShots(
  supabase: SupabaseClient,
  scope: string,
  category: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("prompt_templates")
    .select("few_shot_examples")
    .eq("scope", scope)
    .eq("category", category)
    .maybeSingle()
  if (error || !data) return []
  const raw = (data as { few_shot_examples: unknown }).few_shot_examples
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry === "string" && entry.length > 0) {
      out.push(entry)
      continue
    }
    if (entry && typeof entry === "object") {
      const caption = (entry as { caption?: unknown }).caption
      if (typeof caption === "string" && caption.length > 0) {
        out.push(caption)
      }
    }
  }
  return out
}

/**
 * Render up to 3 examples as a numbered block prefaced with a header
 * that tells the model these are inspiration, not templates. Returns an
 * empty string when `examples` is empty — callers can unconditionally
 * concatenate it.
 *
 * Each example is truncated to 600 chars so a noisy carrier row can't
 * blow up the context budget.
 */
export function fewShotsBlock(examples: string[]): string {
  if (examples.length === 0) return ""
  const numbered = examples
    .slice(0, 3)
    .map((ex, i) => `  ${i + 1}. ${ex.slice(0, 600)}`)
    .join("\n")
  return [
    "Recent winners (for inspiration only — do not copy verbatim):",
    numbered,
    "",
  ].join("\n")
}
