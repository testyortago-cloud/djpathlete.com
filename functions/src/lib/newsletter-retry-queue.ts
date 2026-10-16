// functions/src/lib/newsletter-retry-queue.ts
//
// The Firebase half of the newsletter retry queue (migration 00291). It only
// WRITES rows; lib/automation/newsletter-retry.ts drains them from the Next.js
// side, hourly, in working hours.

import type { SupabaseClient } from "@supabase/supabase-js"

const CHUNK = 500

/**
 * Queues `emails` for a retry of `newsletterId`. An address already queued
 * for this newsletter is left alone (unique (newsletter_id, email)), so a
 * re-run cannot reset a row that has since been sent. Returns how many rows
 * were new. Never throws: the send it follows has already happened, and its
 * counts must still be written.
 */
export async function enqueueNewsletterRetries(
  supabase: SupabaseClient,
  businessId: string,
  newsletterId: string,
  emails: string[],
): Promise<number> {
  let queued = 0
  for (let i = 0; i < emails.length; i += CHUNK) {
    const rows = emails
      .slice(i, i + CHUNK)
      .map((email) => ({ business_id: businessId, newsletter_id: newsletterId, email }))
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
