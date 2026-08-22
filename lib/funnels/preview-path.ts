// lib/funnels/preview-path.ts
//
// The full-screen draft preview mirrors the LIVE route's path shape on purpose:
// `renderCtaTarget`'s `step` case builds `${ctx.funnelBasePath}/${stepSlug}`
// (lib/funnels/sections/render.ts:463), so handing the renderer a preview base
// rewrites every in-funnel button with no renderer change at all.
//
// Both functions live here rather than at their call sites because the route
// and the submit endpoint must agree about where a preview link points. Two
// copies of a string rewrite is how the preview and the page it is previewing
// start disagreeing.

/** The full-screen draft preview's base. Mirrors `/go`. */
export const PREVIEW_BASE = "/preview"

/** The public funnel route's base. */
export const LIVE_BASE = "/go"

/**
 * The base a step CTA is appended to, e.g. `/preview/summer-camp`.
 *
 * The slug is encoded: it is owner input, and an un-encoded `a/b` would become
 * two path segments, which the `[[...step]]` catch-all would then read as a
 * step that does not exist.
 */
export function previewBasePath(funnelSlug: string): string {
  return `${PREVIEW_BASE}/${encodeURIComponent(funnelSlug)}`
}

/**
 * `/go/<funnel>[/<step>]` -> `/preview/<funnel>[/<step>]`, or `null` when the
 * URL is not an internal funnel page.
 *
 * `null` IS A DISTINCT ANSWER, not a failure. An external `https://` success
 * redirect must be REPORTED to the owner rather than followed — navigating out
 * of an admin-gated preview to a third-party site is a place they cannot come
 * back from — so the caller has to be able to tell the two apart.
 *
 * A protocol-relative `//evil.com/go/x` is rejected before anything else: it
 * starts with `/`, so a naive prefix check reads it as internal, and it is an
 * absolute cross-origin navigation.
 */
export function livePathToPreview(url: string): string | null {
  if (url.startsWith("//")) return null
  if (url === LIVE_BASE) return PREVIEW_BASE
  // The trailing slash is the segment boundary — without it `/golf` matches.
  if (!url.startsWith(`${LIVE_BASE}/`)) return null
  return `${PREVIEW_BASE}${url.slice(LIVE_BASE.length)}`
}
