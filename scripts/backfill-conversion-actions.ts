// scripts/backfill-conversion-actions.ts
// DIAGNOSTIC ONLY (no mutations).
//
// Originally tried to set campaign.selective_optimization.conversion_actions
// on already-created Search campaigns — but selective_optimization is only
// valid for App campaigns. Search campaigns inherit account-level conversion
// goals from Tools → Conversions → Settings in Google Ads UI.
//
// Per-campaign overrides on Search use the CampaignConversionGoal resource
// (separate mutation graph). Not implemented yet — see TODO at bottom.
//
// This script now just reports: which conversion actions exist + which goal
// each applied campaign was created with + what the recommended action is.
//
// Usage: npx tsx scripts/backfill-conversion-actions.ts

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

interface ConversionAction {
  id: string
  resourceName: string
  name: string
  status: string
  category: string
  type: string
}

interface CampaignWithGoal {
  campaignId: string
  campaignName: string
  conversionGoal: string | null
}

const CUSTOMER_ID = "4974459872"

async function main() {
  const { searchGoogleAdsRest } = await import("@/lib/ads/google-ads-rest")
  const { createServiceRoleClient } = await import("@/lib/supabase")
  const supabase = createServiceRoleClient()

  // ── 1. Pull all enabled conversion actions ────────────────────────
  const rawActions = (await searchGoogleAdsRest(
    CUSTOMER_ID,
    "SELECT conversion_action.id, conversion_action.resource_name, conversion_action.name, conversion_action.status, conversion_action.category, conversion_action.type FROM conversion_action WHERE conversion_action.status = 'ENABLED'",
  )) as Array<{ conversionAction: ConversionAction }>
  const actions = rawActions.map((r) => r.conversionAction)
  console.log("=== Enabled conversion actions ===")
  for (const a of actions) console.log(`  [${a.category}] ${a.name} (${a.id})`)

  // Build a category → resource_name map. Multiple actions per category
  // means we link the first one (admin can refine later).
  const byCategory = new Map<string, string>()
  for (const a of actions) {
    if (!byCategory.has(a.category)) byCategory.set(a.category, a.resourceName)
  }
  const callsFromAds = actions.find((a) => a.category === "PHONE_CALL_LEAD")
  console.log(
    `\nMappings: purchase=${byCategory.get("PURCHASE") ?? "(none)"}, lead=${byCategory.get("SUBMIT_LEAD_FORM") ?? callsFromAds?.resourceName ?? "(none)"}, booking=${byCategory.get("BOOKING") ?? "(none)"}`,
  )

  // ── 2. Pull every campaign we've applied via the agent + its goal ─
  const { data: applied } = await supabase
    .from("google_ads_recommendations")
    .select("payload, customer_id")
    .eq("recommendation_type", "new_campaign")
    .in("status", ["applied", "auto_applied"])
  const targets: CampaignWithGoal[] = []
  for (const row of (applied ?? []) as Array<{
    payload: Record<string, unknown>
    customer_id: string
  }>) {
    const args = (row.payload?.args ?? row.payload) as Record<string, unknown>
    const goal = (args.conversion_goal as string | undefined) ?? null
    const campaignName = (args.campaign_name as string | undefined) ?? "?"
    // We need the actual created campaign_id — pull from automation_log.
    const { data: log } = await supabase
      .from("google_ads_automation_log")
      .select("api_response")
      .eq("customer_id", row.customer_id)
      .eq("result_status", "success")
      .order("created_at", { ascending: false })
    // Find the success row whose response includes this campaign by name.
    // (Joining by recommendation_id would be cleaner — leaving as TODO.)
    for (const l of (log ?? []) as Array<{ api_response: unknown }>) {
      const responses = (l.api_response as {
        mutateOperationResponses?: Array<{
          campaignResult?: { resourceName?: string }
        }>
      })?.mutateOperationResponses
      const cr = responses?.find((r) => r.campaignResult)?.campaignResult
      if (!cr?.resourceName) continue
      const campaignId = cr.resourceName.split("/").pop()!
      if (targets.some((t) => t.campaignId === campaignId)) continue
      // Verify name matches (avoid double-counting from a separate apply).
      const camp = await searchGoogleAdsRest(
        row.customer_id,
        `SELECT campaign.id, campaign.name FROM campaign WHERE campaign.id = ${campaignId}`,
      ).catch(() => [])
      const liveName = (camp[0] as { campaign?: { name?: string } } | undefined)?.campaign?.name
      if (liveName === campaignName) {
        targets.push({ campaignId, campaignName, conversionGoal: goal })
        break
      }
    }
  }

  console.log("\n=== Campaigns to backfill ===")
  for (const t of targets) {
    console.log(`  ${t.campaignId} ${t.campaignName} [goal=${t.conversionGoal}]`)
  }

  // ── 3. Report what each campaign needs ────────────────────────────
  console.log("\n=== Recommendations ===")
  for (const t of targets) {
    let needed: string
    if (t.conversionGoal === "purchase") {
      needed = byCategory.has("PURCHASE")
        ? `OK — account inherits PURCHASE action ${byCategory.get("PURCHASE")}`
        : "MISSING: create a PURCHASE conversion action (Tools → Conversions → New → Website → Purchase) for $79 / $249 product sales"
    } else if (t.conversionGoal === "form_submission_lead") {
      const lead = byCategory.get("SUBMIT_LEAD_FORM") ?? callsFromAds?.resourceName
      needed = lead
        ? `OK — account inherits ${lead}`
        : "MISSING: create a SUBMIT_LEAD_FORM conversion action OR a website event for /assessment form submits"
    } else if (t.conversionGoal === "booking") {
      const booking = byCategory.get("BOOKING") ?? callsFromAds?.resourceName
      needed = booking ? `OK — inherits ${booking}` : "MISSING: create a BOOKING action"
    } else {
      needed = `unknown goal: ${t.conversionGoal}`
    }
    console.log(`  ${t.campaignId} (${t.conversionGoal}) — ${needed}`)
  }

  console.log(
    "\nNOTE: All campaigns currently inherit Calls from ads as their only conversion action.",
  )
  console.log(
    "      To track website Purchases / Form submissions: create those actions in Google Ads UI;",
  )
  console.log("      no campaign-level mutation needed once they exist.")
}

main().catch((err) => {
  console.error("Backfill failed:", err)
  process.exit(1)
})
