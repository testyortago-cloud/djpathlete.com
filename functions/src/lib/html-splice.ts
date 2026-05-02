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
