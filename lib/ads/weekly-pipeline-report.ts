// lib/ads/weekly-pipeline-report.ts
// Composes data + HTML for the weekly pipeline funnel email.
// Called by /api/admin/internal/ads/weekly-pipeline-report (Tuesday 13:00 UTC).

import { createElement } from "react"
import { z } from "zod"
import {
  buildPipelineFunnelWithComparison,
  computeRates,
} from "@/lib/ads/pipeline"
import { callAgent, MODEL_HAIKU } from "@/lib/ai/anthropic"
import { WeeklyPipelineReport } from "@/components/emails/WeeklyPipelineReport"

async function renderEmail(element: React.ReactElement): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server")
  return renderToStaticMarkup(element)
}

const insightsSchema = z.object({ paragraph: z.string().min(40).max(800) })

interface InsightsInput {
  totals: {
    visits: number
    signups: number
    bookings: number
    payments: number
    revenue_cents: number
  }
  delta: {
    visits: number | null
    signups: number | null
    bookings: number | null
    payments: number | null
    revenue_cents: number | null
  }
  rates: {
    visit_to_signup: number
    signup_to_booking: number
    booking_to_payment: number
  }
  topCampaigns: Array<{ dimension: string; revenue_cents: number; payments: number }>
}

async function generateInsightsParagraph(input: InsightsInput): Promise<string> {
  const summary = JSON.stringify({
    revenue_dollars: input.totals.revenue_cents / 100,
    bookings: input.totals.bookings,
    payments: input.totals.payments,
    visits: input.totals.visits,
    delta: input.delta,
    rates_pct: {
      visit_to_signup: input.rates.visit_to_signup * 100,
      signup_to_booking: input.rates.signup_to_booking * 100,
      booking_to_payment: input.rates.booking_to_payment * 100,
    },
    top_campaigns: input.topCampaigns.slice(0, 3).map((c) => ({
      campaign: c.dimension,
      revenue_dollars: c.revenue_cents / 100,
      payments: c.payments,
    })),
  })
  try {
    const { content } = await callAgent(
      "You are a senior growth analyst writing the weekly pipeline funnel digest for one advertiser (DJP Athlete coaching). Tone: direct, brief, opinionated. 2-4 sentences. Lead with the most consequential signal in the funnel — biggest leak (lowest conversion stage), biggest win (best campaign), or trend reversal. Cite specific numbers. End with one concrete next action this week.",
      `Last week's funnel:\n${summary}\n\nReturn { "paragraph": "..." } only.`,
      insightsSchema,
      { model: MODEL_HAIKU, cacheSystemPrompt: true },
    )
    return content.paragraph
  } catch (err) {
    console.error("[weekly-pipeline-report] insights generation failed:", err)
    return `Pipeline this week: ${input.totals.visits} visits, ${input.totals.bookings} bookings, ${input.totals.payments} payments totalling $${(input.totals.revenue_cents / 100).toFixed(2)}. AI insights unavailable — see the dashboard for breakdowns.`
  }
}

export interface WeeklyPipelineReportData {
  subject: string
  html: string
  rangeStart: Date
  rangeEnd: Date
}

export async function buildWeeklyPipelineReport(
  options: { rangeEnd?: Date } = {},
): Promise<WeeklyPipelineReportData> {
  const rangeEnd = options.rangeEnd ?? new Date()
  const rangeStart = new Date(rangeEnd.getTime() - 7 * 86_400_000)

  const funnel = await buildPipelineFunnelWithComparison({ rangeStart, rangeEnd })
  const rates = computeRates(funnel.totals)
  const topCampaigns = funnel.byCampaign.slice(0, 5)

  const insightsParagraph = await generateInsightsParagraph({
    totals: funnel.totals,
    delta: funnel.deltaPct ?? {
      visits: null,
      signups: null,
      bookings: null,
      payments: null,
      revenue_cents: null,
    },
    rates,
    topCampaigns: topCampaigns.map((c) => ({
      dimension: c.dimension,
      revenue_cents: c.revenue_cents,
      payments: c.payments,
    })),
  })

  const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3050"
  const dashboardUrl = `${baseUrl}/admin/ads/pipeline`

  const subject = `Pipeline — Week of ${rangeStart.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`

  const html = await renderEmail(
    createElement(WeeklyPipelineReport, {
      rangeStart,
      rangeEnd,
      totals: funnel.totals,
      delta: funnel.deltaPct ?? {
        visits: null,
        signups: null,
        bookings: null,
        payments: null,
        revenue_cents: null,
      },
      rates,
      topCampaigns,
      insightsParagraph,
      dashboardUrl,
    }),
  )

  return { subject, html, rangeStart, rangeEnd }
}
