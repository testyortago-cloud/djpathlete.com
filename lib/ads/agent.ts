// lib/ads/agent.ts
// Phase 1.5g v2 — AI Ads Agent. Two entry points:
//
//  - buildStrategistMemo() — runs Wednesdays. Walks the full lifecycle
//    pipeline: gather signals → preflight gate → Claude reason →
//    pure-function guardrails → execute (insert pending recommendations) →
//    update memo row with actions + rejections + outcome_status.
//
//  - askAgent(question) — admin-facing Q&A. Same snapshot used by the
//    legacy strategist flow fed in front; Claude answers with senior-marketer
//    tone bound to that data. Unchanged from v1.
//
// Tool-use chat (full multi-turn with DB queries) is deferred; the
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
import {
  insertAgentMemo,
  updateAgentMemoLifecycle,
  listAgentMemos,
} from "@/lib/db/google-ads-agent-memos"
import { getActiveGoogleAdsAccounts, listGoogleAdsAccounts } from "@/lib/db/google-ads-accounts"
import { getPlatformConnection } from "@/lib/db/platform-connections"
import { createServiceRoleClient } from "@/lib/supabase"
import { gatherAdsSignals, type GatherAdsSignalsDeps, type PreflightInput } from "@/lib/ads/agent/signals"
import { reasonAdsDecision } from "@/lib/ads/agent/reason"
import { applyGuardrailsBatch } from "@/lib/ads/agent/guardrails"
import { executeAdsActions, type PreExecutionPair } from "@/lib/ads/agent/execute"
import { runSelfCritique, shouldReRunAfterCritique } from "@/lib/agents/self-critique"
import { readFewShots } from "@/lib/agents/few-shots"
import type { AdsAction, AdsRawInputs, AdsSignals, PromotableInventoryItem } from "@/lib/ads/agent/types"
import type { AdsAgentDecision } from "@/lib/ads/agent/decision-schema"
import { latestApprovedBrief } from "@/lib/db/strategy-briefs"
import type { BriefContext } from "@/lib/strategy/specialist-contract"
import type {
  GoogleAdsAgentMemo,
  GoogleAdsAgentMemoSections,
  GoogleAdsAgentMemoSource,
  GoogleAdsAgentRecommendedAction,
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

// ─────────────────────────────────────────────────────────────────
// Lifecycle pipeline helpers — adapter composition + memo rendering
// ─────────────────────────────────────────────────────────────────

const EMPTY_SECTIONS: GoogleAdsAgentMemoSections = {
  executive_summary: "Strategist memo skipped this week — preflight gate failed.",
  whats_working: ["Awaiting fresh data for the next run."],
  whats_not: ["Preflight gate blocked memo generation — see narrative for details."],
  recommended_actions: [],
  watch_list: "Resume normal cadence once preflight reasons are resolved.",
}

/**
 * Picks the customer_id the executor will tag new recommendations with.
 *  1. First active Google Ads account from google_ads_accounts.
 *  2. Else first row in google_ads_accounts (active or not).
 *  3. Else null — caller falls back to a sentinel ("__no_account__"); the
 *     guardrails should have rejected actions before they hit this path,
 *     but flag_for_human can still slip through with account scope.
 */
async function resolveCustomerId(): Promise<string | null> {
  try {
    const active = await getActiveGoogleAdsAccounts()
    if (active.length > 0) return active[0].customer_id
    const all = await listGoogleAdsAccounts()
    if (all.length > 0) return all[0].customer_id
    return null
  } catch {
    return null
  }
}

// ── Preflight input adapter ──────────────────────────────────────
// We piece this together from the existing DALs. Anything we can't
// source from a real DAL falls back to a conservative default that
// makes the preflight gate trip rather than letting a stale-data memo
// ship.
async function fetchPreflightInput(): Promise<PreflightInput> {
  const supabase = createServiceRoleClient()

  // mostRecentConversionAt — derived from google_ads_conversion_uploads.
  // We treat any non-pending row as "tracking is alive". If nothing has
  // ever been uploaded, the preflight gate will fail with "no conversions
  // on record" — which is the right behaviour for a brand-new account.
  let mostRecentConversionAt: Date | null = null
  try {
    const { data } = await supabase
      .from("google_ads_conversion_uploads")
      .select("conversion_time")
      .order("conversion_time", { ascending: false })
      .limit(1)
      .maybeSingle()
    const row = data as { conversion_time?: string } | null
    if (row?.conversion_time) {
      mostRecentConversionAt = new Date(row.conversion_time)
    }
  } catch {
    // Leave as null — preflight will fail safely.
  }

  // ga4SyncedAt / gscSyncedAt — read from platform_connections.last_sync_at.
  // For GA4 we don't currently store a connection row (the service-account
  // creds live in env vars), so we derive freshness from "GA4 is configured"
  // — if it's configured we assume it's syncable now, which is the same
  // semantics the rest of the codebase uses.
  let ga4SyncedAt: Date | null = null
  let gscSyncedAt: Date | null = null
  try {
    // TODO(ads-agent): GA4 doesn't have a platform_connections row in v1 —
    // its credentials are env-var-only. Treat configured + reachable as
    // synced-now; switch to real last_sync_at when GA4 moves into the
    // platform_connections model.
    const ga4Configured = Boolean(
      process.env.GA4_PROPERTY_ID && process.env.GA4_SERVICE_ACCOUNT_JSON,
    )
    if (ga4Configured) ga4SyncedAt = new Date()
  } catch {
    // ignore
  }
  try {
    // GSC freshness: max(date) in gsc_query_daily acts as a sync stamp.
    const { data } = await supabase
      .from("gsc_query_daily")
      .select("date")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle()
    const row = data as { date?: string } | null
    if (row?.date) gscSyncedAt = new Date(`${row.date}T00:00:00Z`)
  } catch {
    // ignore
  }

  // tokensValid — for Google Ads, check the account is_active flag (a
  // disabled account means OAuth has failed or been revoked). For GA4 +
  // GSC, presence of credentials is the closest cheap proxy.
  let googleAdsValid = false
  try {
    const accounts = await getActiveGoogleAdsAccounts()
    googleAdsValid = accounts.length > 0
  } catch {
    googleAdsValid = false
  }
  const ga4Valid = Boolean(
    process.env.GA4_PROPERTY_ID && process.env.GA4_SERVICE_ACCOUNT_JSON,
  )
  let gscValid = false
  try {
    const gscConn = await getPlatformConnection("google_ads" as never).catch(() => null)
    // TODO(ads-agent): there's no dedicated GSC plugin in PlatformPluginName
    // today — treat "has fresh data in gsc_query_daily" as token-valid.
    gscValid = gscSyncedAt !== null
    void gscConn
  } catch {
    gscValid = false
  }

  // activeCampaignClicks7d — sum clicks across enabled campaigns in last 7d.
  let activeCampaignClicks7d = 0
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const { data: enabled } = await supabase
      .from("google_ads_campaigns")
      .select("campaign_id, customer_id")
      .eq("status", "ENABLED")
    const enabledRows = (enabled ?? []) as Array<{ campaign_id: string; customer_id: string }>
    if (enabledRows.length > 0) {
      const ids = enabledRows.map((r) => r.campaign_id)
      const { data: metrics } = await supabase
        .from("google_ads_daily_metrics")
        .select("campaign_id, clicks")
        .in("campaign_id", ids)
        .gte("date", sevenDaysAgo)
        .is("ad_group_id", null)
        .is("keyword_criterion_id", null)
      const rows = (metrics ?? []) as Array<{ clicks: number | null }>
      activeCampaignClicks7d = rows.reduce((sum, r) => sum + Number(r.clicks ?? 0), 0)
    }
  } catch {
    activeCampaignClicks7d = 0
  }

  return {
    mostRecentConversionAt,
    ga4SyncedAt,
    gscSyncedAt,
    tokensValid: {
      googleAds: googleAdsValid,
      ga4: ga4Valid,
      gsc: gscValid,
    },
    activeCampaignClicks7d,
  }
}

