// lib/funnels/compile/sanitize.ts — HTML -> sanitised FunnelNode tree.
//
// Runs ONCE at publish time, never per request. Allowlist-first: anything not
// explicitly permitted is removed, so a new attack vector is excluded by
// default rather than needing a new rule.
//
// Three dispositions for a tag:
//   allowed  -> kept with filtered attributes
//   dropped  -> removed WITH its subtree (script, form controls, ...)
//   unknown  -> unwrapped, children kept (a stray <marquee> loses the tag,
//               not the owner's copy)

import { parseFragment } from "parse5"
import {
  ISLAND_ATTR,
  ISLAND_PROPS_ATTR,
  isIslandName,
  parseIslandProps,
} from "@/lib/funnels/islands"
import type { CompileError, FunnelNode } from "./types"

// ---------------------------------------------------------------------------
// Allowlists
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = new Set([
  "a", "article", "aside", "audio", "b", "blockquote", "br", "button", "code",
  "dd", "details", "div", "dl", "dt", "em", "figcaption", "figure", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "iframe", "img",
  "li", "main", "mark", "nav", "ol", "p", "picture", "pre", "s", "section",
  "small", "source", "span", "strong", "sub", "summary", "sup", "table",
  "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul", "video",
])

/**
 * Inline SVG, narrowly. Models reach for icon SVG constantly and a page without
 * checkmarks looks visibly cheaper, but SVG is a whole second markup language
 * with its own script surface — so this is a closed list of pure drawing
 * elements. Everything capable of loading, scripting or embedding is in
 * FORBIDDEN_SVG_TAGS below and is asserted absent from this set by a test.
 */
export const SVG_TAGS: ReadonlySet<string> = new Set([
  "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon",
])

/**
 * Named so a test can assert each one is dropped AND that none has been quietly
 * added to SVG_TAGS. `use`/`image` load external content, `foreignObject` reopens
 * full HTML inside SVG, `script`/`handler`/`animate*` execute, `a` navigates,
 * `style` injects an unscoped stylesheet, and filter/mask/pattern/marker all
 * take url() references.
 */
export const FORBIDDEN_SVG_TAGS = [
  "foreignobject", "use", "image", "script", "style", "animate",
  "animatetransform", "animatemotion", "set", "handler", "a", "text", "tspan",
  "filter", "mask", "pattern", "marker", "switch", "desc", "metadata",
] as const

/** Attributes permitted on an SVG element. Geometry and presentation only. */
const SVG_ATTRS = new Set([
  "viewbox", "preserveaspectratio", "xmlns", "fill", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset",
  "fill-rule", "clip-rule", "fill-opacity", "stroke-opacity", "opacity",
  "transform", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2",
  "y2", "points", "width", "height", "class", "id", "style", "role",
])

/**
 * Removed with their subtree. `form`/`input` are here because the form island
 * owns capture — a raw form on the canvas would post nowhere and silently lose
 * leads. `svg` now has its own allowlist above (SVG_TAGS) with its own
 * attribute set.
 */
const DROPPED_TAGS = new Set([
  "applet", "base", "canvas", "embed", "form", "frame", "frameset", "input",
  "link", "meta", "noscript", "object", "option", "script", "select", "slot",
  "style", "template", "textarea", "title",
])

const ALLOWED_ATTRS = new Set([
  "alt", "class", "controls", "height", "href", "id", "loading", "loop",
  "muted", "open", "playsinline", "poster", "preload", "rel", "role", "src",
  "srcset", "style", "target", "title", "width",
])

/** Named for the "no forbidden svg tag is in the allowlist" structural test. */
const FORBIDDEN_SVG_TAG_SET: ReadonlySet<string> = new Set(FORBIDDEN_SVG_TAGS)

/** Hosts permitted in an <iframe src>. Mirrored by the CSP `frame-src` test. */
export const ALLOWED_IFRAME_HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "player.vimeo.com",
] as const

/** Reserved prefix — island wiring must never survive onto a rendered element. */
const RESERVED_ATTR_PREFIX = "data-djp-"

// ---------------------------------------------------------------------------
// Value sanitisers
// ---------------------------------------------------------------------------

/**
 * Returns the URL if it is safe to emit, else undefined. https, mailto, tel,
 * root-relative and fragment links only. Protocol-relative (`//host`) is
 * rejected because it inherits the page scheme and reads as relative.
 */
