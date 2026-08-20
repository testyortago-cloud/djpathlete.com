/**
 * Renders the New Lead Nurture emails exactly as a lead receives them:
 * the LIVE sequence_steps rows and the LIVE business_settings row from the
 * database given by argv, passed through the real `renderSequenceEmail` —
 * the same function the tick runner sends with. Read-only against the DB;
 * nothing is sent (renderSequenceEmail is pure).
 *
 * Writes the exact html/text parts per email step into
 * screenshots/lead-engine-emails/, plus meta.json for the capture step.
 *
 *   npx esbuild scripts/render-lead-engine-emails.ts --bundle --platform=node \
 *     --format=esm --packages=external --alias:@=. --outfile=<tmp>/render.mjs
 *   node <tmp>/render.mjs .env.prod
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { renderSequenceEmail } from "@/lib/lead-engine/email"
import type { BusinessSettings } from "@/lib/db/businesses"

async function main() {
  const [envPath] = process.argv.slice(2)
  const env: Record<string, string> = {}
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
  console.log("project host:", new URL(env.NEXT_PUBLIC_SUPABASE_URL!).host)

  const BIZ = "00000000-0000-0000-0000-000000000001"
  const OUT = "screenshots/lead-engine-emails"

  const settingsRow = await sb.from("business_settings").select("*").eq("business_id", BIZ).single()
  if (settingsRow.error) throw new Error(settingsRow.error.message)
  const settings = settingsRow.data as BusinessSettings

  const seq = await sb
    .from("sequences")
    .select("id, key, status")
    .eq("business_id", BIZ)
    .eq("key", "new_lead_nurture")
    .single()
  if (seq.error) throw new Error(seq.error.message)

  const steps = await sb
    .from("sequence_steps")
    .select("position, kind, wait_minutes, subject, body")
    .eq("sequence_id", seq.data.id)
    .order("position")
  if (steps.error) throw new Error(steps.error.message)

  // The preview lead. The token in a real send is signed per contact; this one
  // is visibly a placeholder so the preview link cannot unsubscribe anybody.
  const CONTACT_NAME = "Alex"
  const UNSUB_URL = "https://www.darrenjpaul.com/unsubscribe/PREVIEW-TOKEN"

  mkdirSync(OUT, { recursive: true })
  const meta: object[] = []
  let waitBefore = 0
  for (const step of steps.data) {
    if (step.kind === "wait") {
      waitBefore += step.wait_minutes ?? 0
      continue
    }
    if (step.kind !== "email") continue
    const rendered = renderSequenceEmail({
      settings,
      subject: step.subject!,
      body: step.body!,
      unsubscribeUrl: UNSUB_URL,
      contactName: CONTACT_NAME,
    })
    const base = `step-${step.position}`
    writeFileSync(`${OUT}/${base}.html`, rendered.html)
    writeFileSync(`${OUT}/${base}.txt`, rendered.text)
    meta.push({
      file: base,
      position: step.position,
      daysAfterEnrolment: waitBefore / 1440,
      subject: rendered.subject,
      from: `${settings.sender_name} <${settings.sender_email}>`,
      replyTo: settings.reply_to,
    })
    console.log(`rendered ${base}: day ${waitBefore / 1440} — "${rendered.subject}"`)
  }
  writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 2))
  console.log(`wrote ${meta.length} emails to ${OUT}/`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