// ── Raw inputs adapters ──────────────────────────────────────────
// Most adapters here either pull through a real DAL or return an empty
// array. Empty values are visible in the prompt and cause the model to
// lower confidence (per the system prompt instructions) — they never
// crash the pipeline.

async function fetchCampaignsAdapter(): Promise<AdsRawInputs["campaigns"]> {
  const supabase = createServiceRoleClient()
  const campaigns = await listAllCampaigns()
  if (campaigns.length === 0) return []

  // 28-day rollup window
  const toDate = new Date().toISOString().slice(0, 10)
  const fromDate = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)

  // Pull all metrics in range for these campaigns (campaign-grain rows only).
  const campaignIds = campaigns.map((c) => c.campaign_id)
  let metrics: Array<{
    campaign_id: string
    impressions: number | null
    clicks: number | null
    cost_micros: number | null
    conversions: number | null
    conversion_value: number | null
    date: string
  }> = []
  try {
    const { data } = await supabase
      .from("google_ads_daily_metrics")
      .select("campaign_id, impressions, clicks, cost_micros, conversions, conversion_value, date")
      .in("campaign_id", campaignIds)
      .is("ad_group_id", null)
      .is("keyword_criterion_id", null)
      .gte("date", fromDate)
      .lte("date", toDate)
    metrics = (data ?? []) as typeof metrics
  } catch {
    // leave metrics empty — campaigns will show zero numbers + gaps[] will note this
  }

  return campaigns.map((c) => {
    const rows28 = metrics.filter((m) => m.campaign_id === c.campaign_id)
    const rows7 = rows28.filter((m) => m.date >= sevenDaysAgo)

    const sum = (rows: typeof metrics, key: keyof (typeof metrics)[number]) =>
      rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0)

    const impressions = sum(rows28, "impressions")
    const clicks = sum(rows28, "clicks")
    const cost_micros = sum(rows28, "cost_micros")
    const conversions = sum(rows28, "conversions")
    const conversion_value = sum(rows28, "conversion_value")

    const cost_usd = cost_micros / 1_000_000
    const ctr = impressions > 0 ? clicks / impressions : 0
    const cvr = clicks > 0 ? conversions / clicks : 0
    const cac_usd = conversions > 0 ? cost_usd / conversions : null
    const roas = cost_usd > 0 ? conversion_value / cost_usd : null

    return {
      id: c.id,
      name: c.name,
      status: c.status,
      daily_budget_usd: c.budget_micros ? c.budget_micros / 1_000_000 : 0,
      created_at: c.created_at,
      last_7d_conversions: sum(rows7, "conversions"),
      metrics_28d: {
        clicks,
        impressions,
        ctr,
        conversions,
        cvr,
        cost_usd,
        cac_usd,
        roas,
        // TODO(ads-agent): impression_share columns don't exist on
        // google_ads_daily_metrics yet — emit null to keep the contract
        // populated. Wire when the sync writes those fields.
        impression_share: null,
        impression_share_lost_budget: null,
        impression_share_lost_rank: null,
      },
    }
  })
}

