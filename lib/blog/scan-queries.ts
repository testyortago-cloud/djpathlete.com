// Admin-editable weekly blog topic-scan queries.
// Stored in system_settings under BLOG_SCAN_QUERIES_KEY as a string[]. The
// Firebase weekly scanner (functions/src/tavily-trending-scan.ts) reads the same
// key and falls back to its own twin copy of these defaults when unset.

export const BLOG_SCAN_QUERIES_KEY = "blog_scan_queries"

export const DEFAULT_BLOG_SCAN_QUERIES: string[] = [
  "peer-reviewed sport science research athletic performance 2026",
  "velocity-based training force-velocity profiling strength research",
  "athlete monitoring HRV acute chronic workload ratio research",
  "plyometrics rate of force development eccentric overload meta-analysis",
  "long-term athletic development youth LTAD coaching research",
  "applied sport science elite athlete performance preparation case study",
]
