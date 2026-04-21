// lib/analytics/weekly-report.ts
// Composes the data + HTML for the Weekly Content Report email.
// Called by /api/admin/internal/send-weekly-report.

import { createElement } from "react"
import { listSocialPosts } from "@/lib/db/social-posts"
import { listSocialAnalyticsInRange } from "@/lib/db/social-analytics"
import { getBlogPosts } from "@/lib/db/blog-posts"
import { getNewsletters } from "@/lib/db/newsletters"
import { getActiveSubscribers } from "@/lib/db/newsletter"
import { computeSocialMetrics } from "./social"
import { computeContentMetrics } from "./content"
import { WeeklyContentReport } from "@/components/emails/WeeklyContentReport"
import type { SocialMetrics, ContentMetrics } from "@/types/analytics"

async function renderEmail(element: React.ReactElement): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server")
  return renderToStaticMarkup(element)
}

export interface WeeklyReport {
  subject: string
  html: string
  rangeStart: Date
  rangeEnd: Date
  social: SocialMetrics
  content: ContentMetrics
}

export async function buildWeeklyReport(options: { rangeEnd?: Date } = {}): Promise<WeeklyReport> {
  const rangeEnd = options.rangeEnd ?? new Date()
  const rangeStart = new Date(rangeEnd.getTime() - 7 * 24 * 60 * 60 * 1000)
  const previousStart = new Date(rangeStart.getTime() - 7 * 24 * 60 * 60 * 1000)

  const range = { from: rangeStart, to: rangeEnd }
  const previousRange = { from: previousStart, to: rangeStart }

  const [socialPosts, socialAnalytics, blogs, newsletters, activeSubs] = await Promise.all([
    listSocialPosts(),
    listSocialAnalyticsInRange(previousStart, rangeEnd),
    getBlogPosts(),
    getNewsletters(),
    getActiveSubscribers(),
  ])

  const social = computeSocialMetrics(socialPosts, socialAnalytics, range, previousRange)
  const content = computeContentMetrics(blogs, newsletters, activeSubs.length, range, previousRange)

  const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3050"
  const dashboardUrl = `${baseUrl}/admin/analytics?tab=social`

  const subject = `Weekly Content Report — Week of ${rangeStart.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`

  const html = await renderEmail(
    createElement(WeeklyContentReport, { social, content, rangeStart, rangeEnd, dashboardUrl }),
  )

  return { subject, html, rangeStart, rangeEnd, social, content }
}
