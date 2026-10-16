/**
 * Fill a PAST newsletter's results (newsletter_deliveries, migration 00292)
 * from Resend's own log, for sends made before the blast recorded who it
 * reached.
 *
 *   npx tsx scripts/backfill-newsletter-results.ts --newsletter <id>                 # dev clone, dry run
 *   npx tsx scripts/backfill-newsletter-results.ts --newsletter <id> --prod          # production, dry run
 *   npx tsx scripts/backfill-newsletter-results.ts --newsletter <id> --prod --apply  # production, writes rows
 *
 * DRY RUN BY DEFAULT. It never sends anything.
 *
 * For each of the newsletter's emails in Resend's log (from the send until
 * now, so the retry's later sends are included):
 *   - a row already holding that Resend id (a retry send) gets the stamps its
 *     last event implies, where the row has none yet;
 *   - an address with no row yet (the blast) gets an origin='send' row with
 *     those stamps.
 * The stamps' times are the email's send time: approximate, and the results
 * only count whether a stamp is there (see stampsFromLastEvent).
 *
 * It refuses, whatever the flags, when the log holds fewer addresses than the
 * newsletter recorded as sent: then the log cannot see some who got it (the
 * 2026-09-25 issue went out on another Resend account), and the results would
 * be quietly wrong. Resend's log reaches back about 30 days.
 *
 * Wrapped in main(), not top-level await: `next build` type-checks scripts/.
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { fetchNewsletterEmails, resendTime } from "../lib/newsletter/resend-log"
import { stampsFromLastEvent, type ResultStamps } from "../lib/newsletter/retry-backfill"
import { platformBusinessId } from "../lib/tenancy/platform"

const STAMPS = ["delivered_at", "opened_at", "clicked_at", "bounced_at", "complained_at"] as const

type Row = { id: string; email: string; provider_message_id: string | null } & Record<
  (typeof STAMPS)[number],
  string | null
>

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

async function main() {
  const useProd = process.argv.includes("--prod")
  const apply = process.argv.includes("--apply")
  const newsletterId = arg("--newsletter")
  if (!newsletterId) throw new Error("--newsletter <id> is required")

  const env: Record<string, string> = {}
  for (const line of readFileSync(useProd ? ".env.prod" : ".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  console.log(`\n${apply ? "APPLY" : "Dry run"} against ${useProd ? "PRODUCTION" : "the dev clone"}.\n`)

  const { data: nl, error: nlErr } = await supabase
    .from("newsletters")
    .select("id, subject, status, sent_at, sent_count")
    .eq("id", newsletterId)
    .single()
  if (nlErr) throw new Error(`newsletter ${newsletterId}: ${nlErr.message}`)
  if (nl.status !== "sent" || !nl.sent_at) throw new Error(`"${nl.subject}" has not been sent`)
  const sentAt = new Date(nl.sent_at)

  const emails = await fetchNewsletterEmails(env.RESEND_API_KEY, nl.subject, sentAt, { until: new Date() })
  const addresses = new Set(emails.flatMap((e) => e.to.map((a) => a.trim().toLowerCase())))
  console.log(`"${nl.subject}", sent ${sentAt.toISOString()}; recorded as sent: ${nl.sent_count}`)
  console.log(`In Resend's log since then: ${emails.length} emails to ${addresses.size} addresses`)
  if (addresses.size < (nl.sent_count ?? 0)) {
    throw new Error(
      `Resend's log has ${addresses.size} addresses but the newsletter recorded ${nl.sent_count} sent; ` +
        "this key cannot see all of it, so its results would be wrong",
    )
  }

  // Every row this newsletter has, past PostgREST's 1,000-row cap.
  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("newsletter_deliveries")
      .select("id, email, provider_message_id, delivered_at, opened_at, clicked_at, bounced_at, complained_at")
      .eq("newsletter_id", nl.id)
      .order("id", { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(`newsletter_deliveries: ${error.message}`)
    rows.push(...((data ?? []) as Row[]))
    if ((data ?? []).length < 1000) break
  }
  const byProviderId = new Map(rows.filter((r) => r.provider_message_id).map((r) => [r.provider_message_id!, r]))
  const byEmail = new Map(rows.map((r) => [r.email.trim().toLowerCase(), r]))

  const updates: { id: string; stamps: ResultStamps }[] = []
  const inserts: Record<string, string | null>[] = []
  let conflicts = 0
  for (const e of emails) {
    const stamps = stampsFromLastEvent(e.last_event, e.created_at)
    const known = byProviderId.get(e.id)
    if (known) {
      const missing: ResultStamps = {}
      for (const k of STAMPS) if (stamps[k] && !known[k]) missing[k] = stamps[k]
      if (Object.keys(missing).length > 0) updates.push({ id: known.id, stamps: missing })
      continue
    }
    const email = e.to[0]
    if (!email) continue
    // Someone with a row but not this email's id: a queued person, or a
    // second email to them. Never overwrite a row this script did not make.
    if (byEmail.has(email.trim().toLowerCase())) {
      conflicts++
      continue
    }
    byEmail.set(email.trim().toLowerCase(), { id: "", email, provider_message_id: e.id } as Row)
    // Every row carries every key: a bulk insert sends NULL, not the column
    // default, for a key only some rows have.
    inserts.push({
      business_id: platformBusinessId(),
      newsletter_id: nl.id,
      email,
      origin: "send",
      status: "sent",
      provider_message_id: e.id,
      sent_at: resendTime(e.created_at).toISOString(),
      ...Object.fromEntries(STAMPS.map((k) => [k, stamps[k] ?? null])),
    })
  }

  const count = (k: (typeof STAMPS)[number]) =>
    inserts.filter((r) => r[k]).length + updates.filter((u) => u.stamps[k]).length
  console.log(`Rows to add (the blast):          ${inserts.length}`)
  console.log(`Existing rows to fill in:         ${updates.length}`)
  console.log(`Skipped (address already has a different row): ${conflicts}`)
  console.log(
    `Stamps this adds: delivered ${count("delivered_at")}, opened ${count("opened_at")}, clicked ${count("clicked_at")}, ` +
      `bounced ${count("bounced_at")}, spam ${count("complained_at")}`,
  )
  if (!apply) {
    console.log("\nDry run: nothing written. Add --apply to write these.")
    return
  }

  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await supabase
      .from("newsletter_deliveries")
      .upsert(inserts.slice(i, i + 500), { onConflict: "newsletter_id,email", ignoreDuplicates: true })
    if (error) throw new Error(`insert: ${error.message} (${i} rows written before this)`)
  }
  for (const u of updates) {
    const { error } = await supabase.from("newsletter_deliveries").update(u.stamps).eq("id", u.id)
    if (error) throw new Error(`update ${u.id}: ${error.message}`)
  }
  console.log(`\nWrote ${inserts.length} new row(s) and filled ${updates.length}. See /admin/newsletter.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
