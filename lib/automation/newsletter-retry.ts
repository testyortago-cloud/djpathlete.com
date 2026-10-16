// lib/automation/newsletter-retry.ts — drains the newsletter retry queue
// (newsletter_deliveries, migration 00291) in small batches, only during the
// business's working hours on working days.
//
// Called hourly by POST /api/admin/internal/newsletter-retry. Each call sends
// at most ONE batch per business, from the newsletter that has waited longest.
// At 100 a batch and eight working hours a day, that is 800 a day per
// business: 4,783 rows clear in about six working days.
//
// WHY SO SLOW, AND WHY THE BRAKE. The list these rows come from is mostly one
// 2026-06-16 CSV import. On 2026-10-09 the first 1,100 sends had 102 hard
// bounces (9.3%). Resend asks for a bounce rate under 4% and can stop a
// domain that goes over it. The sending domain is the only one the app has,
// so a suspension stops every email the app sends: sign-in codes, follow-up
// sequences, coach alerts. The brake pauses one newsletter's retry once its
// own sends bounce more than `newsletter_retry_max_bounce_pct` (a
// system_settings row, default 4). A paused newsletter is visible on
// /admin/newsletter; an unpaused domain suspension is not visible anywhere.

import { createHash } from "node:crypto"
import { getBusinessSettings } from "@/lib/db/businesses"
import { getNewsletterById, updateNewsletter } from "@/lib/db/newsletters"
import { stillSubscribed } from "@/lib/db/newsletter"
import { getSetting } from "@/lib/db/system-settings"
import {
  businessesWithPendingRetries,
  listPendingDeliveries,
  markDeliveriesSkipped,
  markDeliveryRefused,
  markDeliverySent,
  noteDeliveryError,
  oldestPendingNewsletterId,
  pauseNewsletterRetry,
  settledRetryStats,
} from "@/lib/db/newsletter-deliveries"
import { buildNewsletterHtml } from "@/lib/email"
import { resend } from "@/lib/email/layout"

export const RETRY_BATCH_SIZE = 100
export const MAX_ATTEMPTS = 3
// ponytail: one working window for every tenant. Per-tenant columns on
// business_settings when a coach asks for different hours.
export const WORK_START_HOUR = 9
export const WORK_END_HOUR = 17
/** Bounces arrive by webhook within minutes; a send younger than this has not had its chance to bounce. */
export const SETTLE_MS = 30 * 60 * 1000
/** Fewer settled sends than this and one bounce would swing the rate. */
export const BRAKE_MIN_SETTLED = 100
export const DEFAULT_MAX_BOUNCE_PCT = 4

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

/** The brake's verdict on one newsletter's settled retry sends. Null means keep going. */
export function brakeReason(stats: { sent: number; bounced: number }, maxBouncePct: number): string | null {
  if (stats.sent < BRAKE_MIN_SETTLED) return null
  const pct = (stats.bounced / stats.sent) * 100
  if (pct <= maxBouncePct) return null
  return `paused: ${stats.bounced} of ${stats.sent} retried emails bounced (${pct.toFixed(1)}%, limit ${maxBouncePct}%)`
}

type SendError = { name?: string; message?: string; statusCode?: number | null }

/** A quota or rate limit: try the same rows next hour, spend nothing. */
function isQuotaError(e: SendError): boolean {
  return e.statusCode === 429 || /quota|rate_limit/i.test(e.name ?? "")
}

/**
 * Resend refused the batch for what is IN it (422). Only this spends an
 * attempt. Anything else (a missing key, an unverified sender, an outage) is
 * not the rows' fault, and burning their attempts would quietly fail the
 * whole queue three hours into an outage.
 */
function isRowFault(e: SendError): boolean {
  return e.statusCode === 422
}

export type BusinessTickOutcome =
  | { businessId: string; outcome: "outside_working_hours" | "empty" }
  | { businessId: string; outcome: "paused"; newsletterId: string; paused: number; reason: string }
  | { businessId: string; outcome: "deferred"; newsletterId: string; error: string }
  | { businessId: string; outcome: "refused" | "send_error"; newsletterId: string; error: string }
  | { businessId: string; outcome: "sent"; newsletterId: string; sent: number; skipped: number }
  | { businessId: string; outcome: "failed"; error: string }

