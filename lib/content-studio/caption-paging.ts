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
}

export interface CaptionPage {
  text: string
  words: CaptionPageWord[]
  startMs: number
  endMs: number
}

const DEFAULT_MAX_WORDS_PER_PAGE = 3

export function pageCaptions(
  words: TranscriptWord[],
  opts: { maxWordsPerPage?: number } = {},
): CaptionPage[] {
  const maxWords = Math.max(1, opts.maxWordsPerPage ?? DEFAULT_MAX_WORDS_PER_PAGE)

  const clean = words
    .filter((w) => typeof w.text === "string" && w.text.trim().length > 0)
    .map<CaptionPageWord>((w) => ({
      text: w.text.trim(),
      startMs: w.start,
      endMs: Math.max(w.start, w.end), // clamp inverted ranges
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
