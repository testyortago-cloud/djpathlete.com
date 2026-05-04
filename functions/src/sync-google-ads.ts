// functions/src/sync-google-ads.ts
// Nightly sync orchestrator for Google Ads. Pulls each active account's
// campaigns / ad_groups / keywords / ads, then ~7 days of daily metrics +
// search terms, and UPSERTs into Supabase. Idempotent — re-running the same
// day is safe; UPSERT keys handle dedup.
//
// The 7-day rewrite window catches Google Ads' attribution lag (conversions
// can backfill up to 7 days after the click). UPSERT semantics overwrite
// older numbers cleanly without polluting history.
//
// `runSyncGoogleAds()` is exported so the index.ts onSchedule + onDocumentCreated
// wrappers can invoke it identically. Never throws on per-account failure —
// each account's last_error is recorded and the next account is attempted.

import { getCustomerClient } from "./ads/client.js"
import {
  getActiveGoogleAdsAccounts,
  getGoogleAdsRefreshToken,
  setGoogleAdsAccountSyncResult,
  upsertAd,
  upsertAdGroup,
  upsertCampaign,
  upsertDailyMetrics,
  upsertKeyword,
  upsertSearchTerms,
} from "./ads/dal.js"
import {
  transformAdGroupRow,
  transformAdRow,
  transformCampaignRow,
  transformKeywordRow,
  transformMetricsRow,
  transformSearchTermRow,
} from "./ads/sync-helpers.js"

export interface SyncGoogleAdsResult {
  accounts_processed: number
  accounts_failed: number
  campaigns_upserted: number
  ad_groups_upserted: number
  keywords_upserted: number
  ads_upserted: number
  daily_metrics_upserted: number
  search_terms_upserted: number
  not_connected?: true
}

const METRICS_LOOKBACK_DAYS = 7

function isoDate(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000)
  return d.toISOString().slice(0, 10)
}

interface SyncDeps {
  getRefreshToken?: typeof getGoogleAdsRefreshToken
  getActiveAccounts?: typeof getActiveGoogleAdsAccounts
  buildCustomerClient?: typeof getCustomerClient
}

