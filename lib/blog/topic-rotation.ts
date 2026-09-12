// lib/blog/topic-rotation.ts
//
// Chooses WHICH queued topic suggestion the auto-blog cron writes next.
//
// WHY THIS EXISTS. The cron used to take the most recent week's rank 1, full
// stop. It fires twice a week against a scan that runs once a week, so in
// practice only ranks 1 and 2 were ever written and ranks 3-10 were never
// reached at all. When the ranker put a force-velocity paper at rank 1 four
// weeks running — which it did, on 2026-08-17, 08-31, 09-07 and at rank 2 on
// 08-24 and 09-14 — the blog got four near-identical force-velocity drafts, and
// no amount of breadth further down the brief could reach the page.
//
// So a better brief is necessary but not sufficient: the CONSUMER has to spend
// it. This module spends it by theme, not by rank alone.

import { stringSimilarity } from "string-similarity-js"
import { themeOf } from "@/lib/blog/topic-themes"

/**
 * Same bigram threshold as the scanner's candidate dedup
 * (functions/src/lib/research-candidates.ts). Duplicated rather than shared
 * because that file lives under functions/, which the Next.js runtime cannot
 * import from. If you retune one, retune both.
 */
const SIMILARITY_THRESHOLD = 0.55

/** How many recently-written posts define "a theme we just did". */
export const RECENT_THEME_WINDOW = 4

export interface RankableTopic {
  id: string
  title: string
  scheduled_for: string
  created_at: string
  rank: number | null
}

function byRankThenNewest(a: RankableTopic, b: RankableTopic): number {
  const ra = a.rank ?? 999
  const rb = b.rank ?? 999
  if (ra !== rb) return ra - rb
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

/**
 * Groups candidates by their target week, newest week first, each group sorted
 * by rank. Preference for the newest week is retained — a fresher brief is a
 * better brief — but older weeks stay reachable as a fallback so a single
 * single-theme week cannot stall the rotation.
 */
export function groupByWeek(candidates: RankableTopic[]): RankableTopic[][] {
  const weeks = new Map<string, RankableTopic[]>()
  for (const c of candidates) {
    const list = weeks.get(c.scheduled_for)
    if (list) list.push(c)
    else weeks.set(c.scheduled_for, [c])
  }
  return [...weeks.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([, list]) => list.sort(byRankThenNewest))
}

function nearDuplicate(title: string, recentTitles: string[]): boolean {
  return recentTitles.some((t) => stringSimilarity(title, t) >= SIMILARITY_THRESHOLD)
}

export interface PickResult {
  topic: RankableTopic
  /** Why this one — surfaced in the cron log so a odd choice is explainable. */
  reason: "fresh_theme" | "rank_order_fallback"
  theme: string
}

/**
 * Picks the next topic to write.
 *
 * Pass 1 — the highest-ranked topic, newest week first, whose theme is NOT
 * among the last RECENT_THEME_WINDOW posts and which does not near-duplicate a
 * recent title. This is the pass that actually rotates the blog.
 *
 * Pass 2 — if every queued topic belongs to a recently-used theme (a genuinely
 * narrow week, or a backlog that has drained), fall back to plain rank order
 * rather than writing nothing. Still skips outright near-duplicate titles: a
 * repeated THEME is acceptable, a repeated ARTICLE is not.
 *
 * Returns null only when there is nothing left that isn't a near-duplicate —
 * the caller treats that as "no topics" and skips the run.
 */
export function pickDiverseTopic(candidates: RankableTopic[], recentPostTitles: string[]): PickResult | null {
  if (candidates.length === 0) return null

  const recentThemes = new Set(recentPostTitles.slice(0, RECENT_THEME_WINDOW).map(themeOf))
  const weeks = groupByWeek(candidates)

  for (const week of weeks) {
    for (const topic of week) {
      const theme = themeOf(topic.title)
      if (recentThemes.has(theme)) continue
      if (nearDuplicate(topic.title, recentPostTitles)) continue
      return { topic, reason: "fresh_theme", theme }
    }
  }

  for (const week of weeks) {
    for (const topic of week) {
      if (nearDuplicate(topic.title, recentPostTitles)) continue
      return { topic, reason: "rank_order_fallback", theme: themeOf(topic.title) }
    }
  }

  return null
}
