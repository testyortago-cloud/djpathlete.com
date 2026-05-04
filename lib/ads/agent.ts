// lib/ads/agent.ts
// Phase 1.5g v1 — AI Ads Agent. Two entry points:
//
//  - buildStrategistMemo() — runs Wednesdays. Pulls a snapshot from every
//    Phase 1 system (campaigns, recs, conversions, audiences, pipeline)
//    and asks Claude for a structured weekly memo.
//
//  - askAgent(question) — admin-facing Q&A. Same context snapshot fed in
//    front; Claude answers with senior-marketer tone bound to that data.
//
// Tool-use chat (full multi-turn with DB queries) is deferred to v2; the
// snapshot approach gets ~80% of the value for ~20% of the implementation
// since one advertiser's account state fits comfortably in a single prompt.

import { z } from "zod"
import { callAgent, MODEL_SONNET } from "@/lib/ai/anthropic"
import { listAllCampaigns } from "@/lib/db/google-ads-campaigns"
import { listRecommendations, getRecommendationStatusCounts } from "@/lib/db/google-ads-recommendations"
import { listRecentAutomationLog } from "@/lib/db/google-ads-automation-log"
import {
  getConversionUploadStatusCounts,
  listRecentConversionUploads,
} from "@/lib/db/google-ads-conversion-uploads"
import { listConversionActions } from "@/lib/db/google-ads-conversion-actions"
import { listUserLists } from "@/lib/db/google-ads-user-lists"
import {
  buildPipelineFunnelWithComparison,
  computeRates,
} from "@/lib/ads/pipeline"
import { insertAgentMemo } from "@/lib/db/google-ads-agent-memos"
import type {
  GoogleAdsAgentMemo,
  GoogleAdsAgentMemoSections,
  GoogleAdsAgentMemoSource,
} from "@/types/database"

const AGENT_SYSTEM_PROMPT = `You are the senior in-house marketing strategist
for DJP Athlete (a personal-brand strength-coaching business focused on
rotational power, comeback training, and athletic performance — programs
include "Comeback Code" and "Rotational Reboot").

Tone: direct, opinionated, pragmatic. Never hedge with "consider" when you
mean "do this". When you spot a leak in the funnel, name it. When something's
working, give credit and recommend doubling down.

You're reading a JSON snapshot of one advertiser's full marketing state:
campaigns, AI recommendations queued for review, conversion-upload pipeline,
Customer Match audience sizes, and the visit→signup→booking→payment funnel
with delta vs prior week.

Bias toward concrete, account-specific advice. No generic best-practice
checklists. If the data shows a specific number worth citing, cite it.`

const memoSectionsSchema = z.object({
  executive_summary: z.string().min(40).max(500),
  whats_working: z.array(z.string().min(20).max(400)).min(1).max(4),
  whats_not: z.array(z.string().min(20).max(400)).min(1).max(4),
  recommended_actions: z
    .array(
      z.object({
        priority: z.enum(["high", "medium", "low"]),
        title: z.string().min(8).max(120),
        reasoning: z.string().min(20).max(400),
        link: z.string().nullable().optional(),
      }),
    )
    .min(1)
    .max(8),
  watch_list: z.string().min(40).max(400),
})

const askAgentSchema = z.object({
  answer: z.string().min(40).max(4000),
})

