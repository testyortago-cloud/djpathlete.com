// lib/db/newsletter-deliveries.ts — the newsletter retry queue (migration 00291).
//
// One row per subscriber a newsletter send failed to reach. Rows are written by
// functions/src/newsletter-send.ts and scripts/enqueue-newsletter-retry.ts, and
// drained by lib/automation/newsletter-retry.ts. Every reader here takes a
// business_id except the webhook's bounce write, which keys on Resend's own
// email id and never reads a row back.

import { createServiceRoleClient } from "@/lib/supabase"

export type NewsletterDeliveryStatus = "pending" | "sent" | "failed" | "skipped" | "paused"

export type NewsletterDelivery = {
  id: string
  business_id: string
  newsletter_id: string
  email: string
  status: NewsletterDeliveryStatus
  attempts: number
  last_error: string | null
  provider_message_id: string | null
  sent_at: string | null
  bounced_at: string | null
}

/** One newsletter's queue, from the newsletter_delivery_summary view. */
export type NewsletterRetrySummary = {
  newsletter_id: string
  pending: number
  sent: number
  failed: number
  skipped: number
  paused: number
  bounced: number
}

function getClient() {
  return createServiceRoleClient()
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`[newsletter-deliveries] ${what}: ${error.message}`)
}

/** Businesses with at least one row waiting. Read from the view, so it is one row per newsletter, never capped by the queue's size. */
export async function businessesWithPendingRetries(): Promise<string[]> {
  const { data, error } = await getClient().from("newsletter_delivery_summary").select("business_id").gt("pending", 0)
  if (error) fail("businessesWithPendingRetries", error)
  return [...new Set((data ?? []).map((r) => (r as { business_id: string }).business_id))]
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
    .select(
      "id, business_id, newsletter_id, email, status, attempts, last_error, provider_message_id, sent_at, bounced_at",
    )
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
 * Retry sends old enough for Resend to have reported a bounce, and how many of
 * them did. Both are exact counts, so the queue's size never truncates them.
 */
export async function settledRetryStats(
  businessId: string,
  newsletterId: string,
  settledBefore: Date,
): Promise<{ sent: number; bounced: number }> {
  const base = () =>
    getClient()
      .from("newsletter_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("newsletter_id", newsletterId)
      .eq("status", "sent")
      .lt("sent_at", settledBefore.toISOString())
  const [sent, bounced] = await Promise.all([base(), base().not("bounced_at", "is", null)])
  if (sent.error) fail("settledRetryStats(sent)", sent.error)
  if (bounced.error) fail("settledRetryStats(bounced)", bounced.error)
  return { sent: sent.count ?? 0, bounced: bounced.count ?? 0 }
}

/** The bounce brake: every waiting row of this newsletter stops. Returns how many. */
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

export async function markDeliveriesSkipped(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await getClient()
    .from("newsletter_deliveries")
    .update({ status: "skipped", last_error: "unsubscribed before the retry" })
    .in("id", ids)
  if (error) fail("markDeliveriesSkipped", error)
}

export async function markDeliverySent(
  row: Pick<NewsletterDelivery, "id" | "attempts">,
  providerMessageId: string | null,
  at: Date,
): Promise<void> {
  const { error } = await getClient()
    .from("newsletter_deliveries")
    .update({
      status: "sent",
      provider_message_id: providerMessageId,
      sent_at: at.toISOString(),
      attempts: row.attempts + 1,
      last_error: null,
    })
    .eq("id", row.id)
  if (error) fail("markDeliverySent", error)
}

/**
 * Resend refused the batch because of what is IN it. The row stays pending
 * until it has been refused `maxAttempts` times, then it is `failed`.
 */
export async function markDeliveryRefused(
  row: Pick<NewsletterDelivery, "id" | "attempts">,
  message: string,
  maxAttempts: number,
): Promise<void> {
  const attempts = row.attempts + 1
  const { error } = await getClient()
    .from("newsletter_deliveries")
    .update({ attempts, last_error: message, status: attempts >= maxAttempts ? "failed" : "pending" })
    .eq("id", row.id)
  if (error) fail("markDeliveryRefused", error)
}

/** Resend refused for a reason that is not the rows' fault. Note it; spend no attempt. */
export async function noteDeliveryError(ids: string[], message: string): Promise<void> {
  if (ids.length === 0) return
  const { error } = await getClient().from("newsletter_deliveries").update({ last_error: message }).in("id", ids)
  if (error) fail("noteDeliveryError", error)
}

/**
 * The Resend webhook's permanent-bounce arm. Keyed on Resend's email id, which
 * is unique across the account, so it cannot touch another tenant's row; it
 * matches nothing for every email that is not a newsletter retry.
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

/** The /admin/newsletter status line, keyed by newsletter id. */
export async function getNewsletterRetrySummaries(businessId: string): Promise<Record<string, NewsletterRetrySummary>> {
  const { data, error } = await getClient()
    .from("newsletter_delivery_summary")
    .select("newsletter_id, pending, sent, failed, skipped, paused, bounced")
    .eq("business_id", businessId)
  if (error) fail("getNewsletterRetrySummaries", error)
  const out: Record<string, NewsletterRetrySummary> = {}
  for (const row of (data ?? []) as NewsletterRetrySummary[]) out[row.newsletter_id] = row
  return out
}