async function fetchSearchTermsTopSpend(): Promise<AdsRawInputs["search_terms_top_spend"]> {
  const supabase = createServiceRoleClient()
  try {
    const fromDate = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10)
    // TODO(ads-agent): aggregate by (campaign_id, search_term) in SQL when
    // volumes grow; for now JS-side rollup of the per-day rows is fine.
    const { data } = await supabase
      .from("google_ads_search_terms")
      .select("campaign_id, search_term, cost_micros, clicks, conversions, date")
      .gte("date", fromDate)
    const rows = (data ?? []) as Array<{
      campaign_id: string
      search_term: string
      cost_micros: number | null
      clicks: number | null
      conversions: number | null
    }>
    const byKey = new Map<
      string,
      {
        text: string
        campaign_id: string
        cost_micros: number
        clicks: number
        conversions: number
      }
    >()
    for (const r of rows) {
      const key = `${r.campaign_id} ${r.search_term}`
      const cur = byKey.get(key) ?? {
        text: r.search_term,
        campaign_id: r.campaign_id,
        cost_micros: 0,
        clicks: 0,
        conversions: 0,
      }
      cur.cost_micros += Number(r.cost_micros ?? 0)
      cur.clicks += Number(r.clicks ?? 0)
      cur.conversions += Number(r.conversions ?? 0)
      byKey.set(key, cur)
    }
    return [...byKey.values()]
      .map((r) => ({
        text: r.text,
        campaign_id: r.campaign_id,
        cost_usd: r.cost_micros / 1_000_000,
        clicks: r.clicks,
        conversions: r.conversions,
      }))
      .sort((a, b) => b.cost_usd - a.cost_usd)
      .slice(0, 25)
  } catch {
    return []
  }
}

async function fetchSearchTermsTopConversions(): Promise<
  AdsRawInputs["search_terms_top_conversions"]
> {
  const all = await fetchSearchTermsTopSpend().catch(() => [])
  // Re-sort the same dataset by conversions desc instead of spend.
  return [...all].sort((a, b) => b.conversions - a.conversions).slice(0, 25)
}

async function fetchPendingRecommendationsAdapter(): Promise<
  AdsRawInputs["pending_recommendations"]
> {
  try {
    const recs = await listRecommendations({ status: "pending", limit: 50 })
    return recs.map((r) => ({
      id: r.id,
      type: r.recommendation_type,
      // scope_id is the campaign_id when scope_type === "campaign"; null otherwise.
      campaign_id: r.scope_type === "campaign" ? r.scope_id : null,
    }))
  } catch {
    return []
  }
}

