// lib/funnels/ai/types.ts — the shape of an AI-authored page draft.
//
// A page is an ORDERED LIST OF SECTIONS, not one HTML blob. That boundary is
// the whole basis of the anti-drift guarantee in apply.ts: a targeted edit
// regenerates one section and copies the rest by reference, so unchanged
// regions are unchanged by construction rather than by asking nicely.

/** One authored region of a page. `id` is stable for the section's whole life. */
export interface FunnelSection {
  /** "sec_" + 8 lowercase hex. Never reused, never renumbered. */
  id: string
  /** Free-form label the model picks: "hero", "features", "proof", ... */
  kind: string
  /** Human label shown in the chat and the section list. */
  title: string
  /** One line, <= 140 chars. The planner's ONLY view of this section. */
  summary: string
  /** The section's markup. No wrapper element — assembly adds it. */
  html: string
  /** Section-local CSS. Namespaced and scoped at assembly time. */
  css: string
}

/** The full editable state of one funnel page. */
export interface PageDraft {
  sections: FunnelSection[]
  /** Page-level theme: fonts, colour custom properties, background. */
  pageCss: string
}

/** Hard cap. Bounds planner prompt size and keeps a page humanly reviewable. */
export const MAX_SECTIONS = 20

export function emptyDraft(): PageDraft {
  return { sections: [], pageCss: "" }
}

/** The element id a section's markup is wrapped in, and its CSS scope root. */
export function sectionScopeId(sectionId: string): string {
  return `djp-sec-${sectionId}`
}