export async function runSyncGoogleAds(
  deps: SyncDeps = {},
): Promise<SyncGoogleAdsResult> {
  const getRefreshToken = deps.getRefreshToken ?? getGoogleAdsRefreshToken
  const getActiveAccounts = deps.getActiveAccounts ?? getActiveGoogleAdsAccounts
  const buildCustomerClient = deps.buildCustomerClient ?? getCustomerClient

  const result: SyncGoogleAdsResult = {
    accounts_processed: 0,
    accounts_failed: 0,
    campaigns_upserted: 0,
    ad_groups_upserted: 0,
    keywords_upserted: 0,
    ads_upserted: 0,
    daily_metrics_upserted: 0,
    search_terms_upserted: 0,
  }

  const refreshToken = await getRefreshToken()
  if (!refreshToken) {
    return { ...result, not_connected: true }
  }

  const accounts = await getActiveAccounts()
  const fromDate = isoDate(METRICS_LOOKBACK_DAYS)

  for (const account of accounts) {
    try {
      const customer = buildCustomerClient(account.customer_id, refreshToken)

      // Map external campaign_id → local UUID, used to FK ad_groups
      const localCampaignByExt = new Map<string, string>()

      // 1. Campaigns
      const campaignRows = await customer.query(`
        SELECT campaign.id, campaign.name, campaign.advertising_channel_type,
               campaign.status, campaign.bidding_strategy_type,
               campaign.start_date, campaign.end_date,
               campaign_budget.amount_micros
        FROM campaign
        WHERE campaign.status != 'REMOVED'
      `)
      for (const row of campaignRows as unknown[]) {
        const input = transformCampaignRow(row as never, account.customer_id)
        if (!input.campaign_id) continue
        const c = await upsertCampaign(input)
        localCampaignByExt.set(c.campaign_id, c.id)
        result.campaigns_upserted++
      }

      // 2. Ad groups (per active campaign — short-circuits removed ones)
      const localAdGroupByExt = new Map<string, string>()
      for (const [externalCampaignId, localCampaignId] of localCampaignByExt) {
        const adGroupRows = await customer.query(`
          SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type,
                 ad_group.cpc_bid_micros
          FROM ad_group
          WHERE ad_group.campaign = 'customers/${account.customer_id}/campaigns/${externalCampaignId}'
            AND ad_group.status != 'REMOVED'
        `)
        for (const row of adGroupRows as unknown[]) {
          const input = transformAdGroupRow(row as never, localCampaignId)
          if (!input.ad_group_id) continue
          const ag = await upsertAdGroup(input)
          localAdGroupByExt.set(ag.ad_group_id, ag.id)
          result.ad_groups_upserted++
        }
      }

      // 3. Keywords (only positive — type='KEYWORD' not negative criteria)
      for (const [externalAdGroupId, localAdGroupId] of localAdGroupByExt) {
        const keywordRows = await customer.query(`
          SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
                 ad_group_criterion.keyword.match_type, ad_group_criterion.status,
                 ad_group_criterion.cpc_bid_micros
          FROM ad_group_criterion
          WHERE ad_group_criterion.ad_group = 'customers/${account.customer_id}/adGroups/${externalAdGroupId}'
            AND ad_group_criterion.type = 'KEYWORD'
            AND ad_group_criterion.negative = FALSE
        `)
        for (const row of keywordRows as unknown[]) {
          const input = transformKeywordRow(row as never, localAdGroupId)
          if (!input.criterion_id) continue
          await upsertKeyword(input)
          result.keywords_upserted++
        }

        // 4. Ads (one query per ad group, scoped)
        const adRows = await customer.query(`
          SELECT ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status,
                 ad_group_ad.ad.responsive_search_ad.headlines,
                 ad_group_ad.ad.responsive_search_ad.descriptions,
                 ad_group_ad.ad.final_urls
          FROM ad_group_ad
          WHERE ad_group_ad.ad_group = 'customers/${account.customer_id}/adGroups/${externalAdGroupId}'
            AND ad_group_ad.status != 'REMOVED'
        `)
        for (const row of adRows as unknown[]) {
          const input = transformAdRow(row as never, localAdGroupId)
          if (!input.ad_id) continue
          await upsertAd(input)
          result.ads_upserted++
        }
      }

      // 5. Daily metrics — campaign-grain (the rollup the dashboard uses)
      const campaignMetricsRows = await customer.query(`
        SELECT campaign.id, segments.date,
               metrics.impressions, metrics.clicks, metrics.cost_micros,
               metrics.conversions, metrics.conversions_value
        FROM campaign
        WHERE segments.date >= '${fromDate}'
          AND campaign.status != 'REMOVED'
      `)
      const campaignMetrics = (campaignMetricsRows as unknown[]).map((row) =>
        transformMetricsRow(row as never, account.customer_id),
      )
      result.daily_metrics_upserted += await upsertDailyMetrics(campaignMetrics)

      // 6. Search terms (last 7 days; powers Plan 1.2 negative-keyword recs)
      const searchTermRows = await customer.query(`
        SELECT search_term_view.search_term, segments.date,
               segments.keyword.ad_group_criterion,
               metrics.impressions, metrics.clicks, metrics.cost_micros,
               metrics.conversions,
               campaign.id, ad_group.id
        FROM search_term_view
        WHERE segments.date >= '${fromDate}'
      `)
      const searchTerms = (searchTermRows as unknown[]).map((row) =>
        transformSearchTermRow(row as never, account.customer_id),
      )
      result.search_terms_upserted += await upsertSearchTerms(searchTerms)

      await setGoogleAdsAccountSyncResult(account.customer_id, { last_error: null })
      result.accounts_processed++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[syncGoogleAds] account ${account.customer_id} failed:`, message)
      try {
        await setGoogleAdsAccountSyncResult(account.customer_id, { last_error: message })
      } catch (writeErr) {
        console.error("[syncGoogleAds] failed to record error:", writeErr)
      }
      result.accounts_failed++
    }
  }

  return result
}
