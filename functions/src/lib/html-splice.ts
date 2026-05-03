export const MIN_SECTION_WORDS = 150
const MAX_INLINE_IMAGES = 3

export interface QualifyingSection {
  h2Text: string
  h2OuterStart: number  // index of "<" in "<h2>"
  h2OuterEnd: number    // index just after the closing ">" of "</h2>"
}

export interface InlineImageInsert {
  h2Text: string
  url: string
  alt: string
  width: number
  height: number
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ")
}

function wordCount(text: string): number {
  const stripped = stripTags(text).trim()
  if (!stripped) return 0
  return stripped.split(/\s+/).length
}

/**
 * Returns up to MAX_INLINE_IMAGES h2 sections whose following content
 * (until the next h2 or end of string) contains at least MIN_SECTION_WORDS words.
 */
export function findQualifyingSections(html: string): QualifyingSection[] {
  const h2Regex = /<h2[^>]*>([\s\S]*?)<\/h2>/g
  const matches: { start: number; end: number; text: string }[] = []
  let m: RegExpExecArray | null
  while ((m = h2Regex.exec(html)) !== null) {
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      text: m[1].trim(),
    })
  }

  const out: QualifyingSection[] = []
  for (let i = 0; i < matches.length && out.length < MAX_INLINE_IMAGES; i++) {
    const cur = matches[i]
    const nextStart = matches[i + 1]?.start ?? html.length
    const sectionContent = html.slice(cur.end, nextStart)
    if (wordCount(sectionContent) >= MIN_SECTION_WORDS) {
      out.push({
        h2Text: stripTags(cur.text).trim(),
        h2OuterStart: cur.start,
        h2OuterEnd: cur.end,
      })
    }
  }
  return out
}

/**
 * Splice inline <img> tags into html, immediately after each matching h2.
 * Idempotent: skips insertion if an <img> with the same src already follows the h2.
 */
export function spliceInlineImages(html: string, images: InlineImageInsert[]): string {
  if (images.length === 0) return html

  // Process in reverse order (highest index first) so earlier indices don't shift
  const sections = findQualifyingSections(html)
  const inserts: { idx: number; tag: string }[] = []

  for (const img of images) {
    const section = sections.find((s) => s.h2Text === img.h2Text)
    if (!section) continue

    // Idempotency check: look at the next ~200 chars after the </h2>
    const lookahead = html.slice(section.h2OuterEnd, section.h2OuterEnd + 400)
    if (lookahead.includes(img.url)) continue

    const tag = `<img src="${htmlEscape(img.url)}" alt="${htmlEscape(img.alt)}" loading="lazy" width="${img.width}" height="${img.height}">`
    inserts.push({ idx: section.h2OuterEnd, tag })
  }

  inserts.sort((a, b) => b.idx - a.idx)
  let result = html
  for (const ins of inserts) {
    result = result.slice(0, ins.idx) + ins.tag + result.slice(ins.idx)
  }
  return result
}

// ─── injectAnchorIds + extractH2Toc ────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
}

/**
 * Adds `id="<slug>"` to every <h2> that doesn't already have an id.
 * Slugifies the inner text. Dedupes by appending "-2", "-3", ... when
 * multiple headings would share the same slug.
 */
export function injectAnchorIds(html: string): string {
  const used = new Set<string>()
  return html.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/g, (full, attrs, inner) => {
    const existing = (attrs ?? "").match(/\sid\s*=\s*"[^"]*"/i)
    if (existing) return full

    const baseSlug = slugify(inner)
    if (!baseSlug) return full
    let slug = baseSlug
    let n = 2
    while (used.has(slug)) {
      slug = `${baseSlug}-${n++}`
    }
    used.add(slug)
    const newAttrs = attrs ? ` id="${slug}"${attrs}` : ` id="${slug}"`
    return `<h2${newAttrs}>${inner}</h2>`
  })
}

export interface TocEntry {
  id: string
  text: string
}

/**
 * Extracts an ordered list of { id, text } from h2s that already have
 * `id` attributes. Inline tags inside the heading are stripped.
 */
export function extractH2Toc(html: string): TocEntry[] {
  const result: TocEntry[] = []
  const regex = /<h2\s+([^>]*)>([\s\S]*?)<\/h2>/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(html)) !== null) {
    const idMatch = m[1].match(/\bid\s*=\s*"([^"]+)"/i)
    if (!idMatch) continue
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    if (!text) continue
    result.push({ id: idMatch[1], text })
  }
  return result
}

// ─── spliceInternalLinks ───────────────────────────────────────────────────

const MAX_INTERNAL_LINKS_PER_POST = 3

export interface InternalLinkInsert {
  slug: string
  anchor_text: string
  section_h2: string
}

/**
 * Wraps the FIRST occurrence of `anchor_text` (case-insensitive, word-bounded)
 * inside the section identified by `section_h2` with `<a href="/blog/{slug}">`.
 *
 * Rules:
 * - Caps at MAX_INTERNAL_LINKS_PER_POST inserts; subsequent inserts are dropped.
 * - Skips silently when section_h2 is not found.
 * - Skips silently when anchor_text is not found in the section.
 * - Skips when anchor_text is already inside an <a> tag (no nesting).
 * - Matches case-insensitively but preserves the original casing in the link text.
 * - Section header text is matched after stripping inline tags.
 */
export function spliceInternalLinks(html: string, inserts: InternalLinkInsert[]): string {
  if (inserts.length === 0) return html

  let result = html
  let applied = 0

  for (const insert of inserts) {
    if (applied >= MAX_INTERNAL_LINKS_PER_POST) break

    const sectionBounds = findSectionBounds(result, insert.section_h2)
    if (!sectionBounds) continue

    const { contentStart, contentEnd } = sectionBounds
    const sectionHtml = result.slice(contentStart, contentEnd)

    const escaped = escapeRegex(insert.anchor_text)
    const matchRegex = new RegExp(`\\b${escaped}\\b`, "i")
    const match = matchRegex.exec(sectionHtml)
    if (!match) continue

    const matchStart = match.index
    const matchEnd = matchStart + match[0].length

    if (isInsideAnchor(sectionHtml, matchStart)) continue

    const matchedText = sectionHtml.slice(matchStart, matchEnd)
    const wrapped = `<a href="/blog/${insert.slug}">${matchedText}</a>`
    const newSectionHtml =
      sectionHtml.slice(0, matchStart) + wrapped + sectionHtml.slice(matchEnd)

    result = result.slice(0, contentStart) + newSectionHtml + result.slice(contentEnd)
    applied++
  }

  return result
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

interface SectionBounds {
  contentStart: number
  contentEnd: number
}

function findSectionBounds(html: string, sectionH2Text: string): SectionBounds | null {
  const target = sectionH2Text.replace(/\s+/g, " ").trim().toLowerCase()
  const h2Regex = /<h2(?:\s[^>]*)?>([\s\S]*?)<\/h2>/g
  let m: RegExpExecArray | null
  while ((m = h2Regex.exec(html)) !== null) {
    const stripped = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase()
    if (stripped === target) {
      const contentStart = m.index + m[0].length
      const nextH2 = html.indexOf("<h2", contentStart)
      const contentEnd = nextH2 === -1 ? html.length : nextH2
      return { contentStart, contentEnd }
    }
  }
  return null
}

function isInsideAnchor(html: string, position: number): boolean {
  const before = html.slice(0, position).toLowerCase()
  const lastOpen = before.lastIndexOf("<a")
  const lastClose = before.lastIndexOf("</a>")
  if (lastOpen === -1) return false
  if (lastClose === -1) return true
  return lastOpen > lastClose
}
