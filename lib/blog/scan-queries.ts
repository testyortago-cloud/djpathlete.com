// Admin-editable weekly blog topic-scan queries.
// Stored in system_settings under BLOG_SCAN_QUERIES_KEY as a string[]. The
// Firebase weekly scanner (functions/src/tavily-trending-scan.ts) reads the same
// key and falls back to its own twin copy of these defaults when unset.
// IMPORTANT: keep this list identical to TRENDING_QUERIES in
// functions/src/tavily-trending-scan.ts — the two are manually kept in sync.
// __tests__/lib/blog/scan-queries-twin.test.ts fails if they drift.//
// THE SET IS DELIBERATELY BROAD AND DELIBERATELY UNWEIGHTED. Every query here
// buys one theme's worth of candidates; the per-theme cap in the scanner
// (MAX_CANDIDATES_PER_THEME) is what stops any of them dominating. Narrowing
// this list narrows the blog — the production override on 2026-09-12 had nine
// queries with no nutrition, psychology, female-athlete or skill-acquisition
// entry at all, and the blog it produced was correspondingly all biomechanics.

export const BLOG_SCAN_QUERIES_KEY = "blog_scan_queries"

export const DEFAULT_BLOG_SCAN_QUERIES: string[] = [
  "peer-reviewed sport science research athletic performance 2026",
  "velocity-based training force-velocity profiling strength research",
  "athlete monitoring HRV acute chronic workload ratio research",
  "long-term athletic development youth LTAD coaching research",
  "applied sport science elite athlete performance preparation case study",
  "return to play injury prevention rehabilitation sport science research",
  "sport psychology mental performance readiness athlete research",
  "sports nutrition fueling recovery performance research athletes",
  "change of direction agility deceleration braking sport performance research",
  "sprint acceleration speed mechanics development research",
  "energy system conditioning aerobic capacity team-sport athlete research",
  "resistance training periodization programming strength athletes research",
  "athlete sleep recovery intervention performance research",
  "female athlete performance training menstrual cycle research",
  "masters athlete ageing performance training research",
  "coaching practice skill acquisition motor learning sport research",
]
