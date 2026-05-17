// scripts/create-conversion-actions.ts
// Creates the missing WEBPAGE conversion actions in customer 4974459872 so
// the Rotational Reboot (purchase) and Assessment (lead-gen) campaigns have
// something other than "Calls from ads" to optimize against.
//
// What gets created:
//   1. Purchase — Rotational Reboot          ($79 default value, PURCHASE)
//   2. Assessment Form Submission            ($0 lead value, SUBMIT_LEAD_FORM)
//
// Both are WEBPAGE type — Google generates a snippet you (or GTM) install on
// the success/thank-you page (e.g. /shop/orders/[orderNumber]/thank-you).
// Until the snippet fires, the action exists but reports zero conversions.
//
// Once these are created, all Search campaigns in the account auto-inherit
// them — no per-campaign mutation needed (selective_optimization is for
// App campaigns only).
//
// Usage: npx tsx scripts/create-conversion-actions.ts [--dry-run]

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

const CUSTOMER_ID = "4974459872"
const DRY_RUN = process.argv.includes("--dry-run")

interface ConversionActionCreate {
  name: string
  category: "PURCHASE" | "SUBMIT_LEAD_FORM" | "BOOKING" | "SIGNUP"
  default_value_usd: number
  description: string
}

const ACTIONS_TO_CREATE: ConversionActionCreate[] = [
  {
    name: "Rotational Reboot Purchase",
    category: "PURCHASE",
    default_value_usd: 79.0,
    description: "$79 Rotational Reboot program purchase — fires on /shop/orders/.../thank-you",
  },
  {
    name: "Assessment Form Submission",
    category: "SUBMIT_LEAD_FORM",
    default_value_usd: 0,
    description: "Lead capture — fires on /assessment form submit success",
  },
]

async function main() {
  const { searchGoogleAdsRest, mutateResourcesRest } = await import(
    "@/lib/ads/google-ads-rest"
  )

  // ── Skip if an ENABLED action with same category+name already exists ──
  const existing = (await searchGoogleAdsRest(
    CUSTOMER_ID,
    "SELECT conversion_action.id, conversion_action.name, conversion_action.category, conversion_action.status FROM conversion_action WHERE conversion_action.status = 'ENABLED'",
  )) as Array<{
    conversionAction: { id: string; name: string; category: string; status: string }
  }>
  console.log("=== Existing enabled conversion actions ===")
  for (const e of existing) {
    console.log(`  [${e.conversionAction.category}] ${e.conversionAction.name} (${e.conversionAction.id})`)
  }

  const ops: Parameters<typeof mutateResourcesRest>[1] = []
  const planned: string[] = []
  const skipped: string[] = []

  for (const action of ACTIONS_TO_CREATE) {
    const dup = existing.find(
      (e) =>
        e.conversionAction.name.toLowerCase() === action.name.toLowerCase() ||
        (e.conversionAction.category === action.category &&
          e.conversionAction.category !== "PHONE_CALL_LEAD"),
    )
    if (dup) {
      skipped.push(
        `${action.name} — already exists as "${dup.conversionAction.name}" (${dup.conversionAction.id})`,
      )
      continue
    }
    planned.push(`${action.name} [${action.category}] $${action.default_value_usd.toFixed(2)}`)
    ops.push({
      entity: "conversion_action",
      operation: "create",
      // No resource — let Google assign the ID.
      name: action.name,
      category: action.category,
      type: "WEBPAGE",
      status: "ENABLED",
      // primary_for_goal=true: this action counts toward the standard
      // conversion goal for its category and contributes to Smart Bidding.
      primary_for_goal: true,
      value_settings: {
        default_value: action.default_value_usd,
        default_currency_code: "USD",
        always_use_default_value: action.default_value_usd > 0,
      },
      counting_type: action.category === "PURCHASE" ? "MANY_PER_CLICK" : "ONE_PER_CLICK",
      click_through_lookback_window_days: 30,
      view_through_lookback_window_days: 1,
      attribution_model_settings: {
        attribution_model: "GOOGLE_ADS_LAST_CLICK",
      },
    })
  }

  console.log("\n=== Plan ===")
  if (planned.length === 0) console.log("  (nothing to create)")
  for (const p of planned) console.log(`  CREATE: ${p}`)
  for (const s of skipped) console.log(`  SKIP:   ${s}`)

  if (DRY_RUN || ops.length === 0) {
    console.log(`\n${DRY_RUN ? "DRY RUN" : "Nothing to create"} — exiting.`)
    return
  }

  console.log(`\nCreating ${ops.length} conversion action(s)...`)
  const result = await mutateResourcesRest(CUSTOMER_ID, ops)
  const responses = (result.response as {
    mutateOperationResponses?: Array<{
      conversionActionResult?: { resourceName?: string }
    }>
  })?.mutateOperationResponses ?? []
  console.log(`\n✅ Created ${responses.length} action(s):`)
  for (const r of responses) {
    if (r.conversionActionResult?.resourceName) {
      console.log(`  ${r.conversionActionResult.resourceName}`)
    }
  }

  console.log("\n=== Verifying via GAQL ===")
  const after = (await searchGoogleAdsRest(
    CUSTOMER_ID,
    "SELECT conversion_action.id, conversion_action.name, conversion_action.category, conversion_action.status, conversion_action.primary_for_goal, conversion_action.value_settings.default_value FROM conversion_action WHERE conversion_action.status = 'ENABLED' ORDER BY conversion_action.name",
  )) as Array<{
    conversionAction: {
      id: string
      name: string
      category: string
      primaryForGoal?: boolean
      valueSettings?: { defaultValue?: number }
    }
  }>
  for (const a of after) {
    const v = a.conversionAction.valueSettings?.defaultValue
    console.log(
      `  [${a.conversionAction.category}] ${a.conversionAction.name} (${a.conversionAction.id}) — primary=${a.conversionAction.primaryForGoal} value=$${v ?? 0}`,
    )
  }
}

main().catch((err) => {
  console.error("Create failed:", err)
  process.exit(1)
})