async function fetchConversionActionsAdapter(): Promise<AdsRawInputs["conversion_actions"]> {
  const supabase = createServiceRoleClient()
  try {
    const actions = await listConversionActions()
    // Get the most-recent conversion timestamp per conversion_action_id from
    // the uploads queue.
    const { data: uploads } = await supabase
      .from("google_ads_conversion_uploads")
      .select("conversion_action_id, conversion_time")
      .order("conversion_time", { ascending: false })
    const rows = (uploads ?? []) as Array<{
      conversion_action_id: string
      conversion_time: string
    }>
    const latest = new Map<string, string>()
    for (const r of rows) {
      if (!latest.has(r.conversion_action_id)) {
        latest.set(r.conversion_action_id, r.conversion_time)
      }
    }
    return actions.map((a) => ({
      id: a.id,
      name: a.name,
      last_conversion_at: latest.get(a.conversion_action_id) ?? null,
    }))
  } catch {
    return []
  }
}

async function fetchGa4Adapter(): Promise<AdsRawInputs["ga4"]> {
  // TODO(ads-agent): wire to lib/analytics/ga4-data.ts (getTrafficByChannel,
  // getTopPages with engagement). For v1 we ship an empty contract so the
  // model sees the gap explicitly. The reasoning prompt already lowers
  // confidence when gaps[] is non-empty.
  return {
    sessions_by_source_medium: [],
    landing_page_engagement: [],
  }
}

async function fetchGscOrganicTop10Adapter(): Promise<AdsRawInputs["gsc_organic_top10"]> {
  const supabase = createServiceRoleClient()
  try {
    const fromDate = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10)
    const { data } = await supabase
      .from("gsc_query_daily")
      .select("query, page, position, clicks, impressions, date")
      .gte("date", fromDate)
    const rows = (data ?? []) as Array<{
      query: string
      page: string
      position: number | null
      clicks: number | null
      impressions: number | null
    }>
    // Aggregate over the window: pick the best (lowest) position per
    // (query, page) and sum clicks/impressions.
    const byKey = new Map<
      string,
      {
        query: string
        page: string
        position: number
        clicks: number
        impressions: number
      }
    >()
    for (const r of rows) {
      const key = `${r.query} ${r.page}`
      const pos = Number(r.position ?? 100)
      const cur = byKey.get(key)
      if (!cur) {
        byKey.set(key, {
          query: r.query,
          page: r.page,
          position: pos,
          clicks: Number(r.clicks ?? 0),
          impressions: Number(r.impressions ?? 0),
        })
      } else {
        cur.position = Math.min(cur.position, pos)
        cur.clicks += Number(r.clicks ?? 0)
        cur.impressions += Number(r.impressions ?? 0)
      }
    }
    return [...byKey.values()]
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10)
  } catch {
    return []
  }
}

async function fetchPipelineAdapter(): Promise<AdsRawInputs["pipeline"]> {
  try {
    const rangeEnd = new Date()
    const rangeStart = new Date(rangeEnd.getTime() - 28 * 86_400_000)
    const funnel = await buildPipelineFunnelWithComparison({ rangeStart, rangeEnd })
    const rates = computeRates(funnel.totals)
    return {
      visits: funnel.totals.visits,
      signups: funnel.totals.signups,
      bookings: funnel.totals.bookings,
      payments: funnel.totals.payments,
      visits_to_signup: rates.visit_to_signup,
      signup_to_booking: rates.signup_to_booking,
      booking_to_payment: rates.booking_to_payment,
    }
  } catch {
    return {
      visits: 0,
      signups: 0,
      bookings: 0,
      payments: 0,
      visits_to_signup: 0,
      signup_to_booking: 0,
      booking_to_payment: 0,
    }
  }
}

async function fetchPriorMemosAdapter(): Promise<AdsRawInputs["prior_memos"]> {
  try {
    const memos = await listAgentMemos(8)
    return memos.map((m) => ({
      id: m.id,
      week_of: m.week_of,
      actions: m.actions ?? [],
      outcome_status: m.outcome_status,
      outcome_metrics: m.outcome_metrics ?? null,
    }))
  } catch {
    return []
  }
}

async function fetchCampaignToLandingPageMap(): Promise<Record<string, string>> {
  // TODO(ads-agent): no canonical "campaign → landing page" mapping exists
  // in v1 (final_url lives on the Ad, not the Campaign, and one campaign
  // typically has many ads with different final_urls). Returning an empty
  // map means the landing_page_engagement_mismatch derived signal will
  // always be empty — fine for v1; revisit when we want to attribute LP
  // engagement to a specific campaign.
  return {}
}

async function fetchBriefContextAdapter(): Promise<BriefContext | null> {
  const supabase = createServiceRoleClient()
  const brief = await latestApprovedBrief(supabase)
  if (!brief) return null
  return {
    brief_id: brief.id,
    week_of: brief.week_of,
    themes: brief.themes,
    audience_focus: brief.audience_focus,
    priority_channel: brief.priority_channel,
    keywords_to_chase: brief.keywords_to_chase,
    hooks_to_test: brief.hooks_to_test,
    ctas: brief.ctas,
    dont_do: brief.dont_do,
  }
}

