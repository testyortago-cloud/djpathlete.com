// lib/og/brand.ts — the palette the share cards are painted in.
//
// WHY HEX AND NOT THE DESIGN TOKENS. `app/globals.css` defines the brand in
// oklch under `@theme inline`, and OG cards never see it: `ImageResponse`
// renders through Satori, which has no CSS variables, no Tailwind and no
// stylesheet. Inline styles with literal hex are the established exception
// zone for these files — `app/athlete/[token]/opengraph-image.tsx` says so in
// its own header, and it is where these three values come from.
//
// SHARED BECAUSE TWO CARDS NOW USE THEM. One card is a palette; two copies of
// a palette is a palette that drifts, and the drift shows up as two share
// cards from the same brand that do not match — visible only to whoever
// happens to see both links side by side in a chat thread.
//
// DELIBERATELY NOT UNIFIED WITH THE OTHER COPIES. `render-worker/` is a
// separate package that cannot import from here, and `components/emails/*`
// needs inline styles for HTML email. Both already hold their own copy, and
// `render-worker/src/index.ts` even records that it renders a slightly
// different accent on purpose. Dragging those into this module would cross two
// runtime boundaries to fix a problem neither of them has.

/** Deep teal. The card background. */
export const OG_ARENA = "#0B2E3B"

/** Gray Orange. Rules, eyebrows and the emphasis figure. */
export const OG_ACCENT = "#C49B7A"

/** Pale blue-grey, for the quiet supporting line. */
export const OG_ICE = "#D8E6EB"

/** 1200x630 — what every scraper crops to, and what Satori is asked for. */
export const OG_SIZE = { width: 1200, height: 630 } as const

/**
 * Cuts a string to `max` characters on a word boundary, adding an ellipsis.
 *
 * Satori has no `text-overflow`, so an over-long title does not truncate — it
 * WRAPS, pushing the rest of the card off the bottom edge and out of the
 * 1200x630 frame. The overflow is silent: the PNG renders fine and the missing
 * half is simply not in it. So the cut has to happen before the text is laid
 * out.
 */
export function ogClamp(value: string, max: number): string {
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  // A single word longer than `max` has no space to break on — take the hard
  // cut rather than returning the whole overlong string.
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
