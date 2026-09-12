// Shared helpers for turning raw Tavily search results into a clean, ranked,
// deduped candidate list — used by both the weekly trending scan
// (tavily-trending-scan.ts) and the on-demand single-topic scan
// (topic-research-scan.ts). Kept dependency-free of both handlers so neither
// imports from the other.

import { stringSimilarity } from "string-similarity-js"

export interface TavilySearchResult {
  title: string
  url: string
  content: string
  /** Present only when the caller asked Tavily for include_published_date. */
  published_date?: string
}

export interface DedupableResult {
  title: string
  url: string
}

// Calibrated against the real duplicate pair that motivated this fix: two
// syndicated titles for the same hamstring-force-production study scored
// 0.632 with string-similarity-js (the same bigram-similarity library already
// used for fuzzy exercise/client-name matching elsewhere in functions/), while
// unrelated topic pairs scored 0.29-0.38. 0.55 sits cleanly between the two.
const SIMILARITY_THRESHOLD = 0.55

/**
 * True if `candidate` is an exact-URL repeat of something already seen, or a
 * near-duplicate title of a result already accepted (the same finding
 * re-published under a different URL/domain).
 */
export function isDuplicate<T extends DedupableResult>(candidate: T, seenUrls: Set<string>, accepted: T[]): boolean {
  if (seenUrls.has(candidate.url)) return true
  return accepted.some((existing) => stringSimilarity(candidate.title, existing.title) >= SIMILARITY_THRESHOLD)
}

/**
 * Collects up to `maxResults` unique, non-near-duplicate candidates from
 * multiple Tavily search result sets, round-robin (one per query per pass)
 * rather than draining the first query before touching the rest. Without
 * this, a handful of overlapping queries can fill the cap before more
 * distinct queries ever contribute — silently defeating any attempt to
 * diversify the query set.
 */
export function collectDiverseResults(
  searches: Array<{ results: Array<{ title: string; url: string; content: string; published_date?: string }> }>,
  maxResults: number,
): TavilySearchResult[] {
  const seenUrls = new Set<string>()
  const collected: TavilySearchResult[] = []
  const maxRounds = Math.max(0, ...searches.map((s) => s.results.length))

  roundLoop: for (let round = 0; round < maxRounds; round++) {
    for (const search of searches) {
      const r = search.results[round]
      if (!r) continue
      if (isDuplicate(r, seenUrls, collected)) continue
      seenUrls.add(r.url)
      collected.push({ title: r.title, url: r.url, content: r.content, published_date: r.published_date })
      if (collected.length >= maxResults) break roundLoop
    }
  }

  return collected
}

/**
 * Overwrites each topic's `rank` with its 1-based position after sorting by
 * the input rank. The ranking LLM assigns rank independently per topic, so
 * nothing stops it from giving two topics the same rank — this guarantees a
 * unique, sequential rank regardless of what the model returned.
 */
export function reassignSequentialRanks<T extends { rank: number }>(topics: T[]): T[] {
  return [...topics].sort((a, b) => a.rank - b.rank).map((t, i) => ({ ...t, rank: i + 1 }))
}

/**
 * Drops candidates that near-duplicate something ALREADY COVERED in a previous
 * week — a prior `content_calendar` topic suggestion or an existing blog post.
 *
 * `collectDiverseResults` above dedupes only WITHIN one run, which is why the
 * same force-velocity meta-analysis could be rank 1 on 2026-08-17, 2026-08-31
 * and 2026-09-07, and why "RMSSD Coefficient of Variation ..." was written
 * twice. Same bigram threshold as the in-batch check, for the same reason: it
 * separates re-publications of one finding (~0.63) from unrelated topics
 * (0.29-0.38).
 *
 * Titles are compared, not URLs — the repeat is usually a different URL for the
 * same study, and by the time it reaches us the wording has drifted.
 */
export function dropCovered<T>(
  items: T[],
  coveredTitles: string[],
  titleOf: (item: T) => string,
  threshold: number = SIMILARITY_THRESHOLD,
): T[] {
  if (coveredTitles.length === 0) return items
  return items.filter((item) => {
    const title = titleOf(item)
    if (!title) return true
    return !coveredTitles.some((covered) => stringSimilarity(title, covered) >= threshold)
  })
}
