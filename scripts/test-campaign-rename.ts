// scripts/test-campaign-rename.ts
// End-to-end verification of the campaign rename mutate path.
//
//   1. Pick a campaign from the local mirror (PAUSED preferred — no harm
//      if Google rejects mid-cycle, since live spend is unaffected).
//   2. Read campaign.name from Google Ads via GAQL.
//   3. Append a marker suffix via mutateResourcesRest.
//   4. Read again via GAQL — confirm the new name landed.
//   5. Restore to the original name.
//   6. Read once more — confirm restored.
//
//   npx tsx scripts/test-campaign-rename.ts             # auto-picks a campaign
//   npx tsx scripts/test-campaign-rename.ts <local_id>  # use a specific row

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

import { ResourceNames } from "google-ads-api"

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const DIM = "\x1b[2m"
const RESET = "\x1b[0m"

const SUFFIX = " [rename-test]"

async function fetchName(
  customerId: string,
  campaignId: string,
): Promise<string | null> {
  const { searchGoogleAdsRest } = await import("@/lib/ads/google-ads-rest")
  const rows = (await searchGoogleAdsRest(
    customerId,
    `SELECT campaign.id, campaign.name FROM campaign WHERE campaign.id = ${campaignId}`,
  )) as Array<{ campaign?: { name?: string } }>
  return rows[0]?.campaign?.name ?? null
}

async function setName(
  customerId: string,
  campaignId: string,
  name: string,
): Promise<void> {
  const { mutateResourcesRest } = await import("@/lib/ads/google-ads-rest")
  await mutateResourcesRest(customerId, [
    {
      entity: "campaign",
      operation: "update",
      resource: ResourceNames.campaign(customerId, campaignId),
      name,
      update_mask: "name",
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
  console.log(`  status       ${campaignRow.status}\n`)

  console.log(`${DIM}1) GAQL read — initial name${RESET}`)
  const initial = await fetchName(campaignRow.customer_id, campaignRow.campaign_id)
  if (!initial) {
    console.error(`${RED}Campaign not found in Google Ads — is the mirror stale?${RESET}`)
    process.exit(1)
  }
  console.log(`   Google Ads says: "${initial}"\n`)

  // Defensive: if the script crashed previously and left a suffix on the
  // name, strip it before computing the renamed value so we don't double-tag.
  const baseName = initial.endsWith(SUFFIX) ? initial.slice(0, -SUFFIX.length) : initial
  const renamed = `${baseName}${SUFFIX}`

  console.log(`${DIM}2) Mutate — "${initial}" → "${renamed}"${RESET}`)
  await setName(campaignRow.customer_id, campaignRow.campaign_id, renamed)
  console.log(`   mutateResourcesRest returned ok\n`)

  console.log(`${DIM}3) GAQL read — after rename${RESET}`)
  const afterRename = await fetchName(campaignRow.customer_id, campaignRow.campaign_id)
  console.log(`   Google Ads says: "${afterRename}"`)
  let renameOk = afterRename === renamed
  if (!renameOk) {
    console.error(`${RED}   MISMATCH — expected "${renamed}", got "${afterRename}"${RESET}`)
  } else {
    console.log(`${GREEN}   ✓ rename applied${RESET}`)
  }
  console.log()

  console.log(`${DIM}4) Mutate — restore to "${baseName}"${RESET}`)
  await setName(campaignRow.customer_id, campaignRow.campaign_id, baseName)
  console.log(`   mutateResourcesRest returned ok\n`)

  console.log(`${DIM}5) GAQL read — after restore${RESET}`)
  const afterRestore = await fetchName(campaignRow.customer_id, campaignRow.campaign_id)
  console.log(`   Google Ads says: "${afterRestore}"`)
  if (afterRestore !== baseName) {
    console.error(`${RED}   MISMATCH — expected "${baseName}", got "${afterRestore}". RESTORE MANUALLY.${RESET}`)
    process.exit(1)
  }
  console.log(`${GREEN}   ✓ restored cleanly${RESET}\n`)

  if (!renameOk) {
    console.error(`${RED}Test FAILED — rename step did not apply${RESET}`)
    process.exit(1)
  }
  console.log(`${GREEN}All steps passed. Name returned to "${baseName}".${RESET}`)
}

main().catch((err) => {
  console.error(`${RED}Test crashed:${RESET}`, err)
  process.exit(1)
})
