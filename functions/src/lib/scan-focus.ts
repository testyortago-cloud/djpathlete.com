// Focus topics for the weekly scan. A focus topic is a scan topic that is switched on and has keywords: the
// coach asked to go deep on it (Darren, 2026-10-30: "will that go into the depths of that topic?"), so its
// results are exempt from the per-theme limits that keep an ordinary brief broad.
//
// Reads the boxes (system_settings "blog_scan_topics") rather than a derived key, so topics saved before this
// existed count too. Imports nothing, so the root vitest can load it next to its twin.

export interface ScanTopicLike {
  name: string
  keywords: string[]
}

/**
 * TWIN of searchesFor in lib/blog/scan-topics.ts (functions/ cannot import lib/). The two must produce the same
 * strings, or a focus topic's searches are never recognised; __tests__/lib/blog/scan-focus-parity.test.ts pins it.
 */
export function searchesFor(topic: ScanTopicLike): string[] {
  const name = topic.name.trim()
  if (topic.keywords.length === 0) return [name]
  const suffix = /\bresearch\b/i.test(name) ? "" : " research"
  return topic.keywords.map((k) => `${name} ${k.trim()}${suffix}`)
}

/** The searches of every focus topic in a saved "blog_scan_topics" value. Anything malformed is skipped. */
export function focusQueriesFrom(saved: unknown): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(saved)) return out
  for (const t of saved) {
    if (!t || typeof t !== "object") continue
    const { name, keywords, active } = t as Record<string, unknown>
    if (active !== true || typeof name !== "string" || !Array.isArray(keywords) || keywords.length === 0) continue
    if (!keywords.every((k) => typeof k === "string")) continue
    for (const q of searchesFor({ name, keywords: keywords as string[] })) out.add(q)
  }
  return out
}
