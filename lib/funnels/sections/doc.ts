// lib/funnels/sections/doc.ts — reassembling a whole SectionDoc.
//
// registry.ts defines the document, render.ts turns ONE Section into an HTML
// fragment, styles.ts hand-authors the CSS. This file is the piece that turns
// a WHOLE SectionDoc into the single `{html, css}` pair the existing, frozen
// publish compiler (`lib/funnels/compile/`) accepts — the last stop before
// `compileFunnelStep`, and the last point in the pipeline where a
// draft-time mistake can still be caught before an owner clicks Publish.
//
// Source of truth: docs/superpowers/plans/2026-08-10-ai-page-builder-sections.md
// line 512 (this step's spec), lines 54-86 (the SectionDoc shape) and lines
// 236-251 ("The stylesheet" — THEME_CSS + only the kinds actually used).

import {
  sectionDocSchema,
  SECTION_KINDS,
  type Section,
  type SectionDoc,
  type SectionDocTheme,
} from "@/lib/funnels/sections/registry"
import { renderSection, type RenderContext } from "@/lib/funnels/sections/render"
import { THEME_CSS, SECTION_CSS } from "@/lib/funnels/sections/styles"
import { FUNNEL_ROOT_ID } from "@/lib/funnels/compile"
import { FUNNEL_STEP_HTML_MAX_LENGTH, FUNNEL_STEP_CSS_MAX_LENGTH } from "@/lib/validators/funnel"

const ROOT = `#${FUNNEL_ROOT_ID}`

// ---------------------------------------------------------------------------
// Theme wiring (plan §1a `SectionDoc.theme`). Stage 1.2 reported this field
// was consumed by NOTHING — a schema field that renders nowhere would mislead
// the AI prompt in Stage 1.6, so it is wired here:
//
// - `radius` overrides styles.ts's `--djp-radius` custom property. styles.ts
//   deliberately leaves that knob unwired and documents exactly this fix:
//   append one more rule targeting `#djp-funnel-root` AFTER its own output so
//   normal CSS cascade (same selector, later rule, same specificity) wins —
//   no change needed in styles.ts.
// - `tone` (page-wide light/dark) and `accent` (which brand colour drives
//   primary buttons) are exposed as plain `data-page-*` attributes on a page
//   wrapper `<div>`. `tone` ALSO resolves into each section's own tone knob
//   before rendering — see "PAGE TONE IS A SECTION-TONE DEFAULT" below, which
//   is the load-bearing half; the attribute only paints the page ground.
//   The names are deliberately NOT `data-tone`/`data-accent`, which are
//   already the PER-SECTION style-knob attribute names render.ts emits on
//   every `<section>` (constraint 3, a different value domain entirely:
//   default/muted/accent/dark vs light/dark). Reusing those names on the page
//   wrapper would still be safe (the CSS below scopes on `.djp-page`, which
//   never matches a `<section class="djp-s ...">`), but `data-page-*` keeps
//   the two concerns unambiguous to read.
// - Like render.ts's resolved style knobs, these values are interpolated
//   raw, not through `escapeHtml`: `sectionDocSchema.parse` below has already
//   rejected anything outside the closed enums, so by the time this code
//   runs each value is one of a handful of known-safe short strings.
// ---------------------------------------------------------------------------

const RADIUS_CSS_VALUE: Record<SectionDocTheme["radius"], string> = {
  sharp: "0.125rem",
  soft: "0.6rem",
  round: "1.75rem",
}

