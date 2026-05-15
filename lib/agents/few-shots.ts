// lib/agents/few-shots.ts
// Next.js-side mirror of functions/src/lib/few-shots.ts. Used by the
// Ads agent (which runs in the Next.js process) to read the
// `few_shot_examples` JSONB column off a prompt_templates row and
// render it as a "Recent winners" block prepended to the agent's user
// message.
//
// Behavior notes match the functions/ side helper:
// * Accepts string entries OR { caption: string } objects (so the loop
//   can write either today's social-caption shape or a future
//   string-array shape without breaking either consumer).
// * Returns `[]` on any failure — few-shots are advisory; the caller
//   should keep running with no examples.
// * Truncates each example to 600 chars and caps at 3 entries so a
//   noisy carrier row can't blow the context budget.

import type { SupabaseClient } from "@supabase/supabase-js"

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
