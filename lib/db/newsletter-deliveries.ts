// lib/db/newsletter-deliveries.ts — the newsletter retry queue (migration 00291).
//
// One row per subscriber a newsletter send failed to reach. Rows are written by
// functions/src/newsletter-send.ts and scripts/enqueue-newsletter-retry.ts, and
// drained by lib/automation/newsletter-retry.ts. Every reader here takes a
// business_id except the webhook's bounce and complaint writes, which key on
// Resend's own email id and never read a row back.

import { createServiceRoleClient } from "@/lib/supabase"

export type NewsletterDeliveryStatus = "pending" | "sending" | "sent" | "failed" | "skipped" | "paused"

export type NewsletterDelivery = {
  id: string
  business_id: string
  newsletter_id: string
  email: string
  status: NewsletterDeliveryStatus
  attempts: number
  batch_key: string | null
  claimed_at: string | null
}

/** One newsletter's queue, from the newsletter_delivery_summary view. */
export type NewsletterRetrySummary = {
  newsletter_id: string
  pending: number
  sending: number
  sent: number
  failed: number
  skipped: number
  paused: number
  bounced: number
  complained: number
  pause_reason: string | null
}

const ROW = "id, business_id, newsletter_id, email, status, attempts, batch_key, claimed_at"

function getClient() {
  return createServiceRoleClient()
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`[newsletter-deliveries] ${what}: ${error.message}`)
}

/** Businesses with rows waiting or a batch unconfirmed. Read from the view: one row per newsletter, never capped by the queue's size. */
export async function businessesWithRetryWork(): Promise<string[]> {
  const { data, error } = await getClient()
    .from("newsletter_delivery_summary")
    .select("business_id")
    .or("pending.gt.0,sending.gt.0")
  if (error) fail("businessesWithRetryWork", error)
  return [...new Set((data ?? []).map((r) => (r as { business_id: string }).business_id))]
}

/**
 * The oldest batch a previous tick claimed and could not confirm, if any:
 * every row under ONE batch key. Never a mix of two claims: resending one
 * claim's rows under another claim's key would be a fresh send to all of them.
 */
