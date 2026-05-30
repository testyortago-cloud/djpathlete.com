// render-worker/src/lib/caption-paging.ts
// TWIN COPY of lib/content-studio/caption-paging.ts. The canonical, unit-tested
// copy lives under lib/; this duplicate exists because render-worker/ cannot
// import from the parent app's lib/ (see CLAUDE.md boundary). Keep the two in
// sync — if you change one, change the other.

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
