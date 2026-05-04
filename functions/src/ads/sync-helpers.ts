// functions/src/ads/sync-helpers.ts
// Mirror of lib/ads/sync-helpers.ts (Next.js side). Pure transforms from
// google-ads-api GAQL response shapes to DAL input shapes. Keep both files
// in sync manually — Functions tsconfig can't import across rootDir.

import type {
  GoogleAdsCampaignType,
  GoogleAdsKeywordMatchType,
  GoogleAdsResourceStatus,
  UpsertAdGroupInput,
  UpsertAdInput,
  UpsertCampaignInput,
  UpsertDailyMetricInput,
  UpsertKeywordInput,
  UpsertSearchTermInput,
} from "./types.js"

const CAMPAIGN_TYPE_VALUES: GoogleAdsCampaignType[] = [
  "SEARCH",
  "VIDEO",
  "PERFORMANCE_MAX",
  "DISPLAY",
  "SHOPPING",
  "DEMAND_GEN",
  "LOCAL_SERVICES",
  "APP",
  "HOTEL",
  "SMART",
  "UNKNOWN",
]
const STATUS_VALUES: GoogleAdsResourceStatus[] = ["ENABLED", "PAUSED", "REMOVED"]
const MATCH_TYPE_VALUES: GoogleAdsKeywordMatchType[] = ["EXACT", "PHRASE", "BROAD"]

function coerceCampaignType(raw: unknown): GoogleAdsCampaignType {
  return CAMPAIGN_TYPE_VALUES.includes(raw as GoogleAdsCampaignType)
    ? (raw as GoogleAdsCampaignType)
    : "UNKNOWN"
}
function coerceStatus(raw: unknown): GoogleAdsResourceStatus {
  return STATUS_VALUES.includes(raw as GoogleAdsResourceStatus)
    ? (raw as GoogleAdsResourceStatus)
    : "REMOVED"
}
function coerceMatchType(raw: unknown): GoogleAdsKeywordMatchType {
  return MATCH_TYPE_VALUES.includes(raw as GoogleAdsKeywordMatchType)
    ? (raw as GoogleAdsKeywordMatchType)
    : "BROAD"
}

interface CampaignRow {
  campaign?: {
    id?: string | number
    name?: string
    advertising_channel_type?: string
    status?: string
    bidding_strategy_type?: string
    start_date?: string | null
    end_date?: string | null
  }
  campaign_budget?: { amount_micros?: string | number | null }
}

export function transformCampaignRow(row: CampaignRow, customer_id: string): UpsertCampaignInput {
  const c = row.campaign ?? {}
  return {
    customer_id,
    campaign_id: String(c.id ?? ""),
    name: c.name ?? "",
    type: coerceCampaignType(c.advertising_channel_type),
    status: coerceStatus(c.status),
    bidding_strategy: c.bidding_strategy_type ?? null,
    budget_micros:
      row.campaign_budget?.amount_micros != null
        ? Number(row.campaign_budget.amount_micros)
        : null,
    start_date: c.start_date ?? null,
    end_date: c.end_date ?? null,
    raw_data: row as unknown as Record<string, unknown>,
  }
}

interface AdGroupRow {
  ad_group?: {
    id?: string | number
    name?: string
    status?: string
    type?: string
    cpc_bid_micros?: string | number | null
  }
}

export function transformAdGroupRow(
  row: AdGroupRow,
  localCampaignId: string,
): UpsertAdGroupInput {
  const ag = row.ad_group ?? {}
  return {
    campaign_id: localCampaignId,
    ad_group_id: String(ag.id ?? ""),
    name: ag.name ?? "",
    status: coerceStatus(ag.status),
    type: ag.type ?? null,
    cpc_bid_micros: ag.cpc_bid_micros != null ? Number(ag.cpc_bid_micros) : null,
    raw_data: row as unknown as Record<string, unknown>,
  }
}

interface KeywordRow {
  ad_group_criterion?: {
    criterion_id?: string | number
    keyword?: { text?: string; match_type?: string }
    status?: string
    cpc_bid_micros?: string | number | null
  }
}

