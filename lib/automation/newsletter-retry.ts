// lib/automation/newsletter-retry.ts — drains the newsletter retry queue
// (newsletter_deliveries, migration 00291) in small batches, only during the
// business's working hours on working days.
//
// Called hourly by POST /api/admin/internal/newsletter-retry. Each call sends
// at most ONE batch per business, from the newsletter that has waited longest.
// At 100 a batch and eight working hours a day, that is 800 a day per
// business: 4,783 rows clear in about six working days.
//
// NOBODY GETS IT TWICE. Rows are claimed (`sending`, with a batch key) BEFORE
// the send. If Resend's answer is unclear (a timeout, a 5xx, no status), the
// rows stay claimed and the next tick resends exactly those rows under exactly
// that key, which Resend answers from its idempotency cache if the first one
// landed. Past Resend's 24-hour window that is no longer safe, so the rows are
// paused for a person to check instead. Only a clear refusal (a 4xx) puts rows
// back in the queue, because only a refusal proves nothing was sent.
//
// WHY SO SLOW, AND WHY THE BRAKE. The list these rows come from is mostly one
// 2026-06-16 CSV import. On 2026-10-09 the first 1,100 sends had 102 hard
// bounces (9.3%) and 2 spam complaints. Resend asks for bounces under 4% and
// can stop a domain that goes over. The sending domain is the only one the app
// has, so a suspension stops every email the app sends: sign-in codes,
// follow-up sequences, coach alerts. The brake pauses one newsletter's retry
// once its own settled sends go over `newsletter_retry_max_bounce_pct`
// (default 4) or `newsletter_retry_max_complaint_pct` (default 0.1), both
// system_settings rows. A paused newsletter is visible on /admin/newsletter;
// a domain suspension is not visible anywhere.

import { createHash } from "node:crypto"
import { getBusinessSettings } from "@/lib/db/businesses"
import { getNewsletterById, updateNewsletter } from "@/lib/db/newsletters"
import { stillSubscribed } from "@/lib/db/newsletter"
import { getSetting } from "@/lib/db/system-settings"
import {
  businessesWithRetryWork,
  claimDeliveries,
  listInflightDeliveries,
  listPendingDeliveries,
  markBatchSent,
  markDeliveriesSkipped,
  markDeliveryFailed,
  noteDeliveryError,
  oldestPendingNewsletterId,
  pauseDeliveries,
  pauseNewsletterRetry,
  releaseDeliveries,
  settledRetryStats,
  type NewsletterDelivery,
} from "@/lib/db/newsletter-deliveries"
import { buildNewsletterHtml } from "@/lib/email"
import { resend } from "@/lib/email/layout"

export const RETRY_BATCH_SIZE = 100
// ponytail: one working window for every tenant. Per-tenant columns on
// business_settings when a coach asks for different hours.
export const WORK_START_HOUR = 9
export const WORK_END_HOUR = 17
/** Bounces arrive by webhook within minutes; a send younger than this has not had its chance to bounce. */
export const SETTLE_MS = 30 * 60 * 1000
/** Resend keeps an Idempotency-Key for 24 hours. Resend an unconfirmed batch only well inside that. */
export const INFLIGHT_RESEND_MS = 23 * 60 * 60 * 1000
/** Fewer settled sends than this and one bounce would swing the rate. */
export const BRAKE_MIN_SETTLED = 100
/** Complaints are rarer, so one needs a bigger sample before it means anything. */
export const BRAKE_MIN_SETTLED_FOR_COMPLAINTS = 500
export const DEFAULT_MAX_BOUNCE_PCT = 4
export const DEFAULT_MAX_COMPLAINT_PCT = 0.1

const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"])

/** Mon-Fri, 09:00 up to 17:00, on the wall clock of `timezone`. An unknown timezone is never working time. */
export function isWorkingTime(now: Date, timezone: string): boolean {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now)
  } catch {
    return false
  }
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? ""
  const hour = Number(parts.find((p) => p.type === "hour")?.value)
  return WEEKDAYS.has(weekday) && hour >= WORK_START_HOUR && hour < WORK_END_HOUR
}

export type BrakeLimits = { maxBouncePct: number; maxComplaintPct: number }