// ---------------------------------------------------------------------------
// PAGE TONE IS A SECTION-TONE DEFAULT, NOT A WRAPPER PAINT JOB.
//
// The first cut of this file painted the wrapper `var(--primary)` +
// `var(--primary-foreground)` and left the sections inside it to INHERIT that
// foreground. They never did, and could not: styles.ts's
// `#djp-funnel-root .djp-s { color: var(--foreground) }` is a DIRECT
// declaration on the `<section>`, and a direct declaration always beats an
// inherited value — inheritance is what an element falls back to when NO rule
// matched it, so ancestor specificity never enters the comparison. Every
// default-tone section on a dark page therefore rendered `--foreground` on
// `--primary`: a whole unreadable page, not one unreadable element. The two
// `color: inherit` rescues this file used to add for `.djp-hd` / `.djp-sub`
// were the same mistake one level down — they resolved `inherit` against the
// section, which was still `--foreground`.
//
// Beating `.djp-s` from here would mean re-deriving styles.ts's entire tone
// pass (a panel lift, nine muted-foreground overrides, three shape swaps, two
// counter badges) against a second selector prefix — the same contrast
// contract written twice, which is exactly how it went missing the first time.
//
// So page tone resolves BEFORE the CSS instead: `theme.tone: "dark"` means
// "every section that did not pick a tone of its own renders as a dark
// section". `sectionForPage` promotes those sections' `style.tone` to `"dark"`
// on the way into `renderSection`, and the already-audited
// `[data-tone="dark"]` half of styles.ts does the rest, unchanged. A section
// that DID pick a tone (`muted`/`accent`/`dark`) is never touched — an
// explicit choice outranks a page default, on a dark page exactly as on a
// light one.
//
// The wrapper keeps its own `background` + paired `color` so the page GROUND
// (above the first section, below the last, and any margin between) is dark
// too, and so the wrapper is never a bare background with an unpaired text
// colour. It is no longer load-bearing for anything inside a section.
//
// The promotion is a RENDER-time transform. `doc.sections` is not mutated and
// nothing is written back: the SectionDoc keeps the author's real intent
// ("this section has no tone"), which is what Stage 2's inspector reads and
// what a later `set_theme` back to `light` has to be able to undo.
// ---------------------------------------------------------------------------

/**
 * The tone a section will ACTUALLY render at, once the page theme has had its
 * say. Exported for the review auditor (`review/audit.ts`).
 *
 * This is `sectionForPage`'s rule, extracted rather than copied, and
 * `sectionForPage` now calls it — so the two cannot drift. That matters more
 * than it looks: an auditor that reads `section.style.tone` directly sees four
 * distinct `undefined`s on a dark-themed page and cheerfully reports a page
 * with no tone runs at all, while the page renders as four identical dark
 * bands with nothing between them. Two copies of one rule, one of them wrong,
 * is the failure `ask_the_validator_never_restate_it` names — and here the
 * wrong copy would be silent, because a missing finding looks exactly like a
 * clean page.
 */
export function effectiveTone(
  section: Section,
  theme: SectionDocTheme,
): NonNullable<Section["style"]["tone"]> {
  const own = section.style.tone
  if (own !== undefined && own !== "default") return own
  return theme.tone === "dark" ? "dark" : "default"
}

function sectionForPage(section: Section, theme: SectionDocTheme): Section {
  if (theme.tone !== "dark") return section
  const tone = effectiveTone(section, theme)
  if (tone === section.style.tone) return section
  return { ...section, style: { ...section.style, tone } }
}

function themeCss(theme: SectionDocTheme): string {
  return `
${ROOT} { --djp-radius: ${RADIUS_CSS_VALUE[theme.radius]}; }
${ROOT} .djp-page[data-page-tone="dark"] { background: var(--primary); color: var(--primary-foreground); }
${ROOT} .djp-page[data-page-accent="primary"] .djp-btn-primary { background: var(--primary); color: var(--primary-foreground); }
${ROOT} .djp-page[data-page-accent="primary"] .djp-s[data-tone="dark"] .djp-btn-primary { background: var(--accent); color: var(--accent-foreground); }
`.trim()
}

// The last rule above is the page-level half of styles.ts's "move 3": a shape
// painted in the token of its own background is not low-contrast, it is GONE.
// `data-page-accent: "primary"` paints the primary button `var(--primary)`,
// which is the exact token a dark section paints its background — so the
// page's single most important element disappeared into the band behind it.
// It has to be fixed HERE and not in styles.ts: this file's rules are appended
// AFTER styles.ts's, so at equal specificity source order hands the win to
// whichever selector `themeCss` emits. The override therefore has to outrank
// its own sibling rule, which it does by adding `.djp-s[data-tone="dark"]`
// (1,4,0 vs 1,2,0). It swaps to the OTHER brand pair rather than to a bare
// foreground token, so it survives a scope flip — the same reason styles.ts
// swaps pairs instead of picking a lightness.

function pageWrapperOpenTag(theme: SectionDocTheme): string {
  return (
    `<div class="djp-page" data-page-tone="${theme.tone}" ` +
    `data-page-accent="${theme.accent}" data-page-radius="${theme.radius}">`
  )
}

