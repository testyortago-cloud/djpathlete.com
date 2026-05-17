// scripts/apply-rec.ts
// Apply a new_campaign recommendation locally via the same applyRecommendation
// function the UI calls — reads .env.local + production Supabase + the
// connected Google Ads account, so the campaign IS actually created (PAUSED)
// in the live account. Usage:
//   npx tsx scripts/apply-rec.ts          # lists pending new_campaign recs
//   npx tsx scripts/apply-rec.ts <recId>  # applies a specific rec

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

async function main() {
  const recId = process.argv[2]?.trim()

  const { createServiceRoleClient } = await import("@/lib/supabase")
  const supabase = createServiceRoleClient()

  if (!recId) {
    console.log("=== Pending new_campaign recommendations ===")
    const { data } = await supabase
      .from("google_ads_recommendations")
      .select("id, payload, created_at")
      .eq("recommendation_type", "new_campaign")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
    for (const r of (data ?? []) as Array<{
      id: string
      payload: Record<string, unknown>
      created_at: string
    }>) {
      const args = (r.payload?.args ?? r.payload) as Record<string, unknown>
      const ad = args.ad_copy as { final_url?: string } | undefined
      console.log(
        `  ${r.id}  ${(args.campaign_name as string) ?? "?"}  →  ${ad?.final_url ?? "?"}  [${args.conversion_goal}]`,
      )
    }
    console.log("\nRun: npx tsx scripts/apply-rec.ts <recId>")
    return
  }

  console.log(`Applying recommendation ${recId}...`)
  const { applyRecommendation } = await import("@/lib/ads/apply")
  const result = await applyRecommendation(recId, {
    mode: "co_pilot",
    actor: "system",
  })
  console.log("\n=== Result ===")
  console.log(JSON.stringify(result, null, 2))

  console.log("\n=== Last automation_log entry ===")
  const { data: logRow } = await supabase
    .from("google_ads_automation_log")
    .select("result_status, error_message, api_response, created_at")
    .eq("recommendation_id", recId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (logRow) {
    const row = logRow as {
      result_status: string
      error_message: string | null
      api_response: unknown
      created_at: string
    }
    console.log("  status:", row.result_status)
    if (row.error_message) {
      console.log("  error_message:")
      console.log(row.error_message)
    }
    if (row.api_response) {
      console.log("  api_response (truncated):")
      console.log(JSON.stringify(row.api_response, null, 2).slice(0, 1500))
    }
  } else {
    console.log("  (no log row found)")
  }
}

main().catch((err) => {
  console.error("Script failed:", err)
  process.exit(1)
})
