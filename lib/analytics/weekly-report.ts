// lib/analytics/weekly-report.ts
// Composes the data + HTML for the Weekly Review email.
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
import { buildWeeklyCoaching } from "@/lib/analytics/sections/coaching-weekly"
import { buildWeeklyRevenue } from "@/lib/analytics/sections/revenue-weekly"
import { buildWeeklyFunnel } from "@/lib/analytics/sections/funnel-weekly"
import { buildWeeklyOpsHealth } from "@/lib/analytics/sections/ops-health-weekly"
import { buildTopOfMind } from "@/lib/analytics/sections/top-of-mind"
import type { WeeklyReviewPayload } from "@/types/coach-emails"

async function renderEmail(element: React.ReactElement): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server")
  return renderToStaticMarkup(element)
}

export interface WeeklyReport {
  subject: string
  html: string
  rangeStart: Date
  rangeEnd: Date
  payload: WeeklyReviewPayload
}

export async function buildWeeklyReport(options: { rangeEnd?: Date } = {}): Promise<WeeklyReport> {
  const rangeEnd = options.rangeEnd ?? new Date()
  const rangeStart = new Date(rangeEnd.getTime() - 7 * 24 * 60 * 60 * 1000)
  const previousStart = new Date(rangeStart.getTime() - 7 * 24 * 60 * 60 * 1000)
  const range = { from: rangeStart, to: rangeEnd }
  const previousRange = { from: previousStart, to: rangeStart }

  const [
    socialPosts, socialAnalytics, blogs, newsletters, activeSubs,
    coaching, revenue, funnel, opsHealth,
  ] = await Promise.all([
    listSocialPosts(),
    listSocialAnalyticsInRange(previousStart, rangeEnd),
    getBlogPosts(),
    getNewsletters(),
    getActiveSubscribers(),
    safe(() => buildWeeklyCoaching({ range, previousRange }), "coaching"),
    safe(() => buildWeeklyRevenue({ range, previousRange }), "revenue"),
    safe(() => buildWeeklyFunnel({ range, previousRange }), "funnel"),
    safe(() => buildWeeklyOpsHealth({ range }), "opsHealth"),
  ])

  const social = computeSocialMetrics(socialPosts, socialAnalytics, range, previousRange)
  const content = computeContentMetrics(blogs, newsletters, activeSubs.length, range, previousRange)
  const topOfMind = buildTopOfMind({ coaching, revenue, funnel })

  const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3050"
  const dashboardUrl = `${baseUrl}/admin/analytics?tab=social`
  const subject = `Weekly Review — Week of ${rangeStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`

  const payload: WeeklyReviewPayload = {
    rangeStart, rangeEnd, topOfMind,
    coaching, revenue, funnel,
    social, content, opsHealth,
    dashboardUrl,
  }

  const html = await renderEmail(createElement(WeeklyContentReport, { payload }))
  return { subject, html, rangeStart, rangeEnd, payload }
}

async function safe<T>(fn: () => Promise<T>, name: string): Promise<T | null> {
  try { return await fn() } catch (err) {
    console.error(`[weekly-report] section "${name}" failed:`, err); return null
  }
}
