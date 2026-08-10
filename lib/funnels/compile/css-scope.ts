// lib/funnels/compile/css-scope.ts — confine a published page's stylesheet to
// the funnel container.
//
// Next's root layout wraps every route, so a funnel page cannot escape
// globals.css without splitting the app into multiple root layouts — a large
// refactor of a working app. Instead the page renders inside
// <div id="djp-funnel-root"> and every selector here is prefixed with that id.
//
// Useful side effect: this output is UNLAYERED, and unlayered CSS beats
// @layer rules regardless of specificity — so anything the owner explicitly
// styled on the canvas always wins over the app's base layer, while elements
// they never touched still inherit sensible app defaults.

import postcss, { type AtRule, type Rule } from "postcss"

export const FUNNEL_ROOT_ID = "djp-funnel-root"

/** At-rules whose child rules are selectors in their own right, not page selectors. */
const KEYFRAME_AT_RULE = /(-)?keyframes$/i

/** At-rules that must be dropped entirely — they can pull in off-site CSS. */
const STRIPPED_AT_RULES = new Set(["import", "charset"])

/**
 * Prefixes every selector in `css` with `#<rootId>`.
 *
 * Throws `CssSyntaxError` on malformed input. Callers must catch it and fail
 * the publish (`css_parse_failed`) — a page whose styles could not be scoped
 * would leak its CSS into the whole admin/marketing app, so shipping it
 * degraded is not an option.
 */
export function scopeCss(css: string, rootId: string = FUNNEL_ROOT_ID): string {
  if (css.trim().length === 0) return ""

  const prefix = `#${rootId}`
  const root = postcss.parse(css)

  root.walkAtRules((atRule: AtRule) => {
    if (STRIPPED_AT_RULES.has(atRule.name.toLowerCase())) atRule.remove()
  })

  root.walkRules((rule: Rule) => {
    if (isInsideKeyframes(rule)) return
    // A rule nested inside another rule (native CSS nesting) is already a
    // descendant of its already-scoped parent selector, so re-prefixing it
    // here would double-scope it into a selector that can never match (the
    // unique #<rootId> element can't be nested inside itself). Our flat
    // renderer never emits nested rules today, but this keeps the escape
    // hatch safe if that ever changes.
    if (rule.parent?.type === "rule") return
    rule.selectors = rule.selectors.map((selector) => scopeSelector(selector, prefix))
  })

  return escapeForStyleTag(root.toString())
}

/**
 * The public route injects this string into a <style> tag. A closing tag hidden
 * inside a CSS string value (content: "</style><script>...") would end the
 * element early and escape into markup. `<\/style` is a valid CSS escape and
 * renders identically.
 */
function escapeForStyleTag(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style")
}

function isInsideKeyframes(rule: Rule): boolean {
  // Walked structurally: postcss types the parent chain as
  // Container | Document | undefined, which does not narrow cleanly.
  let parent: unknown = rule.parent
  while (parent && typeof parent === "object") {
    const node = parent as { type?: string; name?: string; parent?: unknown }
    if (node.type === "atrule" && KEYFRAME_AT_RULE.test(node.name ?? "")) return true
    parent = node.parent
  }
  return false
}

function scopeSelector(selector: string, prefix: string): string {
  const trimmed = selector.trim()
  if (trimmed.length === 0) return trimmed

  // Already scoped — re-publishing must be idempotent.
  if (trimmed === prefix || trimmed.startsWith(`${prefix} `) || trimmed.startsWith(`${prefix}.`)) {
    return trimmed
  }

  // The document-level selectors have no meaning inside a container; they refer
  // to the page as a whole, which for a funnel page IS the root element.
  if (/^(html|body|:root)$/i.test(trimmed)) return prefix
  if (/^html\s+body$/i.test(trimmed)) return prefix

  const withoutDocRoot = trimmed.replace(/^(html|body|:root)\s+/i, "")
  return `${prefix} ${withoutDocRoot}`
}