/** The brake's verdict on one newsletter's settled retry sends, in words the owner reads. Null means keep going. */
export function brakeReason(
  stats: { sent: number; bounced: number; complained: number },
  limits: BrakeLimits,
): string | null {
  const pct = (n: number) => (n / stats.sent) * 100
  const count = (n: number) => n.toLocaleString("en-US")
  if (stats.sent >= BRAKE_MIN_SETTLED && pct(stats.bounced) > limits.maxBouncePct) {
    return `${count(stats.bounced)} of ${count(stats.sent)} resent emails bounced (${pct(stats.bounced).toFixed(1)}%, the limit is ${limits.maxBouncePct}%).`
  }
  if (stats.sent >= BRAKE_MIN_SETTLED_FOR_COMPLAINTS && pct(stats.complained) > limits.maxComplaintPct) {
    return `${count(stats.complained)} of ${count(stats.sent)} people marked a resent email as spam (${pct(stats.complained).toFixed(2)}%, the limit is ${limits.maxComplaintPct}%).`
  }
  return null
}

/** How many rows the next batch takes. Each 422 a row has had halves it, so one bad address ends up alone. */
export function batchSizeFor(attempts: number): number {
  return Math.max(1, Math.floor(RETRY_BATCH_SIZE / 2 ** attempts))
}

type SendError = { name?: string; message?: string; statusCode?: number | null }

/**
 * A refusal: Resend answered 4xx, so it sent nothing. Anything else might have
 * been sent. Except 409: that is Resend saying the KEY was used before (a
 * resend whose body changed, e.g. the newsletter was edited), so the first
 * send may well have landed. Twin of `isRefusal` in
 * functions/src/lib/newsletter-retry-queue.ts; keep them the same.
 */
function isRefusal(e: SendError): boolean {
  return typeof e.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500 && e.statusCode !== 409
}

export type BusinessTickOutcome =
  | { businessId: string; outcome: "outside_working_hours" | "empty" | "busy" }
  | { businessId: string; outcome: "paused"; newsletterId: string; paused: number; reason: string }
  | {
      businessId: string
      outcome: "deferred" | "refused" | "send_error" | "unconfirmed"
      newsletterId: string
      error: string
    }
  | { businessId: string; outcome: "sent"; newsletterId: string; sent: number; skipped: number }
  | { businessId: string; outcome: "failed"; error: string }

export type NewsletterRetryTickSummary = { businesses: BusinessTickOutcome[] }

export async function runNewsletterRetryTick(now: Date = new Date()): Promise<NewsletterRetryTickSummary> {
  // No fallback address. A guessed From is how 73 sequence emails were lost on
  // 2026-08-31; refusing is visible in cron_runs, a wrong domain is not.
  const from = process.env.RESEND_FROM_EMAIL
  if (!from) throw new Error("RESEND_FROM_EMAIL is not set; no newsletter retry was sent")
  const limits: BrakeLimits = {
    maxBouncePct: await getSetting<number>("newsletter_retry_max_bounce_pct", DEFAULT_MAX_BOUNCE_PCT),
    maxComplaintPct: await getSetting<number>("newsletter_retry_max_complaint_pct", DEFAULT_MAX_COMPLAINT_PCT),
  }

  const businesses: BusinessTickOutcome[] = []
  for (const businessId of await businessesWithRetryWork()) {
    try {
      businesses.push(await drainBusiness(businessId, now, from, limits))
    } catch (err) {
      businesses.push({ businessId, outcome: "failed", error: (err as Error).message })
    }
  }
  return { businesses }
}

