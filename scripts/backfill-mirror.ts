// scripts/backfill-mirror.ts
// One-shot backfill of the local google_ads_campaigns mirror with the two
// campaigns I created live earlier via apply-rec.ts (before the post-apply
// mirror insert was wired in). Idempotent — uses upsertCampaign.

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

async function main() {
  const { upsertCampaign, listAllCampaigns } = await import("@/lib/db/google-ads-campaigns")

  const campaigns: Parameters<typeof upsertCampaign>[0][] = [
    {
      customer_id: "4974459872",
      campaign_id: "23850618876",
      name: "Rotational Reboot - SEARCH - Purchase",
      type: "SEARCH",
      status: "PAUSED",
      bidding_strategy: "MANUAL_CPC",
      budget_micros: 20_000_000,
      start_date: "2026-05-17",
      end_date: null,
      raw_data: { source: "manual_backfill", reason: "applied before mirror insert was wired" },
    },
    {
      customer_id: "4974459872",
      campaign_id: "23850608760",
      name: "Rotational Reboot - Search - Power Training",
      type: "SEARCH",
      status: "PAUSED",
      bidding_strategy: "MANUAL_CPC",
      budget_micros: 15_000_000,
      start_date: "2026-05-17",
      end_date: null,
      raw_data: { source: "manual_backfill", reason: "applied before mirror insert was wired" },
    },
  ]

  for (const c of campaigns) {
    try {
      await upsertCampaign(c)
      console.log(`✅ upserted ${c.campaign_id} (${c.name})`)
    } catch (err) {
      console.log(`❌ ${c.campaign_id}: ${(err as Error).message}`)
    }
  }

  const all = await listAllCampaigns()
  console.log(`\nMirror now has ${all.length} campaign(s):`)
  for (const c of all) console.log(`  ${c.campaign_id} - ${c.name} - ${c.status}`)
}

main().catch((err) => {
  console.error("Backfill failed:", err)
  process.exit(1)
})