async function fetchFewShotsAdapter(): Promise<string[]> {
  const supabase = createServiceRoleClient()
  return readFewShots(supabase, "global", "ads_agent")
}

/**
 * Merges always-on programs (`marketing_products`) with upcoming, published
 * clinic/camp instances (`events`) into a single list the agent reasons over
 * when picking `propose_new_campaign` actions.
 *
 *  - Products: rows where `status='active'`. Edited from the admin catalog.
 *  - Events: rows where `status='published'`, `start_date >= now()`, and
 *    `signup_count < capacity`. Drafts are intentionally excluded — the agent
 *    shouldn't run paid acquisition for an event that isn't live yet. The
 *    admin publish flow is the opt-in.
 *
 * Returned items are typed as a unified `PromotableInventoryItem`, with
 * event-only fields (start date, spots remaining, age range, location)
 * present for events and `null` for products. The reasoning prompt uses
 * these to make blueprints time-bound and geo-targeted.
 *
 * Returns `[]` on any DB error — the agent then falls back to generic
 * strategy and `gaps[]` is unaffected (this signal is additive, not
 * required for preflight).
 */
/**
 * Heuristic paid-acquisition window for an event. Higher-commitment events
 * (multi-day, expensive, older audience) need a longer ramp; cheap single-
 * session clinics convert faster on shorter ramps. The window is bounded
 * by `open_days_before` (start promoting) and `close_days_before` (stop
 * — too late for paid to compound). `state` snaps the current
 * `days_until` into one of four buckets the prompt acts on directly.
 *
 * Buckets are intentionally coarse: this is decision-support for the
 * agent, not a forecasting model. Real attribution data later will let us
 * regress optimal windows per event-type/price-band.
 */
export function computePaidWindow(input: {
  type: "clinic" | "camp"
  price_cents: number | null
  days_until: number
}): {
  open_days_before: number
  close_days_before: number
  state: "too_early" | "in_window" | "closing_soon" | "too_late"
} {
  const priceUsd = (input.price_cents ?? 0) / 100
  // Camps: multi-day commitment, parents need lead time → 6-week ramp.
  // Clinics: single-session, lower commitment → 3-week ramp.
  // Cheap clinics (<$50): 2-week ramp (impulse purchase).
  let open: number
  let close: number
  if (input.type === "camp") {
    open = 42
    close = 7
  } else if (priceUsd >= 50) {
    open = 21
    close = 3
  } else {
    open = 14
    close = 2
  }

  let state: "too_early" | "in_window" | "closing_soon" | "too_late"
  if (input.days_until > open) state = "too_early"
  else if (input.days_until < close) state = "too_late"
  else if (input.days_until <= 7) state = "closing_soon"
  else state = "in_window"

  return { open_days_before: open, close_days_before: close, state }
}

