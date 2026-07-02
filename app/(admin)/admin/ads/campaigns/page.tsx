import Link from "next/link"
import { listAllAdGroups } from "@/lib/db/google-ads-ad-groups"
import { listAllAds } from "@/lib/db/google-ads-ads"
import { listAllCampaigns } from "@/lib/db/google-ads-campaigns"
import { getCampaignRollup } from "@/lib/db/google-ads-metrics"
import { listGoogleAdsAccounts } from "@/lib/db/google-ads-accounts"
import type { GoogleAdsAd } from "@/types/database"
import type { AdGroupWithAds } from "./AdGroupAdList"
import { CampaignsTable, type CampaignWithMetrics } from "./CampaignsTable"
import { SyncNowButton } from "./SyncNowButton"

export const metadata = { title: "Google Ads — Campaigns" }
export const dynamic = "force-dynamic"

function isoDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
}

export default async function CampaignsPage() {
  const [campaigns, accounts, adGroups, ads] = await Promise.all([
    listAllCampaigns(),
    listGoogleAdsAccounts(),
    listAllAdGroups(),
    listAllAds(),
  ])

  // Fetch 7-day rollup once per Customer ID, then merge into each campaign row
  const fromDate = isoDate(7)
  const toDate = isoDate(0)
  const rollupByCampaign = new Map<string, ReturnType<typeof emptyRollup>>()
  await Promise.all(
    accounts
      .filter((a) => a.is_active)
      .map(async (a) => {
        const map = await getCampaignRollup(a.customer_id, fromDate, toDate)
        for (const [cid, val] of map) rollupByCampaign.set(cid, val)
      }),
  )

  const enriched: CampaignWithMetrics[] = campaigns.map((c) => {
    const r = rollupByCampaign.get(c.campaign_id)
    return {
      ...c,
      cost_micros_7d: r?.cost_micros ?? 0,
      clicks_7d: r?.clicks ?? 0,
      conversions_7d: r?.conversions ?? 0,
      conversion_value_7d: r?.conversion_value ?? 0,
    }
  })

  const lastSynced =
    accounts
      .map((a) => a.last_synced_at)
      .filter((s): s is string => Boolean(s))
      .sort()
      .at(-1) ?? null

  // Group ads under their ad group, then ad groups under their campaign, so
  // the drill-down UI can render everything from a single lookup keyed by
  // the (local UUID) campaign id.
  const adsByAdGroup = new Map<string, GoogleAdsAd[]>()
  for (const ad of ads) {
    const arr = adsByAdGroup.get(ad.ad_group_id) ?? []
    arr.push(ad)
    adsByAdGroup.set(ad.ad_group_id, arr)
  }
  const adGroupsByCampaign: Record<string, AdGroupWithAds[]> = {}
  for (const ag of adGroups) {
    const group = { ...ag, ads: adsByAdGroup.get(ag.id) ?? [] }
    ;(adGroupsByCampaign[ag.campaign_id] ??= []).push(group)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading text-primary">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Synced nightly at 06:00 UTC. Spend / clicks / conversions reflect the last 7 days.{" "}
            {lastSynced ? (
              <>
                Last synced{" "}
                <span className="font-mono text-xs">
                  {new Date(lastSynced).toLocaleString()}
                </span>
                .
              </>
            ) : (
              <>
                Not yet synced —{" "}
                <Link href="/admin/ads/settings" className="underline hover:text-accent">
                  connect your account
                </Link>{" "}
                first.
              </>
            )}
          </p>
        </div>
        <SyncNowButton />
      </div>

      <CampaignsTable campaigns={enriched} adGroupsByCampaign={adGroupsByCampaign} />
    </div>
  )
}

function emptyRollup() {
  return { campaign_id: "", impressions: 0, clicks: 0, cost_micros: 0, conversions: 0, conversion_value: 0 }
}
