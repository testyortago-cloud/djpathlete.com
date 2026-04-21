// lib/analytics/content.ts
// Computes ContentMetrics from blog_posts + newsletters + active subscriber
// count. Called from app/(admin)/admin/analytics/page.tsx (server component).

import type { BlogPost, Newsletter } from "@/types/database"
import type { DateRange, ContentMetrics } from "@/types/analytics"
import { getMonthsInRange, getMonthKey, inRange, capitalize } from "./compute"

const FACT_CHECK_STATUSES = ["pending", "passed", "flagged", "failed"] as const

export function computeContentMetrics(
  blogs: BlogPost[],
  newsletters: Newsletter[],
  activeSubscribers: number,
  range: DateRange,
  previousRange: DateRange | null,
): ContentMetrics {
  const months = getMonthsInRange(range)

  const inRangeBlogs = blogs.filter((b) => inRange(b.created_at, range))
  const inRangePublishedBlogs = blogs.filter((b) => b.published_at && inRange(b.published_at, range))
  const inRangeNewslettersSent = newsletters.filter((n) => n.sent_at && inRange(n.sent_at, range))

  const previousCreated = previousRange ? blogs.filter((b) => inRange(b.created_at, previousRange)).length : 0
  const previousPublished = previousRange
    ? blogs.filter((b) => b.published_at && inRange(b.published_at, previousRange)).length
    : 0

  // Monthly bucket — drafts created vs. published, in the selected range only.
  const blogsByMonth = months.map((m) => ({ ...m, drafts: 0, published: 0 }))
  const monthMap = new Map(blogsByMonth.map((m) => [m.key, m]))
  for (const b of inRangeBlogs) {
    const entry = monthMap.get(getMonthKey(new Date(b.created_at)))
    if (entry) entry.drafts += 1
  }
  for (const b of inRangePublishedBlogs) {
    if (!b.published_at) continue
    const entry = monthMap.get(getMonthKey(new Date(b.published_at)))
    if (entry) entry.published += 1
  }

  // Category breakdown — uses published blogs in range.
  const byCategory = new Map<string, number>()
  for (const b of inRangePublishedBlogs) {
    byCategory.set(b.category, (byCategory.get(b.category) ?? 0) + 1)
  }
  const blogsByCategory = Array.from(byCategory.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)

  // Fact-check status breakdown — blogs created in range that went through
  // the fact-check pipeline (nullable → skipped).
  const byFactCheck = new Map<string, number>()
  for (const s of FACT_CHECK_STATUSES) byFactCheck.set(s, 0)
  for (const b of inRangeBlogs) {
    if (!b.fact_check_status) continue
    byFactCheck.set(b.fact_check_status, (byFactCheck.get(b.fact_check_status) ?? 0) + 1)
  }
  const blogsByFactCheckStatus = Array.from(byFactCheck.entries())
    .filter(([, count]) => count > 0)
    .map(([label, count]) => ({ label: capitalize(label), count }))
    .sort((a, b) => b.count - a.count)

  // Recent publishes — last 10 blogs published in range, newest first.
  const recentPublishes = inRangePublishedBlogs
    .slice()
    .sort((a, b) => {
      const ad = a.published_at ? new Date(a.published_at).getTime() : 0
      const bd = b.published_at ? new Date(b.published_at).getTime() : 0
      return bd - ad
    })
    .slice(0, 10)
    .map((b) => ({
      id: b.id,
      title: b.title,
      status: b.status,
      category: b.category,
      published_at: b.published_at,
      created_at: b.created_at,
    }))

  return {
    blogsCreated: inRangeBlogs.length,
    previousBlogsCreated: previousCreated,
    blogsPublished: inRangePublishedBlogs.length,
    previousBlogsPublished: previousPublished,
    newslettersSent: inRangeNewslettersSent.length,
    activeSubscribers,
    blogsByMonth,
    blogsByCategory,
    blogsByFactCheckStatus,
    recentPublishes,
  }
}