async function fetchPromotableInventoryAdapter(): Promise<PromotableInventoryItem[]> {
  const supabase = createServiceRoleClient()
  const items: PromotableInventoryItem[] = []

  try {
    const { data: products } = await supabase
      .from("marketing_products")
      .select(
        "slug, name, one_liner, target_audience, signature_phrases, pain_points, landing_url, geo_focus, conversion_type, price_cents, notes",
      )
      .eq("status", "active")
    const productRows = (products ?? []) as Array<{
      slug: string
      name: string
      one_liner: string
      target_audience: string
      signature_phrases: string[]
      pain_points: string[]
      landing_url: string
      geo_focus: string[]
      conversion_type: PromotableInventoryItem["conversion_type"]
      price_cents: number | null
      notes: string | null
    }>
    for (const p of productRows) {
      items.push({
        kind: "product",
        ref: p.slug,
        name: p.name,
        one_liner: p.one_liner,
        target_audience: p.target_audience,
        signature_phrases: p.signature_phrases ?? [],
        pain_points: p.pain_points ?? [],
        landing_url: p.landing_url,
        geo_focus: p.geo_focus ?? [],
        conversion_type: p.conversion_type,
        price_cents: p.price_cents,
        event_start_date: null,
        days_until_event: null,
        spots_remaining: null,
        age_range: null,
        location_name: null,
        paid_window_open_days_before: null,
        paid_window_close_days_before: null,
        paid_window_state: null,
        notes: p.notes,
      })
    }
  } catch {
    // ignore — products are additive
  }

  try {
    const nowIso = new Date().toISOString()
    const { data: events } = await supabase
      .from("events")
      .select(
        "id, type, slug, title, summary, focus_areas, audience, location_name, age_min, age_max, capacity, signup_count, price_cents, start_date",
      )
      .eq("status", "published")
      .gte("start_date", nowIso)
    const eventRows = (events ?? []) as Array<{
      id: string
      type: "clinic" | "camp"
      slug: string
      title: string
      summary: string
      focus_areas: string[]
      audience: string[]
      location_name: string
      age_min: number | null
      age_max: number | null
      capacity: number
      signup_count: number
      price_cents: number | null
      start_date: string
    }>
    for (const e of eventRows) {
      if (e.signup_count >= e.capacity) continue
      const start = new Date(e.start_date)
      const days_until = Math.max(
        0,
        Math.ceil((start.getTime() - Date.now()) / 86_400_000),
      )
      const ageRange =
        e.age_min != null && e.age_max != null ? `${e.age_min}-${e.age_max}` : null
      // Strip the leading "1) " numbering coaches use in focus_areas — the
      // agent doesn't need that to derive keyword themes.
      const phrases = (e.focus_areas ?? []).map((f) =>
        f.replace(/^\d+\)\s*/, "").trim(),
      )
      const landing = e.type === "clinic" ? `/clinics/${e.slug}` : `/camps/${e.slug}`
      const window = computePaidWindow({
        type: e.type,
        price_cents: e.price_cents,
        days_until,
      })
      items.push({
        kind: "event",
        ref: e.id,
        name: e.title,
        one_liner: e.summary,
        target_audience:
          (e.audience ?? []).join(", ") ||
          (ageRange ? `Athletes aged ${ageRange}` : "Local athletes"),
        signature_phrases: phrases,
        pain_points: [],
        landing_url: landing,
        geo_focus: [e.location_name],
        conversion_type: "lead",
        price_cents: e.price_cents,
        event_start_date: e.start_date,
        days_until_event: days_until,
        spots_remaining: e.capacity - e.signup_count,
        age_range: ageRange,
        location_name: e.location_name,
        paid_window_open_days_before: window.open_days_before,
        paid_window_close_days_before: window.close_days_before,
        paid_window_state: window.state,
        notes: `${e.type}, capacity ${e.capacity}, ${e.signup_count} signed up`,
      })
    }
  } catch {
    // ignore — events are additive
  }

  return items
}

function buildSignalsDeps(): GatherAdsSignalsDeps {
  return {
    fetchPreflightInput,
    fetchCampaigns: fetchCampaignsAdapter,
    fetchSearchTermsTopSpend,
    fetchSearchTermsTopConversions,
    fetchPendingRecommendations: fetchPendingRecommendationsAdapter,
    fetchConversionActions: fetchConversionActionsAdapter,
    fetchGa4: fetchGa4Adapter,
    fetchGscOrganicTop10: fetchGscOrganicTop10Adapter,
    fetchPipeline: fetchPipelineAdapter,
    fetchPriorMemos: fetchPriorMemosAdapter,
    fetchCampaignToLandingPageMap,
    fetchBriefContext: fetchBriefContextAdapter,
    fetchFewShots: fetchFewShotsAdapter,
    fetchPromotableInventory: fetchPromotableInventoryAdapter,
  }
}

// ── Narrative rendering ──────────────────────────────────────────
// The lifecycle reasoning step produces { rationale, actions[], watch_list[] }.
// Email templates still consume GoogleAdsAgentMemoSections shape, so we
// render the decision into that shape here.

