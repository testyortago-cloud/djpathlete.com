// scripts/run-strategist.ts
// Run the ads strategist memo from the CLI, against production data.
//
// The dashboard's "Generate now" button needs an admin browser session, and the
// internal cron route (/api/admin/internal/ads/agent-strategist) EMAILS the memo
// to COACH_EMAIL. This script is the third door: it calls buildStrategistMemo
// directly — same function the admin button uses — which persists the memo to
// google_ads_agent_memos and sends NO email.
//
// Usage:
//   npx tsx scripts/run-strategist.ts --check
//       Preflight verdict only. Free — no model call, nothing written.
//       Answers "will Wednesday's scheduled memo pass?" against live data.
//
//   npx tsx scripts/run-strategist.ts
//       Generate + persist a memo. Refuses if preflight fails (same gate the
//       cron applies), so what you see locally matches what the cron will do.
//
//   npx tsx scripts/run-strategist.ts --bypass-preflight
//       Generate even if preflight fails. This is what the admin "Generate now"
//       button does — useful to see a full reasoning pass on a cold account.
//
// Costs real Anthropic tokens on every run except --check.

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

const HOURS = 3_600_000

function hoursAgo(d: Date | null): string {
  if (!d) return "never"
  return `${((Date.now() - d.getTime()) / HOURS).toFixed(1)}h ago`
}

async function main() {
  const args = new Set(process.argv.slice(2).map((a) => a.trim()))
  const checkOnly = args.has("--check")
  const bypassPreflight = args.has("--bypass-preflight")

  const { fetchPreflightInput } = await import("@/lib/ads/agent")
  const { runPreflight } = await import("@/lib/ads/agent/signals")
  const T = await import("@/lib/ads/agent/thresholds")

  console.log("=== Preflight (live data) ===")
  const input = await fetchPreflightInput()
  const preflight = await runPreflight(input)

  // Print the inputs, not just the verdict. A bare "0 clicks" is what hid a
  // two-month sync outage — seeing the numbers behind each gate is the point.
  const conversionAge = input.mostRecentConversionAt
    ? (Date.now() - input.mostRecentConversionAt.getTime()) / HOURS
    : null
  console.log(
    `  clicks (7d)        ${input.activeCampaignClicks7d} / ${T.MIN_RECENT_CLICKS} needed` +
      `   [${input.activeCampaignCount ?? "?"} ENABLED campaigns, ${input.metricRows7d ?? "?"} metric rows]`,
  )
  console.log(
    `  last conversion    ${hoursAgo(input.mostRecentConversionAt)}` +
      `   / < ${T.CONVERSION_FRESHNESS_HOURS}h needed` +
      (conversionAge !== null && conversionAge > T.CONVERSION_FRESHNESS_HOURS ? "   STALE" : ""),
  )
  console.log(`  GA4 synced         ${hoursAgo(input.ga4SyncedAt)}`)
  console.log(
    `  GSC synced         ${hoursAgo(input.gscSyncedAt)}   / < ${T.SYNC_FRESHNESS_HOURS}h needed`,
  )
  console.log(
    `  tokens             ads=${input.tokensValid.googleAds} ga4=${input.tokensValid.ga4} gsc=${input.tokensValid.gsc}`,
  )

  console.log(`\n  verdict: ${preflight.ok ? "PASS" : "FAIL"}`)
  for (const reason of preflight.reasons) console.log(`    - ${reason}`)

  if (checkOnly) {
    console.log("\n(--check: nothing generated, no tokens spent)")
    return
  }

  if (!preflight.ok && !bypassPreflight) {
    console.log(
      "\nRefusing to generate: preflight failed and the scheduled cron would" +
        " skip too.\nRe-run with --bypass-preflight to force a reasoning pass anyway.",
    )
    process.exitCode = 1
    return
  }

  console.log(
    `\n=== Generating memo${bypassPreflight ? " (preflight bypassed)" : ""} — this spends tokens ===`,
  )
  const { buildStrategistMemo } = await import("@/lib/ads/agent")
  const memo = await buildStrategistMemo({
    source: "manual",
    triggered_by: null,
    bypassPreflight,
  })

  console.log("\n=== Memo ===")
  console.log(`  id         ${memo.id}`)
  console.log(`  week_of    ${memo.week_of}`)
  console.log(`  subject    ${memo.subject}`)
  console.log(`  confidence ${memo.agent_confidence ?? "—"}`)
  console.log(`  actions    ${memo.actions?.length ?? 0}`)
  console.log(`  rejections ${memo.guardrail_rejections?.length ?? 0}`)
  console.log("\nNo email sent. View at /admin/ads/agent")
}

main().catch((err) => {
  console.error("Script failed:", err)
  process.exit(1)
})
