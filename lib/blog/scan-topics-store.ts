// Reads and writes of the weekly scan topics (system_settings). Server only; the pure rules are in
// lib/blog/scan-topics.ts.
import { z } from "zod"
import { getSetting, setSettings } from "@/lib/db/system-settings"
import { BLOG_SCAN_QUERIES_KEY, DEFAULT_BLOG_SCAN_QUERIES } from "@/lib/blog/scan-queries"
import {
  BLOG_SCAN_TOPICS_KEY,
  scanQueriesFrom,
  scanTopicSchema,
  topicsFromQueries,
  withTopicAdded,
  type AddResult,
  type ScanTopic,
} from "@/lib/blog/scan-topics"

/** The saved boxes, or, before the first save, boxes built from the old one-search-per-line list. */
export async function getScanTopics(): Promise<ScanTopic[]> {
  const saved = z.array(scanTopicSchema).safeParse(await getSetting<unknown>(BLOG_SCAN_TOPICS_KEY, null))
  if (saved.success && saved.data.length > 0) return saved.data
  return topicsFromQueries(await getSetting<string[]>(BLOG_SCAN_QUERIES_KEY, DEFAULT_BLOG_SCAN_QUERIES))
}

/** Saves the boxes and the scan's searches in one write, so the two never disagree. */
export async function saveScanTopics(topics: ScanTopic[], userId: string | null): Promise<void> {
  await setSettings({ [BLOG_SCAN_TOPICS_KEY]: topics, [BLOG_SCAN_QUERIES_KEY]: scanQueriesFrom(topics) }, userId)
}

// ponytail: read-modify-write with no lock; two admins adding at the same instant can lose one add.
export async function addScanTopic(
  name: string,
  origin: NonNullable<ScanTopic["origin"]>,
  userId: string | null,
): Promise<AddResult> {
  const before = await getScanTopics()
  const { topics, result } = withTopicAdded(before, name, origin)
  if (result !== "full" && JSON.stringify(topics) !== JSON.stringify(before)) await saveScanTopics(topics, userId)
  return result
}