function renderSectionsFromDecision(
  decision: AdsAgentDecision,
  signals: AdsSignals,
): GoogleAdsAgentMemoSections {
  const recommended_actions: GoogleAdsAgentRecommendedAction[] = decision.actions.map((a) => {
    const priority: "high" | "medium" | "low" =
      a.confidence === "high" ? "high" : a.confidence === "medium" ? "medium" : "low"
    return {
      priority,
      title: `${a.tool.replace(/_/g, " ")} (rank ${a.rank})`,
      reasoning: a.rationale,
      // No deep-link inference in v1 — recommendations queue is the
      // canonical landing spot for every proposed action.
      link: "/admin/ads/recommendations",
    }
  })

  const whatsWorking: string[] = []
  const whatsNot: string[] = []
  if (signals.derived) {
    if (signals.derived.organic_wins_not_in_ads.length > 0) {
      const sample = signals.derived.organic_wins_not_in_ads
        .slice(0, 3)
        .map((o) => `"${o.query}" (#${o.organic_position}, ${o.organic_clicks} clicks)`)
        .join(", ")
      whatsWorking.push(
        `Organic-only wins worth claiming on paid: ${sample}.`,
      )
    }
    if (signals.derived.paid_terms_already_organic.length > 0) {
      const sample = signals.derived.paid_terms_already_organic
        .slice(0, 3)
        .map((p) => `"${p.query}" ($${p.paid_spend_usd.toFixed(0)}, organic #${p.organic_position})`)
        .join(", ")
      whatsNot.push(
        `Paid spend duplicating top-5 organic positions: ${sample}.`,
      )
    }
    if (signals.derived.landing_page_engagement_mismatch.length > 0) {
      whatsNot.push(
        `${signals.derived.landing_page_engagement_mismatch.length} high-CTR campaign(s) feeding low-engagement landing pages — see derived signals.`,
      )
    }
  }
  if (whatsWorking.length === 0) {
    whatsWorking.push(
      `${decision.actions.length} ranked action(s) proposed; see recommendations queue for the full list.`,
    )
  }
  if (whatsNot.length === 0) {
    whatsNot.push(
      signals.gaps.length > 0
        ? `Data gaps lowered confidence this run: ${signals.gaps.join("; ")}.`
        : "No structural leaks surfaced this week; review the proposed actions for incremental upside.",
    )
  }

  const watch_list =
    decision.watch_list.length > 0
      ? decision.watch_list.join(" ")
      : "Standard watch — fresh conversions, sync freshness, and any new pending recommendations."

  return {
    executive_summary: decision.rationale.slice(0, 480),
    whats_working: whatsWorking.slice(0, 4),
    whats_not: whatsNot.slice(0, 4),
    recommended_actions: recommended_actions.slice(0, 8),
    watch_list,
  }
}

function summarizeSignals(signals: AdsSignals): Record<string, unknown> {
  return {
    generated_at: signals.generated_at,
    preflight: signals.preflight,
    gaps: signals.gaps,
    counts: {
      campaigns: signals.raw?.campaigns.length ?? 0,
      search_terms_top_spend: signals.raw?.search_terms_top_spend.length ?? 0,
      search_terms_top_conversions: signals.raw?.search_terms_top_conversions.length ?? 0,
      pending_recommendations: signals.raw?.pending_recommendations.length ?? 0,
      gsc_organic_top10: signals.raw?.gsc_organic_top10.length ?? 0,
      prior_memos: signals.raw?.prior_memos.length ?? 0,
      paid_terms_already_organic: signals.derived?.paid_terms_already_organic.length ?? 0,
      organic_wins_not_in_ads: signals.derived?.organic_wins_not_in_ads.length ?? 0,
      landing_page_engagement_mismatch:
        signals.derived?.landing_page_engagement_mismatch.length ?? 0,
      prior_actions_that_worked: signals.learning?.prior_actions_that_worked.length ?? 0,
      prior_actions_that_failed: signals.learning?.prior_actions_that_failed.length ?? 0,
      promotable_products: signals.promotable_inventory.filter((i) => i.kind === "product").length,
      promotable_events: signals.promotable_inventory.filter((i) => i.kind === "event").length,
    },
  }
}

export interface BuildStrategistMemoOptions {
  source?: GoogleAdsAgentMemoSource
  triggered_by?: string | null
  weekEnd?: Date
  /**
   * Skip the preflight gate. Intended for manual smoke tests from
   * /admin/ads/agent when an admin wants to see the reasoning step run end-
   * to-end on a cold account. Never set true on the scheduled cron path.
   */
  bypassPreflight?: boolean
}