export function safeUrl(raw: string, opts: { allowDataImage?: boolean } = {}): string | undefined {
  const value = raw.trim()
  if (value.length === 0) return undefined
  // Control characters are used to smuggle scheme names past a naive check.
  if (hasControlChars(value)) return undefined
  if (value.startsWith("//")) return undefined
  if (value.startsWith("/") || value.startsWith("#")) return value
  if (/^https:\/\//i.test(value)) return value
  if (/^mailto:/i.test(value) || /^tel:/i.test(value)) return value
  if (opts.allowDataImage && /^data:image\/(png|jpe?g|gif|webp|avif);base64,/i.test(value)) {
    return value
  }
  return undefined
}

/** True if the string contains any C0 control character or DEL. */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 32 || code === 127) return true
  }
  return false
}

const FORBIDDEN_STYLE_TOKENS = [
  "javascript:",
  "expression(",
  "@import",
  "behavior:",
  "-moz-binding",
]

/** Drops whole declarations containing anything script-capable. */
export function safeStyle(raw: string): string | undefined {
  const withoutComments = raw.replace(/\/\*[\s\S]*?\*\//g, "")
  const kept = withoutComments
    .split(";")
    .map((decl) => decl.trim())
    .filter((decl) => {
      if (decl.length === 0) return false
      const lower = decl.toLowerCase()
      return !FORBIDDEN_STYLE_TOKENS.some((token) => lower.includes(token))
    })
  return kept.length > 0 ? kept.join(";") : undefined
}

function isAllowedIframeSrc(src: string): boolean {
  try {
    const url = new URL(src)
    if (url.protocol !== "https:") return false
    return (ALLOWED_IFRAME_HOSTS as readonly string[]).includes(url.hostname)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// parse5 walking
// ---------------------------------------------------------------------------

interface P5Attr {
  name: string
  value: string
}

interface P5Node {
  nodeName: string
  tagName?: string
  value?: string
  attrs?: P5Attr[]
  childNodes?: P5Node[]
  content?: { childNodes?: P5Node[] }
}

function attrMap(node: P5Node): Record<string, string> {
  const out: Record<string, string> = {}
  for (const attr of node.attrs ?? []) out[attr.name.toLowerCase()] = attr.value
  return out
}

/**
 * Parses editor HTML into a sanitised node tree.
 *
 * Never throws on malformed input — parse5 is error-tolerant by spec, and a
 * publish should fail with a readable message rather than a stack trace.
 */
export function htmlToNodes(html: string): { nodes: FunnelNode[]; errors: CompileError[] } {
  const errors: CompileError[] = []
  const fragment = parseFragment(html) as unknown as P5Node
  const nodes = convertChildren(fragment.childNodes ?? [], errors, false)
  return { nodes, errors }
}

function convertChildren(children: P5Node[], errors: CompileError[], inSvg = false): FunnelNode[] {
  const out: FunnelNode[] = []
  for (const child of children) out.push(...convertNode(child, errors, inSvg))
  return out
}

function convertNode(node: P5Node, errors: CompileError[], inSvg = false): FunnelNode[] {
  if (node.nodeName === "#text") {
    const value = node.value ?? ""
    return value.length > 0 ? [{ t: "text", v: value }] : []
  }
  if (node.nodeName === "#comment" || node.nodeName === "#documentType") return []

  const tag = (node.tagName ?? node.nodeName).toLowerCase()
  if (DROPPED_TAGS.has(tag)) {
    // Report it. Dropping a subtree in silence is survivable when a human is
    // watching a canvas, but the author may be a generator that cannot see the
    // result — a page that quietly lost its <svg> icons or a whole <form> must
    // not look like a clean publish.
    //
    // Non-fatal by design: the removal is the correct outcome, the owner just
    // needs to know it happened.
    errors.push({
      code: "content_removed",
      message: `A <${tag}> element was removed — that tag is not allowed on a published page.`,
    })
    return []
  }

  // Anything inside an <svg> that is not in SVG_TAGS is a foreign-content
  // element (foreignObject, use, animate, ...) and is removed WITH its subtree
  // rather than unwrapped — unwrapping <foreignObject> would splice raw HTML
  // into the drawing, which is the thing that made svg unsafe to begin with.
  //
  // It warns for the same reason DROPPED_TAGS does (ed8bbfdc): an author that
  // cannot see the result must not be told a page published cleanly when part
  // of its markup was thrown away.
  if (inSvg && !SVG_TAGS.has(tag)) {
    errors.push({
      code: "content_removed",
      message: `A <${tag}> element inside an SVG was removed — only plain shape elements are allowed.`,
    })
    return []
  }

  const attrs = attrMap(node)

  // Islands short-circuit everything: their placeholder children are discarded.
  if (attrs[ISLAND_ATTR] !== undefined) {
    return convertIsland(attrs, errors)
  }

  const children = convertChildren(node.childNodes ?? [], errors, inSvg || tag === "svg")

  // SVG lives in its own allowlist with its own attribute set. A tag inside an
  // <svg> that is not in SVG_TAGS is dropped WITH its subtree rather than
  // unwrapped — unwrapping <foreignObject> would splice raw HTML into the
  // drawing, which is the thing that made svg unsafe in the first place.
  if (SVG_TAGS.has(tag)) {
    return [{ t: "el", tag, attrs: filterSvgAttrs(attrs), children }]
  }

  // Unknown tag: unwrap, keep the content.
  if (!ALLOWED_TAGS.has(tag)) return children

  if (tag === "iframe") {
    const src = attrs.src ? safeUrl(attrs.src) : undefined
    if (!src || !isAllowedIframeSrc(src)) {
      if (attrs.src) {
        errors.push({
          code: "iframe_host_not_allowed",
          message: `Embed from "${attrs.src}" was removed. Allowed hosts: ${ALLOWED_IFRAME_HOSTS.join(", ")}.`,
        })
      }
      return []
    }
  }

  return [{ t: "el", tag, attrs: filterAttrs(tag, attrs), children }]
}

/** Geometry and presentation only. No URL-valued attribute is permitted. */
function filterSvgAttrs(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [rawName, rawValue] of Object.entries(attrs)) {
    const name = rawName.toLowerCase()
    if (name.startsWith(RESERVED_ATTR_PREFIX)) continue
    if (name.startsWith("on")) continue
    if (name === "style") {
      const safe = safeStyle(rawValue)
      if (safe) out[name] = safe
      continue
    }
    if (!SVG_ATTRS.has(name) && !name.startsWith("aria-")) continue
    out[name] = rawValue
  }
  return out
}

function filterAttrs(tag: string, attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [rawName, rawValue] of Object.entries(attrs)) {
    const name = rawName.toLowerCase()

    if (name.startsWith(RESERVED_ATTR_PREFIX)) continue
    // `on*` handlers are excluded by the allowlist anyway; this is belt-and-braces
    // so a future allowlist edit can't accidentally readmit them.
    if (name.startsWith("on")) continue

    const isPassthrough =
      name.startsWith("aria-") || name.startsWith("data-") || ALLOWED_ATTRS.has(name)
    if (!isPassthrough) continue

    if (name === "href") {
      const safe = safeUrl(rawValue)
      if (safe) out[name] = safe
      continue
    }
    if (name === "src" || name === "poster") {
      const safe = safeUrl(rawValue, { allowDataImage: tag === "img" || name === "poster" })
      if (safe) out[name] = safe
      continue
    }
    if (name === "srcset") {
      // Every candidate must be safe or the whole attribute goes.
      const candidates = rawValue.split(",").map((c) => c.trim().split(/\s+/)[0])
      if (candidates.every((c) => safeUrl(c, { allowDataImage: true }))) out[name] = rawValue
      continue
    }
    if (name === "style") {
      const safe = safeStyle(rawValue)
      if (safe) out[name] = safe
      continue
    }
    out[name] = rawValue
  }

  // Applied after the loop, not inside it: attribute order is not guaranteed,
  // so setting rel while iterating can be clobbered by a later rel entry.
  if (out.target === "_blank") {
    const existing = out.rel ? `${out.rel} ` : ""
    const merged = `${existing}noopener noreferrer`
    out.rel = Array.from(new Set(merged.split(/\s+/).filter(Boolean))).join(" ")
  }

  return out
}

function convertIsland(attrs: Record<string, string>, errors: CompileError[]): FunnelNode[] {
  const name = attrs[ISLAND_ATTR]
  if (!isIslandName(name)) {
    errors.push({ code: "island_unknown", message: `Unknown element type "${name}".` })
    return []
  }

  let raw: unknown = {}
  const rawProps = attrs[ISLAND_PROPS_ATTR]
  if (rawProps !== undefined && rawProps.trim().length > 0) {
    try {
      raw = JSON.parse(rawProps)
    } catch {
      errors.push({
        code: "island_props_unparseable",
        message: `The "${name}" element's settings are corrupted and could not be read.`,
      })
      return []
    }
  }

  const parsed = parseIslandProps(name, raw)
  if (!parsed.ok) {
    errors.push({
      code: "island_props_invalid",
      message: `The "${name}" element is misconfigured — ${parsed.errors.join("; ")}.`,
    })
    return []
  }

  return [{ t: "island", name, props: parsed.props }]
}
