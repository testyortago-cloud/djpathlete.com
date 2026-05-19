// scripts/test-campaign-toggle.ts
// End-to-end verification of the campaign pause/resume mutate path.
//
//   1. Pick a real campaign from the local mirror (PAUSED preferred — if the
//      script crashes mid-cycle the campaign stays in the original state).
//   2. Read its status from Google Ads via GAQL.
//   3. Flip status via the same mutateResourcesRest call the API route uses.
//   4. Read again via GAQL — confirm Google Ads sees the new state.
//   5. Restore to the original status.
//   6. Read once more — confirm restored.
//
//   npx tsx scripts/test-campaign-toggle.ts             # auto-picks a campaign
//   npx tsx scripts/test-campaign-toggle.ts <local_id>  # use a specific row

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

import { ResourceNames } from "google-ads-api"

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const DIM = "\x1b[2m"
const RESET = "\x1b[0m"

async function fetchRemoteStatus(
  customerId: string,
  campaignId: string,
): Promise<string | null> {
  const { searchGoogleAdsRest } = await import("@/lib/ads/google-ads-rest")
  const rows = (await searchGoogleAdsRest(
    customerId,
    `SELECT campaign.id, campaign.status FROM campaign WHERE campaign.id = ${campaignId}`,
  )) as Array<{ campaign?: { status?: string } }>
  return rows[0]?.campaign?.status ?? null
}

async function flipStatus(
  customerId: string,
  campaignId: string,
  toStatus: "ENABLED" | "PAUSED",
): Promise<void> {
  const { mutateResourcesRest } = await import("@/lib/ads/google-ads-rest")
  await mutateResourcesRest(customerId, [
    {
      entity: "campaign",
      operation: "update",
      resource: ResourceNames.campaign(customerId, campaignId),
      status: toStatus,
      update_mask: "status",
    },
  ])
}

async function main() {
  const requestedId = process.argv[2]?.trim()

  const { createServiceRoleClient } = await import("@/lib/supabase")
  const supabase = createServiceRoleClient()

  interface CampaignRow {
    id: string
    customer_id: string
    campaign_id: string
    name: string
    status: string
  }
  let campaignRow: CampaignRow | null = null

  if (requestedId) {
    const { data, error } = await supabase
      .from("google_ads_campaigns")
      .select("id, customer_id, campaign_id, name, status")
      .eq("id", requestedId)
      .maybeSingle()
    if (error) throw error
    campaignRow = (data as CampaignRow | null) ?? null
  } else {
    // Prefer PAUSED so the cycle is PAUSED→ENABLED→PAUSED. If something fails
    // partway, the campaign ends up ENABLED at worst, which is recoverable
    // by re-running. Fall back to any non-REMOVED campaign.
    const { data: paused } = await supabase
      .from("google_ads_campaigns")
      .select("id, customer_id, campaign_id, name, status")
      .eq("status", "PAUSED")
      .limit(1)
    if (paused && paused.length > 0) {
      campaignRow = paused[0] as CampaignRow
    } else {
      const { data: any_ } = await supabase
        .from("google_ads_campaigns")
        .select("id, customer_id, campaign_id, name, status")
        .neq("status", "REMOVED")
        .limit(1)
      campaignRow = ((any_?.[0] as CampaignRow | undefined) ?? null)
    }
  }

  if (!campaignRow) {
    console.error(`${RED}No campaign found to test against. Sync your account first.${RESET}`)
    process.exit(1)
  }

  console.log(`Testing on:`)
  console.log(`  local id     ${campaignRow.id}`)
  console.log(`  external id  ${campaignRow.campaign_id}`)
  console.log(`  customer     ${campaignRow.customer_id}`)
  console.log(`  name         ${campaignRow.name}`)
  console.log(`  mirror says  ${campaignRow.status}\n`)

  console.log(`${DIM}1) GAQL read — initial state${RESET}`)
  const initial = await fetchRemoteStatus(campaignRow.customer_id, campaignRow.campaign_id)
  if (!initial) {
    console.error(`${RED}Campaign not found in Google Ads — is the mirror stale?${RESET}`)
    process.exit(1)
  }
  console.log(`   Google Ads says: ${initial}\n`)

  if (initial !== "ENABLED" && initial !== "PAUSED") {
    console.error(`${RED}Campaign is ${initial}; refusing to round-trip a non-active campaign.${RESET}`)
    process.exit(1)
  }

  const flipped: "ENABLED" | "PAUSED" = initial === "ENABLED" ? "PAUSED" : "ENABLED"

  console.log(`${DIM}2) Mutate — ${initial} → ${flipped}${RESET}`)
  await flipStatus(campaignRow.customer_id, campaignRow.campaign_id, flipped)
  console.log(`   mutateResourcesRest returned ok\n`)

  console.log(`${DIM}3) GAQL read — after flip${RESET}`)
  const afterFlip = await fetchRemoteStatus(campaignRow.customer_id, campaignRow.campaign_id)
  console.log(`   Google Ads says: ${afterFlip}`)
  if (afterFlip !== flipped) {
    console.error(`${RED}   MISMATCH — expected ${flipped}, got ${afterFlip}${RESET}`)
    // Still attempt to restore so we don't leave the account in a bad state
  } else {
    console.log(`${GREEN}   ✓ flip applied${RESET}`)
  }
  console.log()

  console.log(`${DIM}4) Mutate — restore to ${initial}${RESET}`)
  await flipStatus(campaignRow.customer_id, campaignRow.campaign_id, initial as "ENABLED" | "PAUSED")
  console.log(`   mutateResourcesRest returned ok\n`)

  console.log(`${DIM}5) GAQL read — after restore${RESET}`)
  const afterRestore = await fetchRemoteStatus(campaignRow.customer_id, campaignRow.campaign_id)
  console.log(`   Google Ads says: ${afterRestore}`)
  if (afterRestore !== initial) {
    console.error(`${RED}   MISMATCH — expected ${initial}, got ${afterRestore}${RESET}`)
    process.exit(1)
  }
  console.log(`${GREEN}   ✓ restored cleanly${RESET}\n`)

  if (afterFlip !== flipped) {
    console.error(`${RED}Test FAILED — flip step did not apply${RESET}`)
    process.exit(1)
  }
  console.log(`${GREEN}All steps passed. Campaign returned to ${initial}.${RESET}`)
}

main().catch((err) => {
  console.error(`${RED}Test crashed:${RESET}`, err)
  process.exit(1)
})