export async function buildStrategistMemo(
  options: BuildStrategistMemoOptions = {},
): Promise<GoogleAdsAgentMemo> {
  const source = options.source ?? "scheduled"
  const weekEnd = options.weekEnd ?? new Date()
  const week_of = mondayOfWeek(weekEnd)
  const subject = `Strategist memo — week of ${new Date(week_of).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`

  // Step 1: gather signals (preflight + raw + derived + learning).
  const signals = await gatherAdsSignals(buildSignalsDeps())

  // Step 2: preflight gate. `bypassPreflight` is the manual-smoke-test
  // escape hatch — the scheduled cron never sets it.
  if (!signals.preflight.ok && !options.bypassPreflight) {
    const memo = await insertAgentMemo({
      week_of,
      subject: `${subject} — preflight failed`,
      sections: {
        ...EMPTY_SECTIONS,
        executive_summary: `Preflight gate blocked memo generation: ${signals.preflight.reasons.join("; ")}`,
      },
      source,
      triggered_by: options.triggered_by ?? null,
      tokens_used: 0,
      brief_id: signals.brief_context?.brief_id ?? null,
      brief_alignment_score: null,
      ran_without_brief: signals.brief_context === null,
    })
    await updateAgentMemoLifecycle(memo.id, {
      signals_summary: summarizeSignals(signals),
      actions: [],
      guardrail_rejections: [],
      outcome_status: "preflight_failed",
    })
    return {
      ...memo,
      signals_summary: summarizeSignals(signals),
      actions: [],
      guardrail_rejections: [],
      outcome_status: "preflight_failed",
      outcome_metrics: null,
    }
  }

  // Step 3: reason via Claude.
  const { decision, tokensUsed } = await reasonAdsDecision(signals)

  // Step 3b: self-critique (Haiku second pass). Gated by feature flag.
  // If overall='should_revise' AND agent_confidence <= 7, re-run reason
  // once with objections appended. Notes persist on the memo regardless.
  const supabase = createServiceRoleClient()
  const flagRow = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "agent_self_critique_enabled")
    .maybeSingle()
  const critiqueEnabled =
    (flagRow.data?.value as { enabled?: boolean } | null)?.enabled !== false

  let finalDecision = decision
  let finalTokensUsed = tokensUsed
  let critiqueNotes: string | null = null

  if (critiqueEnabled) {
    try {
      const critique = await runSelfCritique({
        planSummary: JSON.stringify({
          rationale: decision.rationale,
          actions: decision.actions,
        }),
        signalsSummary: JSON.stringify(signals).slice(0, 4000),
        briefSummary: signals.brief_context
          ? JSON.stringify(signals.brief_context)
          : null,
      })
      critiqueNotes = `[v1 critique] overall=${critique.overall}\nobjections: ${critique.objections.join("; ")}`

      if (shouldReRunAfterCritique(critique, decision.agent_confidence)) {
        const { decision: revised, tokensUsed: revisedTokens } = await reasonAdsDecision(
          signals,
          { critique_objections: critique.objections },
        )
        critiqueNotes = `[v1 plan] ${JSON.stringify(decision.actions.map((a) => a.tool))}\n[critique] ${critique.objections.join("; ")}\n[v2 plan] ${JSON.stringify(revised.actions.map((a) => a.tool))}`
        finalDecision = revised
        finalTokensUsed = tokensUsed + revisedTokens
        console.log(
          `[ads-agent] critique triggered re-run (confidence=${decision.agent_confidence}, overall=${critique.overall})`,
        )
      }
    } catch (critiqueErr) {
      const msg = critiqueErr instanceof Error ? critiqueErr.message : "unknown"
      console.warn(`[ads-agent] self-critique failed, continuing with v1 plan: ${msg}`)
      critiqueNotes = `[v1 critique] failed: ${msg}`
    }
  }

  // Step 4: guardrails (pure-function gate).
  const guardrailResults = applyGuardrailsBatch(
    finalDecision.actions as AdsAction[],
    signals,
  )

  // Step 5: insert the memo row so we have a memo_id to tag recommendations.
  const sections = renderSectionsFromDecision(finalDecision, signals)
  const memo = await insertAgentMemo({
    week_of,
    subject,
    sections,
    source,
    triggered_by: options.triggered_by ?? null,
    tokens_used: finalTokensUsed,
    brief_id: signals.brief_context?.brief_id ?? null,
    brief_alignment_score: finalDecision.brief_alignment_score ?? null,
    ran_without_brief: signals.brief_context === null,
    agent_confidence: finalDecision.agent_confidence,
    dissents_from_brief: finalDecision.dissent_from_upstream.dissents,
    dissent_reason: finalDecision.dissent_from_upstream.reason,
    self_critique_notes: critiqueNotes,
  })

  // Step 6: execute (insert pending recommendation rows for accepted actions).
  const customer_id = (await resolveCustomerId()) ?? "__no_account__"
  const pairs: PreExecutionPair[] = guardrailResults.map((guardrail, idx) => ({
    guardrail,
    originalAction: finalDecision.actions[idx] as AdsAction,
  }))
  const { actions, rejections } = await executeAdsActions(pairs, {
    memo_id: memo.id,
    customer_id,
  })

  // Step 7: stamp the memo with lifecycle results.
  await updateAgentMemoLifecycle(memo.id, {
    signals_summary: summarizeSignals(signals),
    actions,
    guardrail_rejections: rejections,
    outcome_status: "pending",
  })

  return {
    ...memo,
    signals_summary: summarizeSignals(signals),
    actions,
    guardrail_rejections: rejections,
    outcome_status: "pending",
    outcome_metrics: null,
  }
}

export interface AskAgentResult {
  answer: string
  tokens_used: number
}

/**
 * Ad-hoc Q&A. Loads the same snapshot the legacy strategist memo used,
 * prepends it to the system prompt, and asks Claude to answer the admin's
 * question grounded in that data. Returns plain markdown text.
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