export type NewsletterRetryTickSummary = { businesses: BusinessTickOutcome[] }

export async function runNewsletterRetryTick(now: Date = new Date()): Promise<NewsletterRetryTickSummary> {
  // No fallback address. A guessed From is how 73 sequence emails were lost on
  // 2026-08-31; refusing is visible in cron_runs, a wrong domain is not.
  const from = process.env.RESEND_FROM_EMAIL
  if (!from) throw new Error("RESEND_FROM_EMAIL is not set; no newsletter retry was sent")
  const maxBouncePct = await getSetting<number>("newsletter_retry_max_bounce_pct", DEFAULT_MAX_BOUNCE_PCT)

  const businesses: BusinessTickOutcome[] = []
  for (const businessId of await businessesWithPendingRetries()) {
    try {
      businesses.push(await drainBusiness(businessId, now, from, maxBouncePct))
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
  maxBouncePct: number,
): Promise<BusinessTickOutcome> {
  const settings = await getBusinessSettings(businessId)
  if (!isWorkingTime(now, settings.timezone)) return { businessId, outcome: "outside_working_hours" }

  const newsletterId = await oldestPendingNewsletterId(businessId)
  if (!newsletterId) return { businessId, outcome: "empty" }

  const reason = brakeReason(
    await settledRetryStats(businessId, newsletterId, new Date(now.getTime() - SETTLE_MS)),
    maxBouncePct,
  )
  if (reason) {
    const paused = await pauseNewsletterRetry(businessId, newsletterId, reason)
    return { businessId, outcome: "paused", newsletterId, paused, reason }
  }

  const rows = await listPendingDeliveries(businessId, newsletterId, RETRY_BATCH_SIZE)
  const subscribed = await stillSubscribed(rows.map((r) => r.email))
  const gone = rows.filter((r) => !subscribed.has(r.email))
  const due = rows.filter((r) => subscribed.has(r.email))
  await markDeliveriesSkipped(gone.map((r) => r.id))
  if (due.length === 0) return { businessId, outcome: "sent", newsletterId, sent: 0, skipped: gone.length }

  const newsletter = await getNewsletterById(newsletterId)
  const html = buildNewsletterHtml(newsletter.content)
  // Same rows, same key: a repeated tick inside Resend's 24-hour window
  // returns the first answer instead of sending twice.
  const idempotencyKey = `newsletter-retry/${createHash("sha256")
    .update(due.map((r) => r.id).join(","))
    .digest("hex")}`
  const { data, error } = await resend.batch.send(
    due.map((r) => ({ from, to: r.email, subject: newsletter.subject, html })),
    { idempotencyKey },
  )

  if (error) {
    const e = error as SendError
    const message = `${e.name ?? "error"}: ${e.message ?? "unknown"}`
    if (isQuotaError(e)) {
      await noteDeliveryError(
        due.map((r) => r.id),
        message,
      )
      return { businessId, outcome: "deferred", newsletterId, error: message }
    }
    if (isRowFault(e)) {
      // ponytail: one invalid address refuses its whole batch of 100 (strict
      // validation). Split the batch if refusals show up in last_error.
      await Promise.all(due.map((r) => markDeliveryRefused(r, message, MAX_ATTEMPTS)))
      return { businessId, outcome: "refused", newsletterId, error: message }
    }
    await noteDeliveryError(
      due.map((r) => r.id),
      message,
    )
    return { businessId, outcome: "send_error", newsletterId, error: message }
  }

  // Strict batch validation: data[i] is the email at payload index i.
  const ids = data?.data ?? []
  await Promise.all(due.map((r, i) => markDeliverySent(r, ids[i]?.id ?? null, now)))
  await updateNewsletter(newsletterId, {
    sent_count: (newsletter.sent_count ?? 0) + due.length,
    failed_count: Math.max(0, (newsletter.failed_count ?? 0) - due.length),
  })
  return { businessId, outcome: "sent", newsletterId, sent: due.length, skipped: gone.length }
}
