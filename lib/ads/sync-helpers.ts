// lib/ads/sync-helpers.ts
// Pure transforms from `google-ads-api` GAQL response shapes to our DAL input
// shapes. No I/O — easy to unit-test. Functions-side mirror at
// functions/src/ads/sync-helpers.ts must stay in sync (the Functions tsconfig
// can't import from Next.js lib/).

import type { UpsertCampaignInput } from "@/lib/db/google-ads-campaigns"
import type { UpsertAdGroupInput } from "@/lib/db/google-ads-ad-groups"
import type { UpsertKeywordInput } from "@/lib/db/google-ads-keywords"
import type { UpsertAdInput } from "@/lib/db/google-ads-ads"
import type { UpsertDailyMetricInput } from "@/lib/db/google-ads-metrics"
import type { UpsertSearchTermInput } from "@/lib/db/google-ads-search-terms"
import type {
  GoogleAdsCampaignType,
  GoogleAdsKeywordMatchType,
  GoogleAdsResourceStatus,
} from "@/types/database"

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

// The google-ads-api SDK can return enum fields as their numeric proto codes
// (e.g. advertising_channel_type=2, status=3) instead of string names — and it
// does for some campaigns. Map the codes so they don't fall through to the
// UNKNOWN/REMOVED defaults, which silently stored live PAUSED campaigns as
// REMOVED (hiding them) and SEARCH campaigns as UNKNOWN. Codes accepted as
// number or numeric-string (raw_data round-trips through JSON as strings).
const CHANNEL_TYPE_BY_CODE: Record<number, GoogleAdsCampaignType> = {
  2: "SEARCH",
  3: "DISPLAY",
  4: "SHOPPING",
  5: "HOTEL",
  6: "VIDEO",
  7: "APP", // MULTI_CHANNEL
  9: "SMART",
  10: "PERFORMANCE_MAX",
  11: "LOCAL_SERVICES",
  12: "DEMAND_GEN", // DISCOVERY rebranded to Demand Gen
}
const STATUS_BY_CODE: Record<number, GoogleAdsResourceStatus> = {
  2: "ENABLED",
  3: "PAUSED",
  4: "REMOVED",
}
const MATCH_TYPE_BY_CODE: Record<number, GoogleAdsKeywordMatchType> = {
  2: "EXACT",
  3: "PHRASE",
  4: "BROAD",
}

function coerceCampaignType(raw: unknown): GoogleAdsCampaignType {
  if (typeof raw === "string" && CAMPAIGN_TYPE_VALUES.includes(raw as GoogleAdsCampaignType)) {
    return raw as GoogleAdsCampaignType
  }
  const code = typeof raw === "number" ? raw : Number(raw)
  if (Number.isFinite(code) && CHANNEL_TYPE_BY_CODE[code]) return CHANNEL_TYPE_BY_CODE[code]
  return "UNKNOWN"
}
function coerceStatus(raw: unknown): GoogleAdsResourceStatus {
  if (typeof raw === "string" && STATUS_VALUES.includes(raw as GoogleAdsResourceStatus)) {
    return raw as GoogleAdsResourceStatus
  }
  const code = typeof raw === "number" ? raw : Number(raw)
  if (Number.isFinite(code) && STATUS_BY_CODE[code]) return STATUS_BY_CODE[code]
  return "REMOVED"
}
function coerceMatchType(raw: unknown): GoogleAdsKeywordMatchType {
  if (typeof raw === "string" && MATCH_TYPE_VALUES.includes(raw as GoogleAdsKeywordMatchType)) {
    return raw as GoogleAdsKeywordMatchType
  }
  const code = typeof raw === "number" ? raw : Number(raw)
  if (Number.isFinite(code) && MATCH_TYPE_BY_CODE[code]) return MATCH_TYPE_BY_CODE[code]
  return "BROAD"
}

interface CampaignRow {
  campaign?: {
    id?: string | number
    name?: string
    // Enum fields can arrive as the string name ("SEARCH") or the numeric proto
    // code (2) depending on the SDK/response path — coerce* handles both.
    advertising_channel_type?: string | number
    status?: string | number
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

/**
 * The search-terms GAQL query is segmented by segments.keyword.ad_group_criterion,
 * so one (customer, campaign, ad_group, term, date) — the table's unique key —
 * arrives once per matching keyword. A single INSERT .. ON CONFLICT statement
 * cannot touch the same row twice ("ON CONFLICT DO UPDATE command cannot affect
 * row a second time"), so merge duplicates before upserting: sum the metrics,
 * keep the first non-null matched keyword.
 */
export function mergeSearchTermRows(rows: UpsertSearchTermInput[]): UpsertSearchTermInput[] {
  const byKey = new Map<string, UpsertSearchTermInput>()
  for (const r of rows) {
    const key = JSON.stringify([r.customer_id, r.campaign_id, r.ad_group_id, r.search_term, r.date])
    const cur = byKey.get(key)
    if (!cur) {
      byKey.set(key, { ...r })
      continue
    }
    cur.impressions += r.impressions
    cur.clicks += r.clicks
    cur.cost_micros += r.cost_micros
    cur.conversions += r.conversions
    cur.matched_keyword_id = cur.matched_keyword_id ?? r.matched_keyword_id
  }
  return [...byKey.values()]
}
