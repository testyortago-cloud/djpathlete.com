// lib/lead-engine/business-copy.ts — turns the business's own configured
// name into copy fragments for the Lead Engine admin pages, without ever
// falling back to a hard-coded brand name.
//
// `business_settings.display_name` is seeded as `''` (migration 00212 —
// NOT NULL DEFAULT ''), not null, on any install where the owner has not
// yet filled in Business Settings — which includes production today. A bare
// `${name}'s pipeline` then renders as a stray leading apostrophe
// ("'s pipeline") with nothing in front of it. That is exactly what shipped
// on /admin/pipeline and /admin/insights/campaign-revenue before this file
// existed.
//
// "Blank" here means empty or whitespace-only (and, defensively, null or
// undefined) — never a guessed name. This directory is swept by
// __tests__/lib/lead-engine/no-brand-literals.test.ts, so the fallback text
// must stay a neutral, generic phrase, never a hard-coded brand literal.

export type PossessiveName = {
  /** Capitalized, for the start of a sentence: "Acme's" or "The". */
  leading: string
  /** Lowercase, for mid-sentence use: "Acme's" or "the". */
  inline: string
}

export function possessiveName(displayName: string | null | undefined): PossessiveName {
  const name = displayName?.trim()
  if (!name) return { leading: "The", inline: "the" }
  return { leading: `${name}’s`, inline: `${name}’s` }
}
