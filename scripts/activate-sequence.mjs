/**
 * Transitions a sequence's status: draft → active by default, or active → paused with --pause.
 *
 * After this branch, two sequences have their trigger sources wired for auto-enrolment:
 * - newsletter_welcome (trigger_source='newsletter', emitted by app/api/newsletter/route.ts)
 * - lead_magnet_delivery (trigger_source='lead_magnet', emitted by app/api/shop/leads/route.ts)
 *
 * Enrolment starts at the NEXT matching event, not retroactively: a contact who subscribed
 * to the newsletter before this script runs will not be retroactively enrolled.
 *
 * Sequences without a trigger_source (cold_lead_re_engagement) have manual enrolment only
 * and will not auto-enrol regardless of status. Activating them does nothing, but the
 * transition is still allowed for consistency.
 *
 * sms_repermission (coming in Task 9) is manual-enrolment only and has no trigger_source.
 * Activating it alone sends nothing — no contact will be enrolled.
 *
 *   node scripts/activate-sequence.mjs .env newsletter_welcome
 *   node scripts/activate-sequence.mjs .env lead_magnet_delivery
 *   node scripts/activate-sequence.mjs .env newsletter_welcome --pause
 *   node scripts/activate-sequence.mjs .env newsletter_welcome --dry-run
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const SINGLETON_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"

function usageError() {
  console.error("usage: node scripts/activate-sequence.mjs <env-file> <sequence-key> [--pause] [--dry-run]")
  console.error("transitions sequence status: draft → active (default) or active → paused (--pause)")
  process.exit(1)
}

async function main() {
  const rawArgs = process.argv.slice(2)

  // Strict flag check FIRST, before any positional parsing or file read.
  for (const arg of rawArgs) {
    if (arg.startsWith("-") && arg !== "--pause" && arg !== "--dry-run") {
      usageError()
      return
    }
  }

  const dryRun = rawArgs.includes("--dry-run")
  const pause = rawArgs.includes("--pause")
  const positional = rawArgs.filter((a) => a !== "--dry-run" && a !== "--pause")

  if (positional.length !== 2) {
    usageError()
    return
  }

  const [envPath, sequenceKey] = positional

  const env = {}
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }

  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  console.log("project host:", new URL(env.NEXT_PUBLIC_SUPABASE_URL).host)

  // Read all sequences to find the one with the given key
  const { data: sequences, error: sequencesErr } = await sb
    .from("sequences")
    .select("id, key, status")
    .eq("business_id", SINGLETON_BUSINESS_ID)
  if (sequencesErr) {
    console.error("read sequences:", sequencesErr.message)
    process.exit(1)
  }

  const sequence = (sequences ?? []).find((s) => s.key === sequenceKey)
  if (!sequence) {
    console.error(`unknown sequence key: ${JSON.stringify(sequenceKey)}`)
    console.error("available sequences:")
    for (const s of sequences ?? []) {
      console.error(`  ${s.key}`)
    }
    process.exit(1)
  }

  const currentStatus = sequence.status
  const targetStatus = pause ? "paused" : "active"

  console.log(`sequence ${JSON.stringify(sequenceKey)}: current status = ${JSON.stringify(currentStatus)}`)

  // Validate transition
  let allowed = false
  if (!pause && currentStatus === "draft") {
    allowed = true
  } else if (pause && currentStatus === "active") {
    allowed = true
  }

  if (!allowed) {
    console.error(`cannot transition from ${JSON.stringify(currentStatus)} to ${JSON.stringify(targetStatus)}`)
    process.exit(1)
  }

  if (dryRun) {
    console.log(
      `[dry-run] would set sequences.status = ${JSON.stringify(targetStatus)} where id = ${JSON.stringify(sequence.id)}`,
    )
    console.log("[dry-run] no write performed")
    return
  }

  const { error: updateErr } = await sb.from("sequences").update({ status: targetStatus }).eq("id", sequence.id)
  if (updateErr) {
    console.error("update sequences.status:", updateErr.message)
    process.exit(1)
  }

  console.log(`sequences.status set: ${JSON.stringify(targetStatus)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
