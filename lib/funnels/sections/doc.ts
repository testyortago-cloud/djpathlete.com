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
//   wrapper `<div>` — deliberately NOT `data-tone`/`data-accent`, which are
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

function themeCss(theme: SectionDocTheme): string {
  return `
${ROOT} { --djp-radius: ${RADIUS_CSS_VALUE[theme.radius]}; }
${ROOT} .djp-page[data-page-tone="dark"] { background: var(--primary); color: var(--primary-foreground); }
${ROOT} .djp-page[data-page-tone="dark"] .djp-hd { color: inherit; }
${ROOT} .djp-page[data-page-tone="dark"] .djp-sub { color: inherit; opacity: 0.85; }
${ROOT} .djp-page[data-page-accent="primary"] .djp-btn-primary { background: var(--primary); color: var(--primary-foreground); }
`.trim()
}

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

  const sectionsHtml = doc.sections.map((section) => renderSection(section, ctx)).join("\n")
  const html = `${pageWrapperOpenTag(doc.theme)}${sectionsHtml}</div>`

  const usedKinds = SECTION_KINDS.filter((kind) => doc.sections.some((section) => section.kind === kind))
  const usedCss = usedKinds.map((kind) => SECTION_CSS[kind]).join("\n")

  const css = `${THEME_CSS}\n${usedCss}\n${themeCss(doc.theme)}`

  return { html, css, problems: checkSizeCaps(html, css) }
}
