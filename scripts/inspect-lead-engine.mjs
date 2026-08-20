/**
 * Read-only look at the Lead Engine's switches before flipping it on:
 * business_settings identity fields, sequence statuses, the cron flag,
 * and recent sequenceTickCron runs.
 *
 *   node scripts/inspect-lead-engine.mjs .env.prod
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const [envPath] = process.argv.slice(2)
const env = {}
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
console.log("project host:", new URL(env.NEXT_PUBLIC_SUPABASE_URL).host)

const BIZ = "00000000-0000-0000-0000-000000000001"

const bs = await sb
  .from("business_settings")
  .select("business_id, display_name, sender_name, sender_email, reply_to, postal_address, logo_url")
  .eq("business_id", BIZ)
  .maybeSingle()
console.log("business_settings:", JSON.stringify(bs.data ?? bs.error, null, 2))

const seqs = await sb
  .from("sequences")
  .select("key, status, trigger_source")
  .eq("business_id", BIZ)
  .order("key")
console.log("sequences:", JSON.stringify(seqs.data ?? seqs.error, null, 2))

const settings = await sb
  .from("system_settings")
  .select("key, value")
  .in("key", ["cron_sequence_tick_enabled", "automation_paused"])
console.log("system_settings:", JSON.stringify(settings.data ?? settings.error, null, 2))

const runs = await sb
  .from("cron_runs")
  .select("cron_name, status, started_at")
  .eq("cron_name", "sequenceTickCron")
  .order("started_at", { ascending: false })
  .limit(3)
console.log("recent sequenceTickCron runs:", JSON.stringify(runs.data ?? runs.error, null, 2))