async function drainBusiness(
  businessId: string,
  now: Date,
  from: string,
  limits: BrakeLimits,
): Promise<BusinessTickOutcome> {
  const settings = await getBusinessSettings(businessId)
  if (!isWorkingTime(now, settings.timezone)) return { businessId, outcome: "outside_working_hours" }

  // An unconfirmed batch is settled first, and nothing new goes out until it is.
  const inflight = await listInflightDeliveries(businessId)
  if (inflight.length > 0) {
    const newsletterId = inflight[0].newsletter_id
    const claimedAt = new Date(inflight[0].claimed_at ?? 0)
    const key = inflight[0].batch_key
    if (!key || now.getTime() - claimedAt.getTime() >= INFLIGHT_RESEND_MS) {
      const day = claimedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: settings.timezone })
      const reason = `Resend never confirmed a batch of ${inflight.length} sent on ${day}. Check Resend before resuming, or those people may get it twice.`
      await pauseDeliveries(
        inflight.map((r) => r.id),
        reason,
      )
      return { businessId, outcome: "paused", newsletterId, paused: inflight.length, reason }
    }
    return send(businessId, newsletterId, inflight, key, from, now, 0)
  }

  const newsletterId = await oldestPendingNewsletterId(businessId)
  if (!newsletterId) return { businessId, outcome: "empty" }

  const reason = brakeReason(
    await settledRetryStats(businessId, newsletterId, new Date(now.getTime() - SETTLE_MS)),
    limits,
  )
  if (reason) {
    const paused = await pauseNewsletterRetry(businessId, newsletterId, reason)
    return { businessId, outcome: "paused", newsletterId, paused, reason }
  }

  const head = await listPendingDeliveries(businessId, newsletterId, RETRY_BATCH_SIZE)
  const rows = head.slice(0, batchSizeFor(head[0]?.attempts ?? 0))
  const subscribed = await stillSubscribed(rows.map((r) => r.email))
  const gone = rows.filter((r) => !subscribed.has(r.email))
  const due = rows.filter((r) => subscribed.has(r.email))
  await markDeliveriesSkipped(gone.map((r) => r.id))
  if (due.length === 0) return { businessId, outcome: "sent", newsletterId, sent: 0, skipped: gone.length }

  const batchKey = keyFor(due, now)
  const claimed = await claimDeliveries(
    due.map((r) => r.id),
    batchKey,
    now,
  )
  // Another tick got some of these first. Whatever this one claimed stays
  // `sending` under this key and is settled next hour, before anything new.
  if (claimed.length !== due.length) return { businessId, outcome: "busy" }

  return send(businessId, newsletterId, due, batchKey, from, now, gone.length)
}

/** A new key per claim, so a key Resend refused is never reused; the SAME key for every resend of one claim. */
function keyFor(rows: NewsletterDelivery[], claimedAt: Date): string {
  const ids = rows.map((r) => r.id).join(",")
  return `newsletter-retry/${createHash("sha256").update(`${ids}@${claimedAt.toISOString()}`).digest("hex")}`
}

async function send(
  businessId: string,
  newsletterId: string,
  rows: NewsletterDelivery[],
  idempotencyKey: string,
  from: string,
  now: Date,
  skipped: number,
): Promise<BusinessTickOutcome> {
  const newsletter = await getNewsletterById(newsletterId)
  const html = buildNewsletterHtml(newsletter.content)
  const ids = rows.map((r) => r.id)

  let result: Awaited<ReturnType<typeof resend.batch.send>>
  try {
    result = await resend.batch.send(
      rows.map((r) => ({ from, to: r.email, subject: newsletter.subject, html })),
      { idempotencyKey },
    )
  } catch (err) {
    // Thrown, so no answer at all: it may have been sent. Keep the claim.
    const message = `exception: ${(err as Error).message}`
    await noteDeliveryError(ids, message)
    return { businessId, outcome: "unconfirmed", newsletterId, error: message }
  }

  const { data, error } = result
  if (error) {
    const e = error as SendError
    const message = `${e.statusCode ?? "no status"} ${e.name ?? "error"}: ${e.message ?? "unknown"}`
    if (!isRefusal(e)) {
      await noteDeliveryError(ids, message)
      return { businessId, outcome: "unconfirmed", newsletterId, error: message }
    }
    if (e.statusCode === 429) {
      // A quota or rate limit: the same rows try again next hour.
      await releaseDeliveries(rows, message, false)
      return { businessId, outcome: "deferred", newsletterId, error: message }
    }
    if (e.statusCode === 422) {
      // Something IN the batch was refused. Alone, that row is the culprit.
      if (rows.length === 1) await markDeliveryFailed(rows[0].id, message)
      else await releaseDeliveries(rows, message, true)
      return { businessId, outcome: "refused", newsletterId, error: message }
    }
    // Any other refusal (a bad key, an unverified sender) is not the rows'
    // fault: back to the queue, no attempt spent.
    await releaseDeliveries(rows, message, false)
    return { businessId, outcome: "send_error", newsletterId, error: message }
  }

  // Strict batch validation (the SDK's default): data[i] is the email at payload index i.
  const providerIds = data?.data ?? []
  await markBatchSent(
    rows,
    rows.map((_, i) => providerIds[i]?.id ?? null),
    now,
  )
  await updateNewsletter(newsletterId, {
    sent_count: (newsletter.sent_count ?? 0) + rows.length,
    failed_count: Math.max(0, (newsletter.failed_count ?? 0) - rows.length),
  })
  return { businessId, outcome: "sent", newsletterId, sent: rows.length, skipped }
}
