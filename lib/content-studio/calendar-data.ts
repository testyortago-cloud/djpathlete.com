import { listSocialPostsForPipeline, type PipelinePostRow } from "@/lib/db/social-posts"
import { listCalendarEntries } from "@/lib/db/content-calendar"
import { postToChip, entryToChip, type CalendarChip } from "./calendar-chips"

export interface CalendarWindow {
  from: string // ISO YYYY-MM-DD
  to: string // ISO YYYY-MM-DD, inclusive
}

export interface CalendarData {
  chips: CalendarChip[]
  unscheduledPosts: PipelinePostRow[]
  /** Distinct source-video ids present in the unscheduled list, for filter options. */
  unscheduledSourceVideos: { id: string; filename: string }[]
}

function isoDayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export async function getCalendarData(window: CalendarWindow): Promise<CalendarData> {
  const [posts, entries] = await Promise.all([
    listSocialPostsForPipeline(),
    listCalendarEntries({ from_date: window.from, to_date: isoDayAfter(window.to) }),
  ])

  const fromTs = new Date(`${window.from}T00:00:00Z`).getTime()
  const toTs = new Date(`${window.to}T23:59:59.999Z`).getTime()

  const windowPosts = posts.filter((p) => {
    const ref = p.scheduled_at ?? p.published_at
    if (!ref) return false
    const t = new Date(ref).getTime()
    return t >= fromTs && t <= toTs
  })

  const unscheduledPosts = posts.filter(
    (p) => p.approval_status === "approved" && !p.scheduled_at,
  )

  const postChips = windowPosts.map((p) => postToChip(p, p.source_video_filename))
  const entryChips = entries.map(entryToChip)
  const chips = [...postChips, ...entryChips]

  const seen = new Map<string, string>()
  for (const p of unscheduledPosts) {
    if (p.source_video_id && p.source_video_filename && !seen.has(p.source_video_id)) {
      seen.set(p.source_video_id, p.source_video_filename)
    }
  }
  const unscheduledSourceVideos = Array.from(seen, ([id, filename]) => ({ id, filename }))

  return { chips, unscheduledPosts, unscheduledSourceVideos }
}
