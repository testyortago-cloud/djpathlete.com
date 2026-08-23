// lib/db/chat-retention.ts — the chat assistant's retention window.
//
// A chat transcript is the most personal thing this subsystem stores. It is
// free-text a stranger typed into a box on a public page, and people type
// things into a chat window they would never put on a contact form: a child's
// name, an injury, what they can afford. `chat_conversations` also carries an
// `ip_hash` and a user agent. None of it has a read site older than a few
// weeks — `/admin/chat` is an operational view of recent conversations — so
// keeping it forever buys nothing and risks everything.
//
// WHY `created_at` AND NOT `last_activity_at`. The retention promise this
// implements is "no conversation is kept more than N days after it started",
// and that is a bound nothing can extend. Measuring from last activity would
// let a conversation somebody keeps poking renew its own retention window
// indefinitely, which is the one property a retention window must not have.
// In practice the two are minutes apart — a conversation is capped at 20
// messages — so this costs nothing and says something stronger.
//
// WHY THE MESSAGES ARE NOT DELETED HERE. `chat_messages.conversation_id` is
// `REFERENCES public.chat_conversations(id) ON DELETE CASCADE` (migration
// 00227), so deleting the parent takes the transcript with it, atomically, in
// the database. A second delete against `chat_messages` would be a second
// chance to get the cutoff wrong and a window in which a conversation exists
// with its transcript already gone.
//
// `contacts` is untouched. `chat_conversations.contact_id` is ON DELETE SET
// NULL in the other direction, and a contact captured through the chat is a
// lead the business is entitled to keep — the transcript is what expires, not
// the person who asked.
//
// NOT a functions/ twin. Unlike `contact-timeline-retention.ts`, nothing under
// `functions/src/` calls this: `chatRetentionCron` is a delegator that POSTs
// `/api/admin/internal/chat-retention` and this module has exactly one caller.
// See that cron's comment for why that shape was chosen over a twin copy.

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Delete every conversation that started more than `days` ago, and with each
 * one its messages, by cascade.
 *
 * Returns the number of CONVERSATIONS removed, which is what the cron logs.
 * The message count is deliberately not reported: counting them would mean a
 * second query against rows that are about to stop existing, and the number
 * nobody acts on is not worth the round trip.
 */
export async function pruneChatConversations(supabase: SupabaseClient, days: number): Promise<number> {
  // `days` COMES FROM A HAND-EDITED system_settings ROW, so it is validated
  // rather than trusted. `getSetting<number>` returns raw jsonb: a `0` would
  // put the cutoff at now() and delete every conversation including the one
  // being had right now, and a `"90"` typed as a string makes the arithmetic
  // NaN, so `new Date(NaN).toISOString()` throws inside the cron.
  //
  // It refuses rather than clamping. A retention window nobody meant is a
  // destructive operation, and the honest response to "I cannot tell how long
  // you meant to keep this" is to delete nothing and say so — the cron records
  // the message and the operator fixes the row.
  if (typeof days !== "number" || !Number.isFinite(days) || days < 1) {
    throw new Error(
      `pruneChatConversations: chat_retention_days must be a number of at least 1, got ${JSON.stringify(days)}`,
    )
  }
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase.from("chat_conversations").delete({ count: "exact" }).lt("created_at", cutoff)
  // A REAL `Error`, not the raw PostgREST object the house DAL usually
  // rethrows. The caller is a cron route whose catch does
  // `err instanceof Error ? err.message : String(err)` before writing it to
  // `cron_runs.details` — and `String({})` is `"[object Object]"`. A nightly
  // job that fails is only useful if the row it leaves behind says why.
  if (error) throw new Error(`pruneChatConversations: ${error.message}`)
  return count ?? 0
}