// ---------------------------------------------------------------------------
// Size-cap enforcement (plan line 514). The SAME numbers `publishStepSchema`
// enforces at publish time — imported, never restated, per the standing
// instruction that this repo has three separate bugs from restating a rule
// instead of calling the thing that owns it.
//
// Exported on its own so the cap check can be exercised directly: the
// current registry's per-field limits, multiplied out across the 24-section
// ceiling, cannot mathematically reach either cap today (worst case is well
// under FUNNEL_STEP_HTML_MAX_LENGTH; the hand-authored stylesheet is a fixed
// ~10-15 KB regardless of how many sections a doc has, nowhere near
// FUNNEL_STEP_CSS_MAX_LENGTH). Testing this function directly with a
// synthetic over-length string is therefore the only way to prove the "report,
// don't truncate" path fires — and it tests the REAL enforcement, since
// `reassemble` below calls this exact function on its own generated output.
// ---------------------------------------------------------------------------

export type SectionDocProblemCode = "html_too_large" | "css_too_large"

export interface SectionDocProblem {
  code: SectionDocProblemCode
  message: string
}

export function checkSizeCaps(html: string, css: string): SectionDocProblem[] {
  const problems: SectionDocProblem[] = []
  if (html.length > FUNNEL_STEP_HTML_MAX_LENGTH) {
    problems.push({
      code: "html_too_large",
      message: `Page HTML is ${html.length} characters, over the ${FUNNEL_STEP_HTML_MAX_LENGTH}-character publish cap.`,
    })
  }
  if (css.length > FUNNEL_STEP_CSS_MAX_LENGTH) {
    problems.push({
      code: "css_too_large",
      message: `Page CSS is ${css.length} characters, over the ${FUNNEL_STEP_CSS_MAX_LENGTH}-character publish cap.`,
    })
  }
  return problems
}

export interface ReassembleResult {
  html: string
  css: string
  /**
   * Empty when the doc is publishable as-is. Non-empty means `html`/`css`
   * are still the FULL, untruncated output (never silently cut down to fit)
   * — the caller (the draft-preview route, the chat-turn response, the
   * publish route) decides what "reported" means for its own UI, exactly
   * like the existing 422-with-`problems` publish contract.
   */
  problems: SectionDocProblem[]
}

// ---------------------------------------------------------------------------
// reassemble
// ---------------------------------------------------------------------------

/**
 * Turns a whole `SectionDoc` into the `{html, css}` pair `compileFunnelStep`
 * accepts.
 *
 * `sectionDocSchema.parse(doc)` re-validates the ENTIRE doc up front —
 * mirroring render.ts's own precondition comment: every per-kind renderer
 * re-parses its own `props` anyway rather than trusting the loose
 * `Record<string, unknown>` shape, cheap, and turns "should be impossible"
 * bad input (a doc that bypassed validation somewhere upstream, or arrived
 * here straight off a jsonb column) into a loud crash instead of a silently
 * wrong page. Its return value is discarded — `doc` itself already satisfies
 * the `SectionDoc`/`Section` shapes `renderSection` expects, so rendering
 * reads from `doc`, not from the parsed copy.
 *
 * `ctx.funnelBasePath` is threaded straight through to `renderSection` for
 * every section, unchanged. render.ts's own guard (a "step" CTA degrades to
 * a disabled placeholder whenever `funnelBasePath` is missing OR doesn't
 * start with "/") already enforces the leading-slash invariant — repeating
 * that check here would be the exact "restate a rule instead of calling the
 * thing that owns it" mistake this stage is warned away from.
 *
 * Deterministic: no `Date.now()`, no `Math.random()`, and the CSS's per-kind
 * ordering is derived from `SECTION_KINDS` (registry.ts's fixed, authored
 * order) rather than the doc's own section order or `Set` iteration order —
 * two docs that use the same kinds in a different order emit byte-identical
 * CSS.
 */
export function reassemble(doc: SectionDoc, ctx: RenderContext = {}): ReassembleResult {
  sectionDocSchema.parse(doc)

  const sectionsHtml = doc.sections
    .map((section) => renderSection(sectionForPage(section, doc.theme), ctx))
    .join("\n")
  const html = `${pageWrapperOpenTag(doc.theme)}${sectionsHtml}</div>`

  const usedKinds = SECTION_KINDS.filter((kind) => doc.sections.some((section) => section.kind === kind))
  const usedCss = usedKinds.map((kind) => SECTION_CSS[kind]).join("\n")

  const css = `${THEME_CSS}\n${usedCss}\n${themeCss(doc.theme)}`

  return { html, css, problems: checkSizeCaps(html, css) }
}
