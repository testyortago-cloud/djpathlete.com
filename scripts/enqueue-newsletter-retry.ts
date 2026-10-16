/**
 * Queue a PAST newsletter's missed recipients for the working-hours retry
 * (newsletter_deliveries, migration 00291; drained by
 * lib/automation/newsletter-retry.ts).
 *
 *   npx tsx scripts/enqueue-newsletter-retry.ts --newsletter <id>                 # dev clone, dry run
 *   npx tsx scripts/enqueue-newsletter-retry.ts --newsletter <id> --prod          # production, dry run
 *   npx tsx scripts/enqueue-newsletter-retry.ts --newsletter <id> --prod --apply  # production, writes rows
 *
 * DRY RUN BY DEFAULT. Nothing is written without --apply, and nothing is ever
 * SENT by this script: the hourly retry sends, in working hours, 100 at a time.
 *
 * How it knows who was missed: the send keeps no per-recipient record, so this
 * rebuilds the list as it stood at the newsletter's sent_at and subtracts every
 * address Resend's own log (GET /emails, same key) shows an email to under the
 * same subject that day. Resend's log reaches back about 30 days; an older
 * send cannot be rebuilt this way, and the script says so instead of guessing.
 *
 * It refuses outright, whatever the flags, when Resend's log shows fewer sends
 * than the newsletter recorded: the log cannot see some who got it.
 *
 * --apply refuses unless the rebuilt "missed" count equals the newsletter's own
 * failed_count, which the send function wrote at the time. A mismatch means
 * the rebuild is wrong somewhere, and a wrong rebuild sends someone a
 * newsletter twice. --accept-mismatch overrides it after a human has looked.
 *
 * Refuses the 2026-09-11 launch newsletter outright: the owner ruled on
 * 2026-09-27 that it is not retried.
 *
 * Wrapped in main(), not top-level await: `next build` type-checks scripts/
 * under a module setting that forbids it (see dry-run-pack-link-resend.ts).
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { missedRecipients, unsafeToQueue, type SubscriberAtSend } from "../lib/newsletter/retry-backfill"
import { isUndeliverableAddress } from "../functions/src/lib/newsletter-recipients"
import { platformBusinessId } from "../lib/tenancy/platform"

const NOT_RETRIED_SEND_DAY = "2026-09-11"

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

function mask(email: string): string {
  const [user, domain] = email.split("@")
  return `${user.slice(0, 2)}***@${domain}`
}

async function main() {
  const useProd = process.argv.includes("--prod")
  const apply = process.argv.includes("--apply")
  const acceptMismatch = process.argv.includes("--accept-mismatch")
  const newsletterId = arg("--newsletter")
  if (!newsletterId) throw new Error("--newsletter <id> is required")

  const envFile = useProd ? ".env.prod" : ".env.local"
  const env: Record<string, string> = {}
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  console.log(`\n${apply ? "APPLY" : "Dry run"} against ${useProd ? "PRODUCTION" : "the dev clone"}.\n`)

  const { data: nl, error: nlErr } = await supabase
    .from("newsletters")
    .select("id, subject, status, sent_at, sent_count, failed_count")
    .eq("id", newsletterId)
    .single()
  if (nlErr) throw new Error(`newsletter ${newsletterId}: ${nlErr.message}`)
  if (nl.status !== "sent" || !nl.sent_at) throw new Error(`"${nl.subject}" has not been sent`)
  if (String(nl.sent_at).startsWith(NOT_RETRIED_SEND_DAY)) {
    throw new Error(
      `"${nl.subject}" is the ${NOT_RETRIED_SEND_DAY} launch newsletter; the owner ruled it is not retried`,
    )
  }
  const sentAt = new Date(nl.sent_at)
  console.log(
    `"${nl.subject}", sent ${sentAt.toISOString()}: ${nl.sent_count} delivered, ${nl.failed_count} failed (as recorded)`,
  )

  // The list, every row that existed then (unsubscribed or not), in the send's order.
  const subscribers: SubscriberAtSend[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("newsletter_subscribers")
      .select("email, subscribed_at, unsubscribed_at")
      .lte("subscribed_at", sentAt.toISOString())
      .order("subscribed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(`newsletter_subscribers: ${error.message}`)
    subscribers.push(...((data ?? []) as SubscriberAtSend[]))
    if ((data ?? []).length < 1000) break
  }

  // Resend's log: every email to this subject within a day of the send.
  const windowStart = sentAt.getTime() - 10 * 60 * 1000
  const windowEnd = sentAt.getTime() + 24 * 60 * 60 * 1000
  const reached: string[] = []
  let oldest = Infinity
  let after: string | null = null
  for (let page = 0; page < 200; page++) {
    const res = await fetch(`https://api.resend.com/emails?limit=100${after ? `&after=${after}` : ""}`, {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    })
    if (!res.ok) throw new Error(`Resend GET /emails ${res.status}: ${await res.text()}`)
    const body = (await res.json()) as {
      data: { id: string; to: string[]; subject: string; created_at: string }[]
      has_more?: boolean
    }
    for (const e of body.data) {
      const at = new Date(e.created_at.replace(" ", "T").replace(/\+00$/, "Z")).getTime()
      oldest = Math.min(oldest, at)
      if (e.subject === nl.subject && at >= windowStart && at <= windowEnd) reached.push(...e.to)
    }
    if (!body.has_more || body.data.length === 0 || oldest < windowStart) break
    after = body.data[body.data.length - 1].id
    await new Promise((r) => setTimeout(r, 250)) // stay well under the team's 10 req/s
  }
  if (oldest > windowStart) {
    throw new Error(`Resend's log starts ${new Date(oldest).toISOString()}, after this send; it cannot be rebuilt`)
  }

  const result = missedRecipients({
    subscribers,
    sendStartedAt: sentAt,
    reachedAddresses: reached,
    isUndeliverable: isUndeliverableAddress,
  })
  console.log(`On the list at send time:      ${result.listed}`)
  console.log(`Reached (Resend log):          ${result.reached}`)
  console.log(`Missed (rebuilt):              ${result.missed.length}   vs failed_count ${nl.failed_count}`)
  console.log(`  unsubscribed since, dropped: ${result.unsubscribedSince.length}`)
  console.log(`  to queue:                    ${result.toQueue.length}`)
  console.log(`  e.g. ${result.toQueue.slice(0, 3).map(mask).join(", ")}`)

  // NOT overridable by any flag; see unsafeToQueue.
  const unsafe = unsafeToQueue(result, nl.sent_count ?? 0)
  if (unsafe) throw new Error(unsafe)
  const matches = result.missed.length === nl.failed_count
  if (!matches) console.log(`\nMISMATCH: rebuilt ${result.missed.length}, recorded ${nl.failed_count}.`)
  if (!apply) {
    console.log("\nDry run: nothing written. Add --apply to queue these rows.")
    return
  }
  if (!matches && !acceptMismatch)
    throw new Error("refusing --apply on a mismatch; rerun with --accept-mismatch once checked")

  const businessId = platformBusinessId()
  let queued = 0
  for (let i = 0; i < result.toQueue.length; i += 500) {
    const rows = result.toQueue
      .slice(i, i + 500)
      .map((email) => ({ business_id: businessId, newsletter_id: nl.id, email }))
    const { data, error } = await supabase
      .from("newsletter_deliveries")
      .upsert(rows, { onConflict: "newsletter_id,email", ignoreDuplicates: true })
      .select("id")
    if (error) throw new Error(`newsletter_deliveries insert: ${error.message} (${queued} queued before this)`)
    queued += (data ?? []).length
  }
  console.log(`\nQueued ${queued} new row(s) (${result.toQueue.length - queued} were already queued).`)
  console.log("The hourly retry sends them in working hours, 100 at a time. Watch /admin/newsletter.")
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
