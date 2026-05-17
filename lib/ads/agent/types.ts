// lib/ads/agent/types.ts
// Shared types across signals/decision/guardrails/execute/outcomes.

import type {
  GoogleAdsAgentMemoAction,
  GoogleAdsAgentMemoGuardrailRejection,
} from "@/types/database"
import type { BriefContext } from "@/lib/strategy/specialist-contract"

export interface PreflightResult {
  ok: boolean
  reasons: string[]
}

export interface AdsRawInputs {
  campaigns: Array<{
    id: string
    name: string
    status: string
    daily_budget_usd: number
    created_at: string
    last_7d_conversions: number
    metrics_28d: {
      clicks: number
      impressions: number
      ctr: number
      conversions: number
      cvr: number
      cost_usd: number
      cac_usd: number | null
      roas: number | null
      impression_share: number | null
      impression_share_lost_budget: number | null
      impression_share_lost_rank: number | null
    }
  }>
  search_terms_top_spend: Array<{
    text: string
    campaign_id: string
    cost_usd: number
    clicks: number
    conversions: number
  }>
  search_terms_top_conversions: Array<{
    text: string
    campaign_id: string
    cost_usd: number
    clicks: number
    conversions: number
  }>
  pending_recommendations: Array<{ id: string; type: string; campaign_id: string | null }>
  conversion_actions: Array<{
    id: string
    name: string
    last_conversion_at: string | null
  }>
  ga4: {
    sessions_by_source_medium: Array<{
      source: string
      medium: string
      sessions: number
      conversions: number
    }>
    landing_page_engagement: Array<{
      page_path: string
      engagement_rate: number
      sessions: number
    }>
  }
  gsc_organic_top10: Array<{
    query: string
    page: string
    position: number
    clicks: number
    impressions: number
  }>
  pipeline: {
    visits: number
    signups: number
    bookings: number
    payments: number
    visits_to_signup: number
    signup_to_booking: number
    booking_to_payment: number
  }
  prior_memos: Array<{
    id: string
    week_of: string
    actions: GoogleAdsAgentMemoAction[]
    outcome_status: string
    outcome_metrics: Record<string, unknown> | null
  }>
}

export interface AdsDerivedSignals {
  paid_terms_already_organic: Array<{
    query: string
    paid_spend_usd: number
    organic_position: number
    organic_page: string
  }>
  organic_wins_not_in_ads: Array<{
    query: string
    organic_clicks: number
    organic_position: number
  }>
  landing_page_engagement_mismatch: Array<{
    campaign_id: string
    ctr: number
    landing_page: string
    engagement_rate: number
  }>
}

export interface AdsLearningLayer {
  winning_keywords: Array<{
    campaign_id: string
    ad_group_id: string
    text: string
    conversions: number
    cvr: number
  }>
  winning_audiences: Array<{ audience_id: string; cvr_trend: number[] }>
  winning_ad_creative: Array<{
    ad_id: string
    headlines: string[]
    ctr: number
    cvr: number
    score: number
  }>
  winning_schedule: Array<{
    campaign_id: string
    day_of_week: number
    hour_of_day: number
    cvr_multiplier: number
  }>
  winning_geos: Array<{
    campaign_id: string
    region: string
    cvr_multiplier: number
    conversions: number
  }>
  prior_actions_that_worked: Array<{
    tool: string
    args_summary: string
    observed_delta: number
    weeks_ago: number
  }>
  prior_actions_that_failed: Array<{
    tool: string
    args_summary: string
    observed_delta: number
    weeks_ago: number
  }>
}

export interface AdsToolPerformanceEntry {
  tool: string
  n_measured: number
  avg_impact_score: number
  p95_abs_delta: number
  success_rate: number
}

/**
 * Promotable inventory: things the agent can propose a campaign for.
 * Two sources merged into one shape so the reasoning prompt sees a single
 * list — always-on programs from `marketing_products`, plus specific
 * upcoming clinic/camp instances from `events`.
 */
