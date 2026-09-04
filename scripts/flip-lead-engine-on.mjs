/**
 * Turns the Lead Engine on, in three idempotent writes:
 *
 *   1. Fills business_settings' identity fields — the sender preflight
 *      (assertSendable) refuses to send while sender_email / display_name /
 *      postal_address are empty. Values come from what the app already
 *      publishes: lib/business-info.ts (brand + postal address, on the public
 *      site footer and JSON-LD) and the prod Resend sender / ADMIN_CC in
 *      lib/email.ts. Only fills fields that are currently empty — a value a
 *      human set later is never overwritten.
 *   2. Activates the ONE sequence with a live trigger today, new_lead_nurture
 *      (funnel_form). The other three stay draft on purpose: two wait on
 *      Stage 4 wiring, one is manual-only (see 00218's header comment).
 *   3. Upserts system_settings.cron_sequence_tick_enabled = true, the flag the
 *      tick route gates on (defaultEnabled: false).
 *
 *   node scripts/flip-lead-engine-on.mjs .env.prod
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

const IDENTITY = {
  display_name: "DJP Athlete",
  sender_name: "Darren J. Paul",
  sender_email: "noreply@send.darrenjpaul.com",
  reply_to: "darren@darrenjpaul.com",
  postal_address: "6585 Simons Rd, Zephyrhills, FL 33541, USA",
}

// 1. business_settings — fill only what is empty.
const current = await sb
  .from("business_settings")
  .select("display_name, sender_name, sender_email, reply_to, postal_address")
  .eq("business_id", BIZ)
  .single()
if (current.error) {
  console.error("read business_settings:", current.error.message)
  process.exit(1)
}
const patch = {}
for (const [field, value] of Object.entries(IDENTITY)) {
  if (!current.data[field]?.trim()) patch[field] = value
  else console.log(`keeping existing ${field}: ${JSON.stringify(current.data[field])}`)
}
if (Object.keys(patch).length > 0) {
  const upd = await sb.from("business_settings").update(patch).eq("business_id", BIZ)
  if (upd.error) {
    console.error("update business_settings:", upd.error.message)
    process.exit(1)
  }
  console.log("business_settings filled:", JSON.stringify(patch, null, 2))
} else {
  console.log("business_settings already fully configured; nothing written")
}

// 2. new_lead_nurture -> active.
const seq = await sb
  .from("sequences")
  .update({ status: "active" })
  .eq("business_id", BIZ)
  .eq("key", "new_lead_nurture")
  .select("key, status")
if (seq.error) {
  console.error("activate new_lead_nurture:", seq.error.message)
  process.exit(1)
}
console.log("sequence:", JSON.stringify(seq.data))

// 3. cron_sequence_tick_enabled = true.
const flag = await sb
  .from("system_settings")
  .upsert({ key: "cron_sequence_tick_enabled", value: true }, { onConflict: "key" })
  .select("key, value")
if (flag.error) {
  console.error("set cron flag:", flag.error.message)
  process.exit(1)
}
console.log("system_settings:", JSON.stringify(flag.data))
console.log("\nDone. Next sequenceTickCron tick (every 5 min) should log a cron_runs row.")
