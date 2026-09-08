// lib/funnels/sections/tone-legend.ts — what each `style.tone` actually PAINTS.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------------
// The tone vocabulary is named by ROLE ("default", "muted", "accent", "dark")
// and nothing anywhere said what colour any of them is. That is fine for the
// stylesheet, which resolves them through CSS custom properties, and useless
// for the two audiences that have to CHOOSE one:
//
//   - the page-builder model, which was asked for "a green background with
//     white text" and answered "I can't set literal colours — the document has
//     no colour fields", because nothing in its prompt connected the word
//     "green" to `tone: "dark"`. Verified against the live model, not guessed.
//   - the owner in the manual inspector, whose Tone select offered
//     "Default / Muted / Accent / Dark" — four words that name a rhythm and
//     describe no colour.
//
// So both surfaces read this table instead of restating it. A tone whose CSS
// changes in `styles.ts` and whose description does NOT change here is the
// failure this file is shaped to make obvious: `tone-legend.test.ts` parses the
// real stylesheet and fails when a tone's `background` token drifts from the
// rule that actually paints it.
//
// The tokens are the ones `styles.ts` resolves — `--background` is not written
// there because "default" is the absence of a repaint, which is exactly why it
// needs saying out loud somewhere.
// ---------------------------------------------------------------------------

import type { SectionStyleKnobs } from "@/lib/funnels/sections/registry"

export type SectionTone = NonNullable<SectionStyleKnobs["tone"]>

export interface ToneSwatch {
  id: SectionTone
  /**
   * The inspector's option label: the COLOUR, not the role. The role name is
   * `id`, and the inspector shows both — a label carrying both was truncated
   * by the panel's width, which cut off the colour word and defeated the point.
   */
  label: string
  /** The CSS custom property `styles.ts` paints the section background with. */
  background: string
  /** Its paired foreground, per the same stylesheet. */
  foreground: string
  /**
   * Plain language, for the prompt and the inspector's hint. Written for
   * someone who would say "green", never "the primary token".
   */
  description: string
}

/**
 * Order matters: it is the order the inspector lists them in, and it runs
 * lightest to darkest so the select reads as a ramp rather than a bag.
 */
export const TONE_SWATCHES: readonly ToneSwatch[] = [
  {
    id: "default",
    label: "White",
    background: "var(--background)",
    foreground: "var(--foreground)",
    description: "white with dark text",
  },
  {
    id: "muted",
    label: "Light grey",
    background: "var(--surface)",
    foreground: "var(--foreground)",
    description: "a light grey band",
  },
  {
    id: "accent",
    label: "Tan / gold",
    background: "var(--accent)",
    foreground: "var(--accent-foreground)",
    description: "the tan/gold brand accent with dark brown text",
  },
  {
    id: "dark",
    label: "Brand green",
    background: "var(--primary)",
    foreground: "var(--primary-foreground)",
    description: "the deep brand green with white text",
  },
]

/** Lookup by id, for callers holding a tone off a document. */
export function toneSwatch(tone: SectionTone): ToneSwatch {
  const found = TONE_SWATCHES.find((swatch) => swatch.id === tone)
  // Non-null by construction: `SectionTone` is the union of the four ids and
  // `tone-legend.test.ts` pins that the table covers every member.
  return found as ToneSwatch
}

/**
 * One sentence per tone, for the model. Deliberately phrased the way an owner
 * asks ("green with white text") rather than the way the stylesheet resolves
 * it, because the mapping this closes is from THEIR words to the enum.
 */
export const TONE_COLOUR_LEGEND = TONE_SWATCHES.map((swatch) => `\`"${swatch.id}"\` is ${swatch.description}`).join(
  "; ",
)
