// functions/src/ads/types.ts
// Functions-side types for Google Ads sync. Kept narrow — only what the
// orchestrator + DAL needs, since functions/tsconfig.json restricts rootDir
// to src/ and can't import from the Next.js types/database.ts.

export type GoogleAdsAutomationMode = "auto_pilot" | "co_pilot" | "advisory"
export type GoogleAdsResourceStatus = "ENABLED" | "PAUSED" | "REMOVED"
export type GoogleAdsCampaignType =
  | "SEARCH"
  | "VIDEO"
  | "PERFORMANCE_MAX"
  | "DISPLAY"
  | "SHOPPING"
  | "DEMAND_GEN"
  | "LOCAL_SERVICES"
  | "APP"
  | "HOTEL"
  | "SMART"
  | "UNKNOWN"
export type GoogleAdsKeywordMatchType = "EXACT" | "PHRASE" | "BROAD"

export interface GoogleAdsAccount {
  customer_id: string
  is_active: boolean
  last_synced_at: string | null
  last_error: string | null
}

export interface UpsertCampaignInput {
  customer_id: string
  campaign_id: string
  name: string
  type: GoogleAdsCampaignType
  status: GoogleAdsResourceStatus
  bidding_strategy?: string | null
  budget_micros?: number | null
  start_date?: string | null
  end_date?: string | null
  raw_data?: Record<string, unknown> | null
}

export interface UpsertAdGroupInput {
  campaign_id: string
  ad_group_id: string
  name: string
  status: GoogleAdsResourceStatus
  type?: string | null
  cpc_bid_micros?: number | null
  raw_data?: Record<string, unknown> | null
}

export interface UpsertKeywordInput {
  ad_group_id: string
  criterion_id: string
  text: string
  match_type: GoogleAdsKeywordMatchType
  status: GoogleAdsResourceStatus
  cpc_bid_micros?: number | null
  raw_data?: Record<string, unknown> | null
}

export interface UpsertAdInput {
  ad_group_id: string
  ad_id: string
  type: string
  status: GoogleAdsResourceStatus
  headlines: Array<{ text: string }>
  descriptions: Array<{ text: string }>
  final_urls: string[]
  raw_data?: Record<string, unknown> | null
}

export interface UpsertDailyMetricInput {
  customer_id: string
  campaign_id: string
  ad_group_id?: string | null
  keyword_criterion_id?: string | null
  date: string
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  conversion_value: number
  raw_data?: Record<string, unknown> | null
}

export interface UpsertSearchTermInput {
  customer_id: string
  campaign_id: string
  ad_group_id: string
  search_term: string
  date: string
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  matched_keyword_id?: string | null
}
