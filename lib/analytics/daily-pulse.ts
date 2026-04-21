// lib/analytics/daily-pulse.ts
// Composes the data + HTML for the Daily Pulse email.
// Called by /api/admin/internal/send-daily-pulse.

import { createElement } from "react"
import { listSocialPosts } from "@/lib/db/social-posts"
import { listVideoUploads } from "@/lib/db/video-uploads"
import { getBlogPosts } from "@/lib/db/blog-posts"
import { listTopicSuggestions } from "@/lib/db/content-calendar"
import { DailyPulse, type DailyPulsePipeline, type DailyPulseTrendingTopic } from "@/components/emails/DailyPulse"

async function renderEmail(element: React.ReactElement): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server")
  return renderToStaticMarkup(element)
}

export interface DailyPulseResult {
  subject: string
  html: string
  referenceDate: Date
  isMondayEdition: boolean
  pipeline: DailyPulsePipeline
  trendingTopics: DailyPulseTrendingTopic[]
}

interface BuildOptions {
  referenceDate?: Date
  forceMonday?: boolean
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export async function buildDailyPulse(options: BuildOptions = {}): Promise<DailyPulseResult> {
  const referenceDate = options.referenceDate ?? new Date()
  const isMondayEdition = options.forceMonday === true || referenceDate.getDay() === 1

  const [socialPosts, videoUploads, blogs] = await Promise.all([
    listSocialPosts(),
    listVideoUploads({ limit: 200 }),
    getBlogPosts(),
  ])

  const pipeline = computePipeline(socialPosts, videoUploads, blogs, referenceDate)

  const trendingTopics = isMondayEdition ? await loadTrendingTopics(referenceDate) : []

  const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3050"
  const dashboardUrl = `${baseUrl}/admin/content`

  const dayLabel = referenceDate.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
  const subject = isMondayEdition ? `Weekly kick-off — ${dayLabel}` : `Daily Pulse — ${dayLabel}`

  const html = await renderEmail(
    createElement(DailyPulse, {
      referenceDate,
      pipeline,
      trendingTopics,
      dashboardUrl,
    }),
  )

  return { subject, html, referenceDate, isMondayEdition, pipeline, trendingTopics }
}

function computePipeline(
  socialPosts: Awaited<ReturnType<typeof listSocialPosts>>,
  videos: Awaited<ReturnType<typeof listVideoUploads>>,
  blogs: Awaited<ReturnType<typeof getBlogPosts>>,
  referenceDate: Date,
): DailyPulsePipeline {
  const awaitingReview = socialPosts.filter(
    (p) => p.approval_status === "draft" || p.approval_status === "edited",
  ).length

  const readyToPublish = socialPosts.filter(
    (p) =>
      (p.approval_status === "approved" || p.approval_status === "awaiting_connection") &&
      !p.scheduled_at &&
      !p.published_at,
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

  return {
    awaitingReview,
    readyToPublish,
    scheduledToday,
    videosAwaitingTranscription,
    blogsInDraft,
  }
}

async function loadTrendingTopics(referenceDate: Date): Promise<DailyPulseTrendingTopic[]> {
  const suggestions = await listTopicSuggestions()
  const since = new Date(referenceDate.getTime() - SEVEN_DAYS_MS)
  const recent = suggestions.filter((s) => new Date(s.created_at) >= since)

  recent.sort((a, b) => {
    const rankA = typeof a.metadata?.rank === "number" ? (a.metadata.rank as number) : 999
    const rankB = typeof b.metadata?.rank === "number" ? (b.metadata.rank as number) : 999
    if (rankA !== rankB) return rankA - rankB
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  return recent.slice(0, 5).map((entry) => {
    const summary = typeof entry.metadata?.summary === "string" ? (entry.metadata.summary as string) : ""
    const sourceUrl = typeof entry.metadata?.tavily_url === "string" ? (entry.metadata.tavily_url as string) : null
    return { title: entry.title, summary, sourceUrl }
  })
}