interface AccountSnapshot {
  pipeline: {
    range_days: number
    totals: {
      visits: number
      signups: number
      bookings: number
      payments: number
      revenue_cents: number
    }
    delta_pct: {
      visits: number | null
      signups: number | null
      bookings: number | null
      payments: number | null
      revenue_cents: number | null
    }
    rates_pct: {
      visit_to_signup: number
      signup_to_booking: number
      booking_to_payment: number
    }
    top_campaigns_by_revenue: Array<{
      dimension: string
      visits: number
      signups: number
      bookings: number
      payments: number
      revenue_cents: number
    }>
  }
  campaigns: Array<{
    id: string
    name: string
    type: string
    status: string
    automation_mode: string
  }>
  recommendations: {
    counts: Record<string, number>
    pending_top10: Array<{
      type: string
      scope: string
      reasoning: string
      confidence: number
    }>
  }
  conversions: {
    counts: Record<string, number>
    actions_configured: number
    recent_5: Array<{
      type: string
      status: string
      value_cents: number
      created_at: string
    }>
  }
  audiences: Array<{
    audience_type: string
    is_active: boolean
    member_count: number
    last_synced_at: string | null
    last_error: string | null
  }>
  recent_automation_log_count: number
}

async function gatherSnapshot(): Promise<AccountSnapshot> {
  const range_days = 28
  const rangeEnd = new Date()
  const rangeStart = new Date(rangeEnd.getTime() - range_days * 86_400_000)

  const [
    funnel,
    campaigns,
    recCounts,
    pendingRecs,
    convCounts,
    convActions,
    recentUploads,
    userLists,
    automationLog,
  ] = await Promise.all([
    buildPipelineFunnelWithComparison({ rangeStart, rangeEnd }),
    listAllCampaigns(),
    getRecommendationStatusCounts(),
    listRecommendations({ status: "pending", limit: 10 }),
    getConversionUploadStatusCounts(),
    listConversionActions(),
    listRecentConversionUploads(5),
    listUserLists(),
    listRecentAutomationLog(20),
  ])

  const rates = computeRates(funnel.totals)

  return {
    pipeline: {
      range_days,
      totals: funnel.totals,
      delta_pct: funnel.deltaPct ?? {
        visits: null,
        signups: null,
        bookings: null,
        payments: null,
        revenue_cents: null,
      },
      rates_pct: {
        visit_to_signup: rates.visit_to_signup * 100,
        signup_to_booking: rates.signup_to_booking * 100,
        booking_to_payment: rates.booking_to_payment * 100,
      },
      top_campaigns_by_revenue: funnel.byCampaign.slice(0, 5),
    },
    campaigns: campaigns.slice(0, 30).map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      status: c.status,
      automation_mode: c.automation_mode,
    })),
    recommendations: {
      counts: recCounts as unknown as Record<string, number>,
      pending_top10: pendingRecs.map((r) => ({
        type: r.recommendation_type,
        scope: `${r.scope_type} ${r.scope_id}`,
        reasoning: r.reasoning,
        confidence: r.confidence,
      })),
    },
    conversions: {
      counts: convCounts as unknown as Record<string, number>,
      actions_configured: convActions.filter((a) => a.is_active).length,
      recent_5: recentUploads.map((u) => ({
        type: u.upload_type + (u.adjustment_type ? `(${u.adjustment_type})` : ""),
        status: u.status,
        value_cents: Math.round(u.value_micros / 10_000),
        created_at: u.created_at,
      })),
    },
    audiences: userLists.map((l) => ({
      audience_type: l.audience_type,
      is_active: l.is_active,
      member_count: l.member_count,
      last_synced_at: l.last_synced_at,
      last_error: l.last_error,
    })),
    recent_automation_log_count: automationLog.length,
  }
}

function mondayOfWeek(d: Date): string {
  const date = new Date(d)
  const day = date.getUTCDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  date.setUTCDate(date.getUTCDate() + diffToMonday)
  return date.toISOString().slice(0, 10)
}

export interface BuildStrategistMemoOptions {
  source?: GoogleAdsAgentMemoSource
  triggered_by?: string | null
  weekEnd?: Date
}

