// lib/funnels/cta-class.ts — what a CTA looks like, defined ONCE.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A MODULE AND NOT A STRING LITERAL AT EACH CALL SITE
// ---------------------------------------------------------------------------
// A funnel CTA is rendered by two different mechanisms. A `url` / `anchor` /
// `step` target becomes an `<a>` written by `render.ts`; a `program`,
// `session_pack`, `event` or `booking` target becomes an ISLAND — a
// `data-djp-island` placeholder that the compiler hands to a React component at
// request time. The renderer's `<a>` carried `djp-btn djp-btn-primary`; the
// island's `<a>` carried NO CLASS AT ALL.
//
// So every buy button on every published funnel page rendered as plain link
// text: no background, no padding, no radius, underlined by the UA. Two CTAs
// side by side in the same hero, one a button and one a hyperlink, decided by
// which KIND of thing it pointed at — which is invisible from the markup and
// has nothing to do with how it should look. `styles.ts` has no
// `[data-djp-island]` rule, so nothing was ever going to style it.
//
// The obvious fix — add island selectors to `styles.ts` — is the one to avoid:
// `.djp-btn` is not one rule but a family (base, per-variant, hover, active,
// focus-visible, the `data-tone="accent"` repaint that stops a primary button
// being its own background's colour, and the pricing card's `width: 100%`).
// Restating any of that against a second selector is a second definition to
// keep in step, and divergent restatements are the defect this repo has paid
// for repeatedly. Instead the island is TOLD which treatment it is wearing and
// puts on the same classes everything else uses.
//
// NO IMPORTS, DELIBERATELY. Both a server module (`render.ts`, which pulls in
// Zod and the compiler) and three client island components read this. A leaf
// with no imports can be read by either without dragging anything into the
// browser bundle.

/**
 * The three CTA treatments a funnel page has. Closed set: this is the whole
 * vocabulary, and `styles.ts` defines exactly these classes.
 */
export const CTA_VARIANTS = ["primary", "secondary", "link"] as const

export type CtaVariant = (typeof CTA_VARIANTS)[number]

/**
 * Variant -> the classes `styles.ts` styles.
 *
 * `link` is the footer's treatment, and it is why this cannot be a boolean or
 * a default. A footer's "Book a call" is a booking ISLAND sitting in a row of
 * text links; giving every island the button treatment would turn that row into
 * a wall of buttons. The call site knows which it wants — nothing else does.
 */
export const CTA_CLASS: Record<CtaVariant, string> = {
  primary: "djp-btn djp-btn-primary",
  secondary: "djp-btn djp-btn-secondary",
  link: "djp-footer-link",
}

/**
 * The class string for an island's `variant` prop, or "" when it has none.
 *
 * ABSENT MEANS UNSTYLED, AND THAT IS THE POINT. `variant` is optional with NO
 * default, because a published page is frozen: `funnel_step_versions` stores
 * the compiled HTML *and* the stylesheet, and `data-djp-props` was written
 * before this prop existed. A default here would repaint pages that are already
 * live — including turning that footer link row into buttons — the moment this
 * deploys, with no author action and no way to preview it. Pages pick the fix
 * up when they are next published, which is when their markup and their
 * stylesheet are regenerated together.
 */
export function ctaClassFor(variant: unknown): string {
  return typeof variant === "string" && variant in CTA_CLASS ? CTA_CLASS[variant as CtaVariant] : ""
}
