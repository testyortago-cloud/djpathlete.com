// lib/content-studio/caption-paging.ts
// Pure: AssemblyAI word list -> timed caption "pages" (<=N words each) for the
// word-pop overlay. No I/O. Twin-copied into render-worker/src/lib so the
// Cloud Run worker can use it without importing lib/ (see CLAUDE.md boundary).

export interface TranscriptWord {
  text: string
  start: number // ms
  end: number // ms
}

export interface CaptionPageWord {
  text: string
  startMs: number
  endMs: number
  emphasis: boolean
}

export interface CaptionPage {
  text: string
  words: CaptionPageWord[]
  startMs: number
  endMs: number
}

const DEFAULT_MAX_WORDS_PER_PAGE = 3

// Words worth visually emphasizing in captions (Hormozi-style keyword pop). Kept
// deliberately small; the visual aggressiveness is tuned in the composition.
const POWER_WORDS = new Set([
  "never", "always", "every", "best", "worst", "most", "key", "secret", "proven",
  "elite", "stop", "start", "must", "critical", "essential", "power", "strong",
  "fast", "faster", "explosive", "mistake", "truth", "results", "win", "change",
])

/** Should this caption word be visually emphasized? Numbers, ALL-CAPS, long
 *  content words (>=7 letters), or a small power-word list. Pure + deterministic. */
export function isEmphasisWord(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/\d/.test(t)) return true
  const letters = t.replace(/[^A-Za-z]/g, "")
  if (letters.length >= 2 && letters === letters.toUpperCase()) return true
  const word = letters.toLowerCase()
  if (word.length >= 7) return true
  return POWER_WORDS.has(word)
}

export function pageCaptions(
  words: TranscriptWord[],
  opts: { maxWordsPerPage?: number } = {},
): CaptionPage[] {
  // Guard against NaN/0/negative/fractional — Math.max(1, NaN) is NaN, which
  // would make slice() return [] and crash on group[0]. Fall back to the default.
  const requested = opts.maxWordsPerPage ?? DEFAULT_MAX_WORDS_PER_PAGE
  const maxWords =
    Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : DEFAULT_MAX_WORDS_PER_PAGE

  const clean = words
    .filter((w) => typeof w.text === "string" && w.text.trim().length > 0)
    .map<CaptionPageWord>((w) => ({
      text: w.text.trim(),
      startMs: w.start,
      endMs: Math.max(w.start, w.end), // clamp inverted ranges
      emphasis: isEmphasisWord(w.text),
    }))

  const pages: CaptionPage[] = []
  for (let i = 0; i < clean.length; i += maxWords) {
    const group = clean.slice(i, i + maxWords)
    pages.push({
      text: group.map((g) => g.text).join(" "),
      words: group,
      startMs: group[0].startMs,
      endMs: group[group.length - 1].endMs,
    })
  }
  return pages
}