export async function buildStrategistMemo(
  options: BuildStrategistMemoOptions = {},
): Promise<GoogleAdsAgentMemo> {
  const source = options.source ?? "scheduled"
  const weekEnd = options.weekEnd ?? new Date()
  const week_of = mondayOfWeek(weekEnd)

  const snapshot = await gatherSnapshot()
  const userMessage = `Account snapshot (last ${snapshot.pipeline.range_days} days):

${JSON.stringify(snapshot, null, 2)}

Write the weekly strategist memo as a structured object matching this shape:

{
  "executive_summary": "<2-3 sentences. Top-line health. Lead with revenue trend or biggest signal.>",
  "whats_working": ["<paragraph>", ...],   // 1-4 items, each cite a number
  "whats_not": ["<paragraph>", ...],         // 1-4 items, each cite a number
  "recommended_actions": [
    {
      "priority": "high|medium|low",
      "title": "<action verb + specific target, e.g. 'Approve the 3 negative-keyword recs for Brand Search'>",
      "reasoning": "<2-3 sentences citing data>",
      "link": "/admin/ads/recommendations"  // optional in-app link, null if N/A
    },
    ...   // 1-8 items, sorted with high priority first
  ],
  "watch_list": "<short paragraph: what could break next week, what trend to watch>"
}

Valid in-app links you can use in the link field:
  - /admin/ads/campaigns         (campaigns dashboard)
  - /admin/ads/recommendations    (approve/reject queue)
  - /admin/ads/conversions        (conversion upload queue + action config)
  - /admin/ads/audiences          (Customer Match)
  - /admin/ads/pipeline           (funnel)
  - /admin/ads/automation-log     (apply audit trail)
  - /admin/ads/settings           (OAuth + connected accounts)`

  const aiResult = await callAgent(AGENT_SYSTEM_PROMPT, userMessage, memoSectionsSchema, {
    model: MODEL_SONNET,
    cacheSystemPrompt: true,
  })

  const sections: GoogleAdsAgentMemoSections = {
    executive_summary: aiResult.content.executive_summary,
    whats_working: aiResult.content.whats_working,
    whats_not: aiResult.content.whats_not,
    recommended_actions: aiResult.content.recommended_actions.map((a) => ({
      priority: a.priority,
      title: a.title,
      reasoning: a.reasoning,
      link: a.link ?? null,
    })),
    watch_list: aiResult.content.watch_list,
  }

  const subject = `Strategist memo — week of ${new Date(week_of).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`

  return insertAgentMemo({
    week_of,
    subject,
    sections,
    source,
    triggered_by: options.triggered_by ?? null,
    tokens_used: aiResult.tokens_used,
  })
}

export interface AskAgentResult {
  answer: string
  tokens_used: number
}

/**
 * Ad-hoc Q&A. Loads the same snapshot the strategist memo uses, prepends
 * it to the system prompt, and asks Claude to answer the admin's question
 * grounded in that data. Returns plain markdown text.
 */
export async function askAgent(question: string): Promise<AskAgentResult> {
  if (!question.trim()) {
    return { answer: "Please ask a question.", tokens_used: 0 }
  }
  const snapshot = await gatherSnapshot()
  const systemPrompt = `${AGENT_SYSTEM_PROMPT}

You will be asked a single question. Answer with the senior-marketer voice
above, grounded in the JSON snapshot you'll see in the user message. Format
the answer as markdown — short paragraphs, code spans for specific values,
inline links in [label](href) form when referencing in-app pages
(/admin/ads/campaigns, /admin/ads/recommendations, /admin/ads/conversions,
/admin/ads/audiences, /admin/ads/pipeline). If the snapshot doesn't contain
enough data to answer well, say so and recommend what to look at.`

  const userMessage = `Account snapshot (last ${snapshot.pipeline.range_days} days):

${JSON.stringify(snapshot, null, 2)}

Question: ${question.trim()}

Return your answer as { "answer": "<markdown>" } — no commentary outside the JSON.`

  const aiResult = await callAgent(systemPrompt, userMessage, askAgentSchema, {
    model: MODEL_SONNET,
    cacheSystemPrompt: true,
  })
  return {
    answer: aiResult.content.answer,
    tokens_used: aiResult.tokens_used,
  }
}
