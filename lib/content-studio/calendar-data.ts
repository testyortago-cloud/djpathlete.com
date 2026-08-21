import { listSocialPostsForPipeline, type PipelinePostRow } from "@/lib/db/social-posts"
import { listCalendarEntries } from "@/lib/db/content-calendar"
import { getBlogPosts } from "@/lib/db/blog-posts"
import { getNewsletters } from "@/lib/db/newsletters"
import { postToChip, entryToChip, blogToChip, newsletterToChip, type CalendarChip } from "./calendar-chips"

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
  const [posts, entries, blogPosts, newsletters] = await Promise.all([
    listSocialPostsForPipeline(),
    listCalendarEntries({ from_date: window.from, to_date: isoDayAfter(window.to) }),
    getBlogPosts(),
    getNewsletters(),
  ])

  const fromTs = new Date(`${window.from}T00:00:00Z`).getTime()
  const toTs = new Date(`${window.to}T23:59:59.999Z`).getTime()
  const inWindow = (ref: string | null) => {
    if (!ref) return false
    const t = new Date(ref).getTime()
    return t >= fromTs && t <= toTs
  }

  const windowPosts = posts.filter((p) => inWindow(p.scheduled_at ?? p.published_at))
  const windowBlogPosts = blogPosts.filter((p) => inWindow(p.scheduled_at ?? p.published_at))
  const windowNewsletters = newsletters.filter((n) => inWindow(n.scheduled_at ?? n.sent_at))

  const unscheduledPosts = posts.filter((p) => p.approval_status === "approved" && !p.scheduled_at)

  const postChips = windowPosts.map((p) => postToChip(p, p.source_video_filename))
  const entryChips = entries.map(entryToChip)
  const blogChips = windowBlogPosts.map(blogToChip)
  const newsletterChips = windowNewsletters.map(newsletterToChip)
  const chips = [...postChips, ...entryChips, ...blogChips, ...newsletterChips]

  const seen = new Map<string, string>()
  for (const p of unscheduledPosts) {
    if (p.source_video_id && p.source_video_filename && !seen.has(p.source_video_id)) {
      seen.set(p.source_video_id, p.source_video_filename)
    }
  }
  const unscheduledSourceVideos = Array.from(seen, ([id, filename]) => ({ id, filename }))

  return { chips, unscheduledPosts, unscheduledSourceVideos }
}
