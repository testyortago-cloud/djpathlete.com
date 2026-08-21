/**
 * The go-live step for SMS: the day Twilio (A2P 10DLC registration) clears,
 * this script writes the ONE business_settings field that the argument's
 * shape indicates — sms_messaging_service_sid (a Messaging Service SID,
 * `MG...`) or sms_sender_phone (an E.164 number) — so assertSmsSendable
 * (lib/lead-engine/sms.ts) stops throwing SmsNotConfiguredError and the
 * sequence-tick runner starts sending texts.
 *
 * Only fills the targeted field, and only if it is currently blank — a
 * value a human already set is never overwritten. Mirrors
 * flip-lead-engine-on.mjs's only-fill-empty rule and "keeping existing"
 * logging exactly.
 *
 * A neighboring field in the same row, business_settings.display_name,
 * gates the SMS consent checkbox on the inquiry forms (Stage 4) — unlike
 * this script's own writes (read server-side on every request), a
 * display_name change reaches the five statically-rendered marketing pages
 * that mount those forms within an hour (revalidate = 3600), not instantly.
 *

 * Run this at the SAME TIME as the new_lead_nurture SMS step insertion:
 * migration 00222 (supabase/migrations/00222_lead_engine_seed_sms_steps.sql)
 * ends with a comment block, "RUN-SAFE INSERTION RUNBOOK", holding the
 * pause/verify/shift+insert/reactivate steps for that sequence's sms step.
 * That runbook is not executed by this script — run it separately, by hand.
 *
 * Never run by a session against prod. A human runs this after Twilio
 * clears, pointed at .env.prod.
 *
 *   node scripts/configure-lead-engine-sms.mjs .env.prod MG0123456789abcdef0123456789abcdef
 *   node scripts/configure-lead-engine-sms.mjs .env.prod +15551234567
 *   node scripts/configure-lead-engine-sms.mjs .env.prod +15551234567 --dry-run
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const MESSAGING_SERVICE_SID_RE = /^MG[0-9a-f]{32}$/i
const E164_PHONE_RE = /^\+[1-9][0-9]{6,14}$/

function usageError() {
  console.error("usage: node scripts/configure-lead-engine-sms.mjs <env-file> <MG...sid | +E164phone> [--dry-run]")
  console.error("argument must match one of:")
  console.error("  messaging service sid: /^MG[0-9a-f]{32}$/i   e.g. MG0123456789abcdef0123456789abcdef")
  console.error("  E.164 phone number:    /^\\+[1-9][0-9]{6,14}$/   e.g. +15551234567")
  process.exit(1)
}

async function main() {
  const rawArgs = process.argv.slice(2)

  // Strict flag check FIRST, before any positional parsing or file read: an
  // unrecognized flag (a typo like "--dryrun") must never be silently
  // absorbed as a discarded positional, which would leave dryRun false and
  // let a real write proceed on exactly the go-live typo a human is most
  // likely to make.
  for (const arg of rawArgs) {
    if (arg.startsWith("-") && arg !== "--dry-run") {
      usageError()
      return
    }
  }

  const dryRun = rawArgs.includes("--dry-run")
  const positional = rawArgs.filter((a) => a !== "--dry-run")

  if (positional.length !== 2) {
    usageError()
    return
  }
  const [envPath, value] = positional

  let field
  if (MESSAGING_SERVICE_SID_RE.test(value)) {
    field = "sms_messaging_service_sid"
  } else if (E164_PHONE_RE.test(value)) {
    field = "sms_sender_phone"
  } else {
    usageError()
    return
  }

  const env = {}
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  console.log("project host:", new URL(env.NEXT_PUBLIC_SUPABASE_URL).host)
  console.log(`argument ${JSON.stringify(value)} -> business_settings.${field}`)

  const BIZ = "00000000-0000-0000-0000-000000000001"

  const current = await sb.from("business_settings").select(field).eq("business_id", BIZ).single()
  if (current.error) {
    console.error("read business_settings:", current.error.message)
    process.exit(1)
  }

  if (current.data[field]?.trim()) {
    console.log(`keeping existing ${field}: ${JSON.stringify(current.data[field])}`)
    console.log("nothing written")
    return
  }

  if (dryRun) {
    console.log(`[dry-run] would set business_settings.${field} = ${JSON.stringify(value)}`)
    console.log("[dry-run] no write performed")
    return
  }

  const upd = await sb
    .from("business_settings")
    .update({ [field]: value })
    .eq("business_id", BIZ)
    .select(field)
  if (upd.error) {
    console.error(`update business_settings.${field}:`, upd.error.message)
    process.exit(1)
  }
  console.log(`business_settings.${field} set:`, JSON.stringify(upd.data))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
