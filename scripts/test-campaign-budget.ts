// scripts/test-campaign-budget.ts
// End-to-end verification of the campaign budget mutate path.
//
//   1. Pick a PAUSED campaign (no live spend during the test).
//   2. Resolve its campaign_budget resource name + current amount via GAQL.
//   3. Bump amount by +$0.01 (10,000 micros) via mutateResourcesRest.
//   4. Read again via GAQL — confirm the new amount.
//   5. Restore to original via mutateResourcesRest.
//   6. Read once more — confirm restored.
//
//   npx tsx scripts/test-campaign-budget.ts             # auto-picks a PAUSED campaign
//   npx tsx scripts/test-campaign-budget.ts <local_id>  # use a specific row

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const DIM = "\x1b[2m"
const RESET = "\x1b[0m"

interface BudgetState {
  resourceName: string
  amountMicros: number
}

async function fetchBudget(
  customerId: string,
  campaignId: string,
): Promise<BudgetState | null> {
  const { searchGoogleAdsRest } = await import("@/lib/ads/google-ads-rest")
  // REST search responses use camelCase keys (`campaignBudget`,
  // `amountMicros`, `resourceName`), unlike the google-ads-api SDK which
  // normalizes to snake_case. Read camelCase here.
  const rows = (await searchGoogleAdsRest(
    customerId,
    `SELECT campaign.campaign_budget, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${campaignId}`,
  )) as Array<{
    campaign?: { campaignBudget?: string }
    campaignBudget?: { resourceName?: string; amountMicros?: string | number }
  }>
  const row = rows[0]
  if (!row) return null
  const resourceName = row.campaignBudget?.resourceName ?? row.campaign?.campaignBudget
  const amountRaw = row.campaignBudget?.amountMicros
  if (!resourceName || amountRaw == null) return null
  return { resourceName, amountMicros: Number(amountRaw) }
}

async function setBudget(
  customerId: string,
  resourceName: string,
  amountMicros: number,
): Promise<void> {
  const { mutateResourcesRest } = await import("@/lib/ads/google-ads-rest")
  await mutateResourcesRest(customerId, [
    {
      entity: "campaign_budget",
      operation: "update",
      resource: resourceName,
      amount_micros: amountMicros,
      update_mask: "amount_micros",
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
    budget_micros: number | null
  }
  let campaignRow: CampaignRow | null = null

  if (requestedId) {
    const { data, error } = await supabase
      .from("google_ads_campaigns")
      .select("id, customer_id, campaign_id, name, status, budget_micros")
      .eq("id", requestedId)
      .maybeSingle()
    if (error) throw error
    campaignRow = (data as CampaignRow | null) ?? null
  } else {
    // Prefer PAUSED so a bump → restore round-trip can't affect live spend.
    const { data } = await supabase
      .from("google_ads_campaigns")
      .select("id, customer_id, campaign_id, name, status, budget_micros")
      .eq("status", "PAUSED")
      .not("budget_micros", "is", null)
      .limit(1)
    campaignRow = ((data?.[0] as CampaignRow | undefined) ?? null)
  }

  if (!campaignRow) {
    console.error(`${RED}No PAUSED campaign with a budget found. Sync first, or pass an explicit local id.${RESET}`)
    process.exit(1)
  }

  console.log(`Testing on:`)
  console.log(`  local id     ${campaignRow.id}`)
  console.log(`  external id  ${campaignRow.campaign_id}`)
  console.log(`  customer     ${campaignRow.customer_id}`)
  console.log(`  name         ${campaignRow.name}`)
  console.log(`  status       ${campaignRow.status}`)
  console.log(
    `  mirror says  $${((campaignRow.budget_micros ?? 0) / 1_000_000).toFixed(2)}/day\n`,
  )

  console.log(`${DIM}1) GAQL read — initial budget${RESET}`)
  const initial = await fetchBudget(campaignRow.customer_id, campaignRow.campaign_id)
  if (!initial) {
    console.error(`${RED}Campaign or its budget not found in Google Ads — mirror may be stale.${RESET}`)
    process.exit(1)
  }
  console.log(`   resource ${initial.resourceName}`)
  console.log(`   amount   ${initial.amountMicros} micros ($${(initial.amountMicros / 1_000_000).toFixed(2)}/day)\n`)

  const delta = 10_000 // $0.01
  const bumped = initial.amountMicros + delta

  console.log(`${DIM}2) Mutate — bump by $0.01 → ${bumped} micros ($${(bumped / 1_000_000).toFixed(2)}/day)${RESET}`)
  await setBudget(campaignRow.customer_id, initial.resourceName, bumped)
  console.log(`   mutateResourcesRest returned ok\n`)

  console.log(`${DIM}3) GAQL read — after bump${RESET}`)
  const afterBump = await fetchBudget(campaignRow.customer_id, campaignRow.campaign_id)
  if (!afterBump) {
    console.error(`${RED}   Budget vanished?? Aborting.${RESET}`)
    process.exit(1)
  }
  console.log(`   Google Ads says: ${afterBump.amountMicros} micros`)
  let bumpOk = afterBump.amountMicros === bumped
  if (!bumpOk) {
    console.error(`${RED}   MISMATCH — expected ${bumped}, got ${afterBump.amountMicros}${RESET}`)
  } else {
    console.log(`${GREEN}   ✓ bump applied${RESET}`)
  }
  console.log()

  console.log(`${DIM}4) Mutate — restore to ${initial.amountMicros} micros${RESET}`)
  await setBudget(campaignRow.customer_id, initial.resourceName, initial.amountMicros)
  console.log(`   mutateResourcesRest returned ok\n`)

  console.log(`${DIM}5) GAQL read — after restore${RESET}`)
  const afterRestore = await fetchBudget(campaignRow.customer_id, campaignRow.campaign_id)
  if (!afterRestore) {
    console.error(`${RED}   Budget vanished after restore?? Manual fix needed.${RESET}`)
    process.exit(1)
  }
  console.log(`   Google Ads says: ${afterRestore.amountMicros} micros`)
  if (afterRestore.amountMicros !== initial.amountMicros) {
    console.error(
      `${RED}   MISMATCH — expected ${initial.amountMicros}, got ${afterRestore.amountMicros}. RESTORE MANUALLY.${RESET}`,
    )
    process.exit(1)
  }
  console.log(`${GREEN}   ✓ restored cleanly${RESET}\n`)

  if (!bumpOk) {
    console.error(`${RED}Test FAILED — bump step did not apply${RESET}`)
    process.exit(1)
  }
  console.log(`${GREEN}All steps passed. Budget returned to $${(initial.amountMicros / 1_000_000).toFixed(2)}/day.${RESET}`)
}

main().catch((err) => {
  console.error(`${RED}Test crashed:${RESET}`, err)
  process.exit(1)
})