export interface PromotableInventoryItem {
  kind: "product" | "event"
  /** Stable identifier — products use `slug`, events use `id`. */
  ref: string
  name: string
  one_liner: string
  target_audience: string
  /** Phrases the agent uses to seed keyword themes + cross-reference GSC. */
  signature_phrases: string[]
  /** Customer pains. Drive ad-copy headline/description suggestions. */
  pain_points: string[]
  /** Site path the campaign should drive to (e.g. /programs/rotational-reboot). */
  landing_url: string
  /** Free-form geo focus (ISO codes for online; local descriptors like "Tampa Bay, FL" for in-person). */
  geo_focus: string[]
  conversion_type: "purchase" | "lead" | "booking"
  price_cents: number | null
  /** Event-only — campaign should end the day before. ISO date when set. */
  event_start_date: string | null
  /** Event-only — derived from start_date in days. Null for products. */
  days_until_event: number | null
  /** Event-only — capacity - signup_count. Null for products. */
  spots_remaining: number | null
  /** Event-only — `age_min`-`age_max` joined, or null. */
  age_range: string | null
  /** Event-only — raw location_name; the agent infers geo from this. */
  location_name: string | null
  /** Event-only — earliest day pre-event to start paid acquisition (heuristic from price/duration/type). */
  paid_window_open_days_before: number | null
  /** Event-only — latest day pre-event where paid still has time to compound. */
  paid_window_close_days_before: number | null
  /**
   * Event-only seasonal-lift state. Drives the agent's `propose_new_campaign`
   * decision for events:
   *  - too_early: outside window, advise waiting
   *  - in_window: paid acquisition makes sense now
   *  - closing_soon: in window but <7 days remain — push hard or accept skip
   *  - too_late: past the window, propose flag_for_human for the next cycle
   */
  paid_window_state: "too_early" | "in_window" | "closing_soon" | "too_late" | null
  /** Coach-only context. */
  notes: string | null
}

export interface AdsSignals {
  generated_at: string
  preflight: PreflightResult
  raw: AdsRawInputs | null
  derived: AdsDerivedSignals | null
  learning: AdsLearningLayer | null
  gaps: string[]
  brief_context: BriefContext | null
  /** Per-tool aggregates from agent_tool_baselines + recent measured memos. Empty array when no rows. */
  tool_performance: AdsToolPerformanceEntry[]
  /**
   * Recent winning examples populated by the performance-learning-loop
   * onto the (global, ads_agent) prompt_templates row. Empty when the
   * column is null/empty or the carrier row is missing. Rendered into
   * the user message as a "Recent winners" block.
   */
  few_shots: string[]
  /**
   * Always-on programs + specific upcoming clinic/camp events the agent
   * should consider when proposing campaigns. Empty when no products are
   * seeded AND no upcoming events exist. The agent should prefer concrete
   * blueprints tied to an inventory item over generic strategy.
   */
  promotable_inventory: PromotableInventoryItem[]
}

export type AdsActionTool =
  | "propose_budget_shift"
  | "propose_new_keywords"
  | "propose_negative_keywords"
  | "propose_ad_copy_test"
  | "propose_audience_expansion"
  | "propose_new_campaign"
  | "propose_campaign_pause"
  | "propose_campaign_split"
  | "propose_match_type_change"
  | "propose_bid_strategy_review"
  | "flag_for_human"

export interface AdsAction {
  rank: number
  tool: AdsActionTool
  args: Record<string, unknown>
  rationale: string
  expected_metric: "CTR" | "CVR" | "CAC" | "ROAS" | "spend_efficiency" | "impression_share"
  expected_direction: "increase" | "decrease"
  confidence: "low" | "medium" | "high"
  supporting_signals: string[]
}

export type GuardrailResult =
  | { kind: "pass"; action: AdsAction; annotations: GuardrailAnnotations }
  | { kind: "reject"; reason: string }

export interface GuardrailAnnotations {
  significance: "sig" | "underpowered" | "insufficient_data"
  audit_confidence: "low" | "medium" | "high"
  seasonality_flag: boolean
  clamped: boolean
}

export type { GoogleAdsAgentMemoAction, GoogleAdsAgentMemoGuardrailRejection }
