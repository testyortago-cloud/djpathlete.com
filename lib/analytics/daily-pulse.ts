// lib/analytics/daily-pulse.ts
// Composes the data + HTML for the Daily Brief email.
// Calls each section builder in parallel, hides null sections, and computes
// the "Today at a glance" summary line from whichever sections produced data.

import { createElement } from "react"
import { listSocialPosts } from "@/lib/db/social-posts"
import { listVideoUploads } from "@/lib/db/video-uploads"
import { getBlogPosts } from "@/lib/db/blog-posts"
import { listTopicSuggestions } from "@/lib/db/content-calendar"
import { DailyPulse } from "@/components/emails/DailyPulse"
import { buildDailyBookings } from "@/lib/analytics/sections/bookings"
import { buildDailyCoaching } from "@/lib/analytics/sections/coaching-daily"
import { buildDailyRevenueFunnel } from "@/lib/analytics/sections/revenue-funnel-daily"
import { buildDailyAnomalies } from "@/lib/analytics/sections/anomalies-daily"
import type { DailyBriefPayload, DailyContentPipelinePayload, DailyTrendingTopic } from "@/types/coach-emails"

async function renderEmail(element: React.ReactElement): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server")
  return renderToStaticMarkup(element)
}

export interface DailyPulseResult {
  subject: string
  html: string
  referenceDate: Date
  isMondayEdition: boolean
  payload: DailyBriefPayload
}

interface BuildOptions {
  referenceDate?: Date
  forceMonday?: boolean
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export async function buildDailyPulse(options: BuildOptions = {}): Promise<DailyPulseResult> {
  const referenceDate = options.referenceDate ?? new Date()
  const isMondayEdition = options.forceMonday === true || referenceDate.getDay() === 1

  // Fetch existing pipeline payload (always shown)
  const [socialPosts, videos, blogs] = await Promise.all([
    listSocialPosts(),
    listVideoUploads({ limit: 200 }),
    getBlogPosts(),
  ])
  const pipeline = computePipeline(socialPosts, videos, blogs, referenceDate)

  // New per-area builders, run in parallel. Each catches its own errors so a
  // bad section doesn't kill the email.
  const [bookings, coaching, revenueFunnel, trendingTopics] = await Promise.all([
    safe(() => buildDailyBookings({ referenceDate }), "bookings"),
    safe(() => buildDailyCoaching({ referenceDate }), "coaching"),
    safe(() => buildDailyRevenueFunnel({ referenceDate }), "revenueFunnel"),
    isMondayEdition ? loadTrendingTopics(referenceDate) : Promise.resolve<DailyTrendingTopic[]>([]),
  ])

  const anomalies = await safe(
    () => buildDailyAnomalies({ referenceDate, dailyFunnel: revenueFunnel ?? null }),
    "anomalies",
  )

  const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3050"
  const dashboardUrl = `${baseUrl}/admin/content`

  const dayLabel = referenceDate.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  })
  const subject = isMondayEdition ? `Weekly kick-off — ${dayLabel}` : `Daily Brief — ${dayLabel}`

  const payload: DailyBriefPayload = {
    referenceDate,
    isMondayEdition,
    bookings,
    coaching,
    pipeline,
    revenueFunnel,
    anomalies,
    trendingTopics,
    dashboardUrl,
  }

  const html = await renderEmail(createElement(DailyPulse, { payload }))
  return { subject, html, referenceDate, isMondayEdition, payload }
}

function computePipeline(
  socialPosts: Awaited<ReturnType<typeof listSocialPosts>>,
  videos: Awaited<ReturnType<typeof listVideoUploads>>,
  blogs: Awaited<ReturnType<typeof getBlogPosts>>,
  referenceDate: Date,
): DailyContentPipelinePayload {
  const awaitingReview = socialPosts.filter(
    (p) => p.approval_status === "draft" || p.approval_status === "edited",
  ).length
  const readyToPublish = socialPosts.filter(
    (p) =>
      (p.approval_status === "approved" || p.approval_status === "awaiting_connection") &&
      !p.scheduled_at && !p.published_at,
  ).length
  const startOfDay = new Date(referenceDate)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(referenceDate)
  endOfDay.setHours(23, 59, 59, 999)
  const scheduledToday = socialPosts.filter((p) => {
    if (!p.scheduled_at) return false
    const when = new Date(p.scheduled_at)
    return when >= startOfDay && when <= endOfDay
  }).length
  const videosAwaitingTranscription = videos.filter((v) => v.status === "uploaded").length
  const blogsInDraft = blogs.filter((b) => b.status === "draft").length
  return { awaitingReview, readyToPublish, scheduledToday, videosAwaitingTranscription, blogsInDraft }
}

async function loadTrendingTopics(referenceDate: Date): Promise<DailyTrendingTopic[]> {
  const suggestions = await listTopicSuggestions()
  const since = new Date(referenceDate.getTime() - SEVEN_DAYS_MS)
  const recent = suggestions.filter((s) => new Date(s.created_at) >= since)
  recent.sort((a, b) => {
    const rankA = typeof a.metadata?.rank === "number" ? (a.metadata.rank as number) : 999
    const rankB = typeof b.metadata?.rank === "number" ? (b.metadata.rank as number) : 999
    if (rankA !== rankB) return rankA - rankB
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
  return recent.slice(0, 5).map((entry) => ({
    title: entry.title,
    summary: typeof entry.metadata?.summary === "string" ? (entry.metadata.summary as string) : "",
    sourceUrl: typeof entry.metadata?.tavily_url === "string" ? (entry.metadata.tavily_url as string) : null,
  }))
}

async function safe<T>(fn: () => Promise<T>, name: string): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    console.error(`[daily-pulse] section "${name}" failed:`, err)
    return null
  }
}
