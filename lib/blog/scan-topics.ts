// Weekly scan topics: the boxes on /admin/topic-suggestions. The Monday scan searches every topic that is
// on; a topic switched off is kept, so it can come back without being typed again (Darren, 2026-10-30:
// "there might be weeks when I want to put that back in").
//
// Stored in system_settings under BLOG_SCAN_TOPICS_KEY. Saving also writes BLOG_SCAN_QUERIES_KEY, the
// searches of the topics that are on: that is what the Firebase scan reads (getScanQueries in
// functions/src/tavily-trending-scan.ts), so the scan itself did not change. saveScanTopics
// (lib/blog/scan-topics-store.ts) is the only writer of either key.
// This file is pure (the topic boxes' editor imports it in the browser); the reads and writes are in
// lib/blog/scan-topics-store.ts.
import { z } from "zod"

export const BLOG_SCAN_TOPICS_KEY = "blog_scan_topics"

/** The scan runs one web search per query; this was already the limit on the old list. */
export const MAX_SCAN_SEARCHES = 20
export const MAX_SCAN_TOPICS = 60

export const scanTopicSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(3).max(300),
  keywords: z.array(z.string().trim().min(2).max(80)).max(8),
  active: z.boolean(),
  /** Where it came from when it was not typed into the box itself. */
  origin: z.enum(["research", "manual"]).optional(),
})

export type ScanTopic = z.infer<typeof scanTopicSchema>

/**
 * The searches for one topic: its name, or one search per keyword so a focus topic goes deeper. "research"
 * is appended unless the name already says it, as every built-in query does, to lean toward studies.
 */
export function searchesFor(topic: Pick<ScanTopic, "name" | "keywords">): string[] {
  const name = topic.name.trim()
  if (topic.keywords.length === 0) return [name]
  const suffix = /\bresearch\b/i.test(name) ? "" : " research"
  return topic.keywords.map((k) => `${name} ${k.trim()}${suffix}`)
}

/** What the scan searches: every topic that is on, each search once. */
export function scanQueriesFrom(topics: readonly ScanTopic[]): string[] {
  return [...new Set(topics.filter((t) => t.active).flatMap(searchesFor))]
}

/**
 * Why a list cannot be saved, or null. With nothing on, the scan would silently fall back to its
 * built-in defaults, so "everything off" is refused rather than saved.
 */
export function searchCountProblem(topics: readonly ScanTopic[]): string | null {
  const n = scanQueriesFrom(topics).length
  if (n === 0) return "Switch at least one topic on"
  if (n > MAX_SCAN_SEARCHES)
    return `${n} searches are switched on; the weekly scan runs at most ${MAX_SCAN_SEARCHES}. Switch a topic off or remove a keyword.`
  return null
}

/** The boxes for a list saved before topics existed: one per line, named by the line, switched on. */
export function topicsFromQueries(queries: readonly string[]): ScanTopic[] {
  return queries.map((q, i) => ({ id: `q${i + 1}`, name: q, keywords: [], active: true }))
}

export type AddResult = "on" | "off" | "full"

/**
 * Adds a researched subject or a suggested title as a topic, or switches the existing one with that name on.
 * "off": added (or left) switched off because the searches are used up. "full": not added, no room.
 */
export function withTopicAdded(
  topics: readonly ScanTopic[],
  name: string,
  origin: NonNullable<ScanTopic["origin"]>,
): { topics: ScanTopic[]; result: AddResult } {
  const fits = (list: readonly ScanTopic[]) => scanQueriesFrom(list).length <= MAX_SCAN_SEARCHES
  const key = name.trim().toLowerCase()
  const existing = topics.find((t) => t.name.trim().toLowerCase() === key)
  if (existing) {
    if (existing.active) return { topics: [...topics], result: "on" }
    const next = topics.map((t) => (t === existing ? { ...t, active: true } : t))
    return fits(next) ? { topics: next, result: "on" } : { topics: [...topics], result: "off" }
  }
  if (topics.length >= MAX_SCAN_TOPICS) return { topics: [...topics], result: "full" }
  const added: ScanTopic = { id: crypto.randomUUID(), name: name.trim(), keywords: [], active: true, origin }
  return fits([...topics, added])
    ? { topics: [...topics, added], result: "on" }
    : { topics: [...topics, { ...added, active: false }], result: "off" }
}

/** The sentence a coach sees about the scan topic that an added card also created. */
export function scanTopicNote(result: AddResult | null | undefined): string {
  if (result === "on") return "It is also on in your weekly scan topics."
  if (result === "off")
    return `It is in your weekly scan topics, switched off: all ${MAX_SCAN_SEARCHES} searches are in use.`
  if (result === "full") return "Your weekly scan topics are full, so it was not added there."
  return "It could not be added to your weekly scan topics."
}

/**
 * The Monday the weekly scan dates its cards with: the next Monday after `from` (a Monday gives the one a
 * week later). Researched and suggested cards use it too, so they sit in the same week's brief.
 * TWIN: nextMondayISO in functions/src/tavily-trending-scan.ts (functions/ cannot import lib/).
 */
export function nextMondayISO(from: Date): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const day = d.getUTCDay() // 0 = Sunday, 1 = Monday, ...
  d.setUTCDate(d.getUTCDate() + (day === 0 ? 1 : 8 - day))
  return d.toISOString().slice(0, 10)
}
