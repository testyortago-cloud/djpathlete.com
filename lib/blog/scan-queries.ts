// Admin-editable weekly blog topic-scan queries.
// Stored in system_settings under BLOG_SCAN_QUERIES_KEY as a string[]. The
// Firebase weekly scanner (functions/src/tavily-trending-scan.ts) reads the same
// key and falls back to its own twin copy of these defaults when unset.
// IMPORTANT: keep this list identical to TRENDING_QUERIES in
// functions/src/tavily-trending-scan.ts — the two are manually kept in sync.

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
]