export function transformKeywordRow(
  row: KeywordRow,
  localAdGroupId: string,
): UpsertKeywordInput {
  const k = row.ad_group_criterion ?? {}
  return {
    ad_group_id: localAdGroupId,
    criterion_id: String(k.criterion_id ?? ""),
    text: k.keyword?.text ?? "",
    match_type: coerceMatchType(k.keyword?.match_type),
    status: coerceStatus(k.status),
    cpc_bid_micros: k.cpc_bid_micros != null ? Number(k.cpc_bid_micros) : null,
    raw_data: row as unknown as Record<string, unknown>,
  }
}

interface AdRow {
  ad_group_ad?: {
    ad?: {
      id?: string | number
      type?: string
      responsive_search_ad?: {
        headlines?: Array<{ text?: string }>
        descriptions?: Array<{ text?: string }>
      }
      final_urls?: string[]
    }
    status?: string
  }
}

export function transformAdRow(row: AdRow, localAdGroupId: string): UpsertAdInput {
  const ad = row.ad_group_ad?.ad ?? {}
  return {
    ad_group_id: localAdGroupId,
    ad_id: String(ad.id ?? ""),
    type: ad.type ?? "RESPONSIVE_SEARCH_AD",
    status: coerceStatus(row.ad_group_ad?.status),
    headlines: (ad.responsive_search_ad?.headlines ?? [])
      .filter((h): h is { text: string } => typeof h.text === "string")
      .map((h) => ({ text: h.text })),
    descriptions: (ad.responsive_search_ad?.descriptions ?? [])
      .filter((d): d is { text: string } => typeof d.text === "string")
      .map((d) => ({ text: d.text })),
    final_urls: ad.final_urls ?? [],
    raw_data: row as unknown as Record<string, unknown>,
  }
}

interface MetricsRow {
  segments?: { date?: string }
  metrics?: {
    impressions?: string | number
    clicks?: string | number
    cost_micros?: string | number
    conversions?: string | number
    conversions_value?: string | number
  }
  campaign?: { id?: string | number }
  ad_group?: { id?: string | number }
  ad_group_criterion?: { criterion_id?: string | number }
}

export function transformMetricsRow(
  row: MetricsRow,
  customer_id: string,
): UpsertDailyMetricInput {
  const m = row.metrics ?? {}
  return {
    customer_id,
    campaign_id: String(row.campaign?.id ?? ""),
    ad_group_id: row.ad_group?.id != null ? String(row.ad_group.id) : null,
    keyword_criterion_id:
      row.ad_group_criterion?.criterion_id != null
        ? String(row.ad_group_criterion.criterion_id)
        : null,
    date: row.segments?.date ?? new Date().toISOString().slice(0, 10),
    impressions: Number(m.impressions ?? 0),
    clicks: Number(m.clicks ?? 0),
    cost_micros: Number(m.cost_micros ?? 0),
    conversions: Number(m.conversions ?? 0),
    conversion_value: Number(m.conversions_value ?? 0),
    raw_data: row as unknown as Record<string, unknown>,
  }
}

interface SearchTermRow {
  search_term_view?: { search_term?: string }
  segments?: { date?: string; keyword?: { ad_group_criterion?: string } }
  metrics?: {
    impressions?: string | number
    clicks?: string | number
    cost_micros?: string | number
    conversions?: string | number
  }
  campaign?: { id?: string | number }
  ad_group?: { id?: string | number }
}

export function transformSearchTermRow(
  row: SearchTermRow,
  customer_id: string,
): UpsertSearchTermInput {
  const m = row.metrics ?? {}
  return {
    customer_id,
    campaign_id: String(row.campaign?.id ?? ""),
    ad_group_id: String(row.ad_group?.id ?? ""),
    search_term: row.search_term_view?.search_term ?? "",
    date: row.segments?.date ?? new Date().toISOString().slice(0, 10),
    impressions: Number(m.impressions ?? 0),
    clicks: Number(m.clicks ?? 0),
    cost_micros: Number(m.cost_micros ?? 0),
    conversions: Number(m.conversions ?? 0),
    matched_keyword_id: row.segments?.keyword?.ad_group_criterion ?? null,
  }
}