export async function listInflightDeliveries(businessId: string): Promise<NewsletterDelivery[]> {
  const { data: first, error: firstErr } = await getClient()
    .from("newsletter_deliveries")
    .select("batch_key")
    .eq("business_id", businessId)
    .eq("status", "sending")
    .order("claimed_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (firstErr) fail("listInflightDeliveries(first)", firstErr)
  if (first === null) return []
  const key = (first as { batch_key: string | null }).batch_key
  // A `sending` row without a key was not made by claimDeliveries (a hand
  // edit). The caller pauses whatever comes back keyless.
  const { data, error } = key
    ? await getClient()
        .from("newsletter_deliveries")
        .select(ROW)
        .eq("business_id", businessId)
        .eq("status", "sending")
        .eq("batch_key", key)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(100)
    : await getClient()
        .from("newsletter_deliveries")
        .select(ROW)
        .eq("business_id", businessId)
        .eq("status", "sending")
        .is("batch_key", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(100)
  if (error) fail("listInflightDeliveries", error)
  return (data ?? []) as NewsletterDelivery[]
}

/** The newsletter whose rows have waited longest. One newsletter drains at a time. */
export async function oldestPendingNewsletterId(businessId: string): Promise<string | null> {
  const { data, error } = await getClient()
    .from("newsletter_deliveries")
    .select("newsletter_id")
    .eq("business_id", businessId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) fail("oldestPendingNewsletterId", error)
  return (data as { newsletter_id: string } | null)?.newsletter_id ?? null
}

export async function listPendingDeliveries(
  businessId: string,
  newsletterId: string,
  limit: number,
): Promise<NewsletterDelivery[]> {
  const { data, error } = await getClient()
    .from("newsletter_deliveries")
    .select(ROW)
    .eq("business_id", businessId)
    .eq("newsletter_id", newsletterId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit)
  if (error) fail("listPendingDeliveries", error)
  return (data ?? []) as NewsletterDelivery[]
}

/**
 * Retry sends old enough for Resend to have reported a bounce or a complaint,
 * and how many did. Exact counts, so the queue's size never truncates them.
 */
export async function settledRetryStats(
  businessId: string,
  newsletterId: string,
  settledBefore: Date,
): Promise<{ sent: number; bounced: number; complained: number }> {
  const base = () =>
    getClient()
      .from("newsletter_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("newsletter_id", newsletterId)
      // The retry judges its OWN sends. The blast's rows (origin 'send',
      // migration 00292) carry their own bounces and must not move the brake.
      .eq("origin", "retry")
      .eq("status", "sent")
      .lt("sent_at", settledBefore.toISOString())
  const [sent, bounced, complained] = await Promise.all([
    base(),
    base().not("bounced_at", "is", null),
    base().not("complained_at", "is", null),
  ])
  for (const [what, r] of [
    ["sent", sent],
    ["bounced", bounced],
    ["complained", complained],
  ] as const) {
    if (r.error) fail(`settledRetryStats(${what})`, r.error)
  }
  return { sent: sent.count ?? 0, bounced: bounced.count ?? 0, complained: complained.count ?? 0 }
}

/** The brake: every waiting row of this newsletter stops. Returns how many. */
export async function pauseNewsletterRetry(businessId: string, newsletterId: string, reason: string): Promise<number> {
  const { data, error } = await getClient()
    .from("newsletter_deliveries")
    .update({ status: "paused", last_error: reason })
    .eq("business_id", businessId)
    .eq("newsletter_id", newsletterId)
    .eq("status", "pending")
    .select("id")
  if (error) fail("pauseNewsletterRetry", error)
  return (data ?? []).length
}

/** Stops specific rows for a person to check (an unconfirmed batch past Resend's idempotency window). */
export async function pauseDeliveries(ids: string[], reason: string): Promise<void> {
  if (ids.length === 0) return
  const { error } = await getClient()
    .from("newsletter_deliveries")
    .update({ status: "paused", last_error: reason })
    .in("id", ids)
  if (error) fail("pauseDeliveries", error)
}

export async function markDeliveriesSkipped(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await getClient()
    .from("newsletter_deliveries")
    .update({ status: "skipped", last_error: "unsubscribed before the retry" })
    .in("id", ids)
    .eq("status", "pending")
  if (error) fail("markDeliveriesSkipped", error)
}

/**
 * Claims pending rows for one batch BEFORE it is sent. Only rows still
 * pending are taken, so two ticks cannot both claim a row; the caller sends
 * only if it got every row it asked for.
 */
export async function claimDeliveries(ids: string[], batchKey: string, at: Date): Promise<string[]> {
  const { data, error } = await getClient()
    .from("newsletter_deliveries")
    .update({ status: "sending", batch_key: batchKey, claimed_at: at.toISOString() })
    .in("id", ids)
    .eq("status", "pending")
    .select("id")
  if (error) fail("claimDeliveries", error)
  return (data ?? []).map((r) => (r as { id: string }).id)
}

/**
 * Resend REFUSED the batch, so nothing in it was sent: the rows go back to
 * pending. `spendAttempt` is for a 422, which halves the next batch.
 */
export async function releaseDeliveries(
  rows: Pick<NewsletterDelivery, "id" | "attempts">[],
  message: string,
  spendAttempt: boolean,
): Promise<void> {
  if (rows.length === 0) return
  const byAttempts = new Map<number, string[]>()
  for (const r of rows) {
    const next = spendAttempt ? r.attempts + 1 : r.attempts
    byAttempts.set(next, [...(byAttempts.get(next) ?? []), r.id])
  }
  for (const [attempts, ids] of byAttempts) {
    const { error } = await getClient()
      .from("newsletter_deliveries")
      .update({ status: "pending", batch_key: null, claimed_at: null, attempts, last_error: message })
      .in("id", ids)
    if (error) fail("releaseDeliveries", error)
  }
}

/** A row Resend refused on its own (a batch of one): it will never send. */
export async function markDeliveryFailed(id: string, message: string): Promise<void> {
  const { error } = await getClient()
    .from("newsletter_deliveries")
    .update({ status: "failed", batch_key: null, last_error: message })
    .eq("id", id)
  if (error) fail("markDeliveryFailed", error)
}

/**
 * Marks a whole accepted batch sent in ONE statement, each row with its own
 * Resend id, so a failure leaves every row `sending` (and resendable under the
 * same key) rather than some sent and some not.
 */
export async function markBatchSent(
  rows: NewsletterDelivery[],
  providerIds: (string | null)[],
  at: Date,
): Promise<void> {
  const { error } = await getClient()
    .from("newsletter_deliveries")
    .upsert(
      rows.map((r, i) => ({
        id: r.id,
        business_id: r.business_id,
        newsletter_id: r.newsletter_id,
        email: r.email,
        status: "sent",
        provider_message_id: providerIds[i] ?? null,
        sent_at: at.toISOString(),
        last_error: null,
      })),
      { onConflict: "id" },
    )
  if (error) fail("markBatchSent", error)
}

/** Keeps an unconfirmed batch's rows `sending` but records why. */
export async function noteDeliveryError(ids: string[], message: string): Promise<void> {
  if (ids.length === 0) return
  const { error } = await getClient().from("newsletter_deliveries").update({ last_error: message }).in("id", ids)
  if (error) fail("noteDeliveryError", error)
}

/**
 * The Resend webhook's arms. Keyed on Resend's email id, which is unique
 * across the account, so they cannot touch another tenant's row; they match
 * nothing for every email that is not a newsletter retry. Two functions, not
 * one taking a column name: the live select contract
 * (npm run test:integration:selects) can only probe a filter column it can read.
 */
export async function markNewsletterDeliveryBounced(providerMessageId: string, at: Date): Promise<boolean> {
  const { data, error } = await getClient()
    .from("newsletter_deliveries")
    .update({ bounced_at: at.toISOString() })
    .eq("provider_message_id", providerMessageId)
    .is("bounced_at", null)
    .select("id")
  if (error) fail("markNewsletterDeliveryBounced", error)
  return (data ?? []).length > 0
}

export async function markNewsletterDeliveryComplained(providerMessageId: string, at: Date): Promise<boolean> {
  const { data, error } = await getClient()
    .from("newsletter_deliveries")
    .update({ complained_at: at.toISOString() })
    .eq("provider_message_id", providerMessageId)
    .is("complained_at", null)
    .select("id")
  if (error) fail("markNewsletterDeliveryComplained", error)
  return (data ?? []).length > 0
}

// The results stamps (migration 00292), first time only. Three functions, not
// one taking a column, for the same reason as the two above.
export async function markNewsletterDeliveryDelivered(providerMessageId: string, at: Date): Promise<boolean> {
  const { data, error } = await getClient()
    .from("newsletter_deliveries")
    .update({ delivered_at: at.toISOString() })
    .eq("provider_message_id", providerMessageId)
    .is("delivered_at", null)
    .select("id")
  if (error) fail("markNewsletterDeliveryDelivered", error)
  return (data ?? []).length > 0
}

export async function markNewsletterDeliveryOpened(providerMessageId: string, at: Date): Promise<boolean> {
  const { data, error } = await getClient()
    .from("newsletter_deliveries")
    .update({ opened_at: at.toISOString() })
    .eq("provider_message_id", providerMessageId)
    .is("opened_at", null)
    .select("id")
  if (error) fail("markNewsletterDeliveryOpened", error)
  return (data ?? []).length > 0
}

export async function markNewsletterDeliveryClicked(providerMessageId: string, at: Date): Promise<boolean> {
  const { data, error } = await getClient()
    .from("newsletter_deliveries")
    .update({ clicked_at: at.toISOString() })
    .eq("provider_message_id", providerMessageId)
    .is("clicked_at", null)
    .select("id")
  if (error) fail("markNewsletterDeliveryClicked", error)
  return (data ?? []).length > 0
}

/** One newsletter's results, from the newsletter_delivery_results view (migration 00292). */
export type NewsletterResults = {
  newsletter_id: string
  /** Everyone Resend accepted an email for, blast and retry together. */
  recipients: number
  delivered: number
  opened: number
  clicked: number
  /** Hard bounces only: the address does not exist. */
  bounced: number
  complained: number
}

/** Results for every newsletter that has any, keyed by newsletter id. */
export async function getNewsletterResults(businessId: string): Promise<Record<string, NewsletterResults>> {
  const { data, error } = await getClient()
    .from("newsletter_delivery_results")
    .select("newsletter_id, recipients, delivered, opened, clicked, bounced, complained")
    .eq("business_id", businessId)
  if (error) fail("getNewsletterResults", error)
  const out: Record<string, NewsletterResults> = {}
  for (const row of (data ?? []) as NewsletterResults[]) out[row.newsletter_id] = row
  return out
}

/** The /admin/newsletter status line, keyed by newsletter id. */
export async function getNewsletterRetrySummaries(businessId: string): Promise<Record<string, NewsletterRetrySummary>> {
  const { data, error } = await getClient()
    .from("newsletter_delivery_summary")
    .select("newsletter_id, pending, sending, sent, failed, skipped, paused, bounced, complained, pause_reason")
    .eq("business_id", businessId)
  if (error) fail("getNewsletterRetrySummaries", error)
  const out: Record<string, NewsletterRetrySummary> = {}
  for (const row of (data ?? []) as NewsletterRetrySummary[]) out[row.newsletter_id] = row
  return out
}
