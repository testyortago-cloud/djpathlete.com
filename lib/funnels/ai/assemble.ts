// lib/funnels/ai/assemble.ts — PageDraft -> the { html, css } pair the publish
// compiler already consumes.
//
// Two jobs, both about isolation:
//
// 1. Each section's CSS is scoped under `#djp-sec-<id>` with the SAME scopeCss
//    the publish compiler uses. compileFunnelStep then scopes the whole sheet
//    under `#djp-funnel-root`, and the two compose: the idempotency check in
//    scopeSelector is against the funnel-root prefix only, so a section prefix
//    passes through and you get `#djp-funnel-root #djp-sec-abc .title`.
//
// 2. @keyframes are renamed per section. scopeCss deliberately skips rules
//    inside keyframes, so two sections both defining `fadeIn` would collide —
//    editing section 3 would change section 1's animation. That is exactly the
//    drift this whole feature is built to prevent, so it is handled here.

import postcss, { type AtRule, type Declaration } from "postcss"
import { scopeCss } from "@/lib/funnels/compile/css-scope"
import { sectionScopeId, type PageDraft } from "./types"

export interface AssembledDraft {
  html: string
  css: string
  /** Non-fatal: a section whose CSS would not parse contributes none. */
  errors: string[]
}

const KEYFRAMES_AT_RULE = /^(-\w+-)?keyframes$/i
const ANIMATION_DECL = /^(-\w+-)?animation(-name)?$/i

/**
 * Prefixes every `@keyframes` name in `css` with the section id and rewrites
 * the `animation` / `animation-name` declarations that reference it.
 *
 * Returns the input unchanged on a parse error — the caller (assembleDraft)
 * reports that separately, and reporting it twice would be noise.
 */
export function namespaceKeyframes(css: string, sectionId: string): string {
  if (css.trim().length === 0) return css

  let root
  try {
    root = postcss.parse(css)
  } catch {
    return css
  }

  const renamed = new Map<string, string>()
  root.walkAtRules((atRule: AtRule) => {
    if (!KEYFRAMES_AT_RULE.test(atRule.name)) return
    const from = atRule.params.trim()
    if (from.length === 0) return
    const to = `${sectionId}-${from}`
    renamed.set(from, to)
    atRule.params = to
  })

  if (renamed.size === 0) return root.toString()

  root.walkDecls(ANIMATION_DECL, (decl: Declaration) => {
    // `animation` is a shorthand whose name token can sit anywhere among the
    // timing values, so every token is checked against the rename map rather
    // than assuming a position.
    decl.value = decl.value
      .split(",")
      .map((part) =>
        part
          .split(/(\s+)/)
          .map((token) => renamed.get(token) ?? token)
          .join(""),
      )
      .join(",")
  })

  return root.toString()
}

/**
 * Concatenates a draft into one HTML string and one stylesheet.
 *
 * The result goes straight into `compileFunnelStep({ html, css })` — this
 * function is the ONLY thing that stands between the section model and the
 * existing, unchanged publish pipeline.
 */
export function assembleDraft(draft: PageDraft): AssembledDraft {
  const errors: string[] = []

  const html = draft.sections
    .map((s) => `<section id="${sectionScopeId(s.id)}">${s.html}</section>`)
    .join("\n")

  const sheets: string[] = []

  if (draft.pageCss.trim().length > 0) {
    try {
      // Page CSS is not section-scoped: it carries fonts, custom properties and
      // the page background, which must apply across sections.
      sheets.push(postcss.parse(draft.pageCss).toString())
    } catch (error) {
      errors.push(`Page theme styles could not be read: ${(error as Error).message}`)
    }
  }

  for (const section of draft.sections) {
    if (section.css.trim().length === 0) continue
    const scope = sectionScopeId(section.id)
    try {
      sheets.push(scopeCss(namespaceKeyframes(section.css, section.id), scope))
    } catch (error) {
      errors.push(`Styles for section ${section.id} could not be read: ${(error as Error).message}`)
    }
  }

  return { html, css: sheets.join("\n"), errors }
}
