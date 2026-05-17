// scripts/verify-campaign.ts
// GAQL verification: confirms a campaign created by the apply path actually
// lives in the Google Ads account with the expected state.
//   npx tsx scripts/verify-campaign.ts <campaign_id>

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

async function main() {
  const campaignId = process.argv[2]?.trim()
  if (!campaignId) {
    console.error("Usage: tsx scripts/verify-campaign.ts <campaign_id>")
    process.exit(1)
  }
  const customerId = "4974459872"

  const { searchGoogleAdsRest } = await import("@/lib/ads/google-ads-rest")

  console.log(`=== Campaign ${campaignId} (customer ${customerId}) ===`)
  const campaign = await searchGoogleAdsRest(
    customerId,
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.start_date, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${campaignId}`,
  )
  console.log(JSON.stringify(campaign, null, 2))

  console.log("\n=== Geo criteria ===")
  const geo = await searchGoogleAdsRest(
    customerId,
    `SELECT campaign_criterion.type, campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant, campaign_criterion.keyword.text, campaign_criterion.negative FROM campaign_criterion WHERE campaign.id = ${campaignId}`,
  )
  console.log(JSON.stringify(geo, null, 2))

  console.log("\n=== Ad groups + keyword count ===")
  const adGroups = await searchGoogleAdsRest(
    customerId,
    `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros FROM ad_group WHERE campaign.id = ${campaignId}`,
  )
  console.log(JSON.stringify(adGroups, null, 2))

  console.log("\n=== Ads (RSAs) ===")
  const ads = await searchGoogleAdsRest(
    customerId,
    `SELECT ad_group_ad.status, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions FROM ad_group_ad WHERE campaign.id = ${campaignId}`,
  )
  console.log(JSON.stringify(ads, null, 2))
}

main().catch((err) => {
  console.error("Verify failed:", err)
  process.exit(1)
})
