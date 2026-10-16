// functions/src/lib/newsletter-retry-queue.ts
//
// The Firebase half of the newsletter retry queue (migration 00291). It only
// WRITES rows; lib/automation/newsletter-retry.ts drains them from the Next.js
// side, hourly, in working hours.

import type { SupabaseClient } from "@supabase/supabase-js"

const CHUNK = 500

/**
 * Did Resend REFUSE the batch? A 4xx means it sent nothing, so a retry is a
 * first copy. A 5xx, a missing status or a throw is no answer: it may have
 * sent. 409 is an idempotency conflict, which also means "maybe sent". Twin
 * of `isRefusal` in lib/automation/newsletter-retry.ts; keep them the same.
 */
export function isRefusal(error: { statusCode?: number | null } | null | undefined): boolean {
  const s = error?.statusCode
  return typeof s === "number" && s >= 400 && s < 500 && s !== 409
}

/**
 * Queues `emails` for a retry of `newsletterId`. `paused` files them stopped,
 * with that reason, for a person to check before anything resends them. An
 * address already queued for this newsletter is left alone (unique
 * (newsletter_id, email)), so a re-run cannot reset a row that has since been
 * sent. Returns how many rows were new. Never throws: the send it follows has
 * already happened, and its counts must still be written.
 */
export async function enqueueNewsletterRetries(
  supabase: SupabaseClient,
  businessId: string,
  newsletterId: string,
  emails: string[],
  opts: { paused?: string } = {},
): Promise<number> {
  let queued = 0
  for (let i = 0; i < emails.length; i += CHUNK) {
    const rows = emails.slice(i, i + CHUNK).map((email) => ({
      business_id: businessId,
      newsletter_id: newsletterId,
      email,
      ...(opts.paused ? { status: "paused", last_error: opts.paused } : {}),
    }))
    const { data, error } = await supabase
      .from("newsletter_deliveries")
      .upsert(rows, { onConflict: "newsletter_id,email", ignoreDuplicates: true })
      .select("id")
    if (error) {
      console.error(`[newsletter-retry-queue] could not queue ${rows.length} recipient(s): ${error.message}`)
      continue
    }
    queued += (data ?? []).length
  }
  return queued
}

/**
 * Records who one ACCEPTED batch reached, one `origin='send'` row per person
 * with that person's Resend id, so the webhook can stamp delivered / opened /
 * clicked on it and the newsletter's results survive Resend's ~30-day log
 * (migration 00292). Never throws and never retries: this is bookkeeping, and
 * the send it describes has already happened. Returns how many rows were new.
 */
export async function recordNewsletterSends(
  supabase: SupabaseClient,
  businessId: string,
  newsletterId: string,
  sent: { email: string; providerMessageId: string | null }[],
  at: Date,
): Promise<number> {
  if (sent.length === 0) return 0
  const rows = sent.map((s) => ({
    business_id: businessId,
    newsletter_id: newsletterId,
    email: s.email,
    origin: "send",
    status: "sent",
    provider_message_id: s.providerMessageId,
    sent_at: at.toISOString(),
  }))
  const { data, error } = await supabase
    .from("newsletter_deliveries")
    .upsert(rows, { onConflict: "newsletter_id,email", ignoreDuplicates: true })
    .select("id")
  if (error) {
    console.error(`[newsletter-retry-queue] could not record ${rows.length} sent recipient(s): ${error.message}`)
    return 0
  }
  return (data ?? []).length
}
