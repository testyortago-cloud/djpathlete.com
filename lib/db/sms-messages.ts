// lib/db/sms-messages.ts — every sms_messages query.
//
// The thread is keyed on PHONE, not contact: a text from a number nobody has
// on file still forms a conversation. Every read takes an explicit
// businessId and applies it as a predicate — a reader with no tenant
// predicate is a leak with a fuse in it.

import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

export type SmsDirection = "inbound" | "outbound"

export type SmsMessageRow = {
  id: string
  business_id: string
  contact_id: string | null
  phone: string
  direction: SmsDirection
  body: string
  twilio_sid: string | null
  status: string
  error_code: string | null
  sent_by: string | null
  sequence_message_id: string | null
  occurred_at: string
  created_at: string
}

export type SmsThreadSummary = {
  phone: string
  contactId: string | null
  contactName: string | null
  lastBody: string
  lastDirection: SmsDirection
  lastOccurredAt: string
  lastStatus: string
  inboundCount: number
  messageCount: number
}

export async function insertSmsMessage(input: {
  businessId: string
  contactId?: string | null
  phone: string
  direction: SmsDirection
  body: string
  twilioSid?: string | null
  status?: string
  errorCode?: string | null
  sentBy?: string | null
  sequenceMessageId?: string | null
}): Promise<{ id: string }> {
  const { data, error } = await getClient()
    .from("sms_messages")
    .insert({
      business_id: input.businessId,
      contact_id: input.contactId ?? null,
      phone: input.phone,
      direction: input.direction,
      body: input.body,
      twilio_sid: input.twilioSid ?? null,
      status: input.status ?? (input.direction === "inbound" ? "received" : "queued"),
      error_code: input.errorCode ?? null,
      sent_by: input.sentBy ?? null,
      sequence_message_id: input.sequenceMessageId ?? null,
    })
    .select("id")
    .single()
  // Throw, never return a success shape: a caller that records a send it
  // never made is the failure mode lib/email.ts already has.
  if (error) throw new Error(`insertSmsMessage failed (${error.code}): ${error.message}`)
  return { id: (data as { id: string }).id }
}

export async function getSmsThread(phone: string, businessId: string): Promise<SmsMessageRow[]> {
  const { data, error } = await getClient()
    .from("sms_messages")
    .select("*")
    .eq("business_id", businessId)
    .eq("phone", phone)
    .order("occurred_at", { ascending: true })
  if (error) throw new Error(`getSmsThread failed (${error.code}): ${error.message}`)
  return (data ?? []) as SmsMessageRow[]
}

export type SmsThreadListResult = {
  threads: SmsThreadSummary[]
  /**
   * True when the row fetch below actually hit `ROW_FETCH_CAP` — meaning
   * `messageCount`/`inboundCount` are counted only from the most recent
   * `ROW_FETCH_CAP` messages across the WHOLE tenant, not necessarily a
   * thread's full history. The UI uses this to say so rather than quietly
   * showing a partial count as if it were exact.
   */
  countsTruncated: boolean
}

/**
 * Walking every row for the tenant to compute exact per-thread counts does
 * not scale: at N texts it pulled all N rows over the wire to render <=
 * `limit` links, and if PostgREST's own `db-max-rows` were ever set below N,
 * the rows would arrive silently truncated and `messageCount`/`inboundCount`
 * would go wrong with no error at all.
 *
 * This bounds the fetch itself instead, generously: rows arrive newest
 * first, and every thread that could plausibly be one of the top `limit`
 * (default 500) most-recently-active threads contributes its latest message
 * near the front of that ordering — so the cap only has to comfortably cover
 * 500 distinct phones' latest activity, not the whole table. It does NOT
 * guarantee an exact lifetime count for a thread whose history sits mostly
 * further back than the cap; see `countsTruncated` above for the honest
 * signal when that happens.
 */
export const ROW_FETCH_CAP = 10000

export async function listSmsThreads(businessId: string, limit = 500): Promise<SmsThreadListResult> {
  const { data, error } = await getClient()
    .from("sms_messages")
    .select("phone, contact_id, body, direction, occurred_at, status, contacts(name)")
    .eq("business_id", businessId)
    .order("occurred_at", { ascending: false })
    .limit(ROW_FETCH_CAP)
  if (error) throw new Error(`listSmsThreads failed (${error.code}): ${error.message}`)

  type Row = {
    phone: string
    contact_id: string | null
    body: string
    direction: SmsDirection
    occurred_at: string
    status: string
    contacts: { name: string | null } | null
  }

  // Rows arrive newest-first, so the FIRST row seen for a phone is that
  // thread's latest message. Walk every row — a deduping helper would drop
  // one of two rows sharing a phone and the counts would be wrong.
  const byPhone = new Map<string, SmsThreadSummary>()
  for (const row of (data ?? []) as unknown as Row[]) {
    const existing = byPhone.get(row.phone)
    if (!existing) {
      byPhone.set(row.phone, {
        phone: row.phone,
        contactId: row.contact_id,
        contactName: row.contacts?.name ?? null,
        lastBody: row.body,
        lastDirection: row.direction,
        lastOccurredAt: row.occurred_at,
        lastStatus: row.status,
        inboundCount: row.direction === "inbound" ? 1 : 0,
        messageCount: 1,
      })
      continue
    }
    existing.messageCount += 1
    if (row.direction === "inbound") existing.inboundCount += 1
    // A later row may carry the contact link the newest one lacks.
    if (!existing.contactId && row.contact_id) {
      existing.contactId = row.contact_id
      existing.contactName = row.contacts?.name ?? null
    }
  }

  return {
    threads: [...byPhone.values()].slice(0, limit),
    countsTruncated: (data ?? []).length >= ROW_FETCH_CAP,
  }
}

/**
 * Applies one Twilio status callback to the `sms_messages` row carrying that
 * sid. Mirrors `applyDeliveryStatus`'s outcome space (never throws on an
 * unknown sid) so the webhook can report both without branching on an error.
 *
 * MONOTONIC, following `applyDeliveryStatus` (lib/db/sequences.ts) — same
 * invariant, same reasoning, deliberately NOT a second differently-shaped
 * rule: once a row is `delivered`, no later callback of any kind changes
 * it. Twilio callbacks can arrive out of order, and a `failed`/`undelivered`
 * (or even a duplicate `delivered`) callback landing after a `delivered` one
 * is a stale, superseded report, not new information — writing it would
 * regress a delivered message back to looking failed in the conversation
 * view, which is the one thing this view exists to get right. A `delivered`
 * callback DOES overwrite anything else (`sent`, `failed`, `undelivered`,
 * `queued`, ...) — a late delivery beats an earlier pessimistic report,
 * exactly the "arrived out of order" case this guard exists for.
 *
 * UNLIKE `applyDeliveryStatus`, the status string itself is never mapped
 * into a fixed set here (see the route's doc comment: the conversation
 * shows the carrier's own word, the sequence engine's four-value space is a
 * separate concern) — only the delivered-is-terminal invariant is shared.
 *
 * A stale, ignored callback must not smuggle its `error_code` onto the row
 * either — the whole point is that a superseded report carries no new
 * information, and that includes the code explaining why it (supposedly)
 * failed.
 *
 * Returns `"ignored"` (not `"updated"`, which would be a lie) both when the
 * row was already `delivered` on read, and in the rare read-then-write race
 * where a concurrent callback delivers it between this function's read and
 * its write — the in-database `.neq("status", "delivered")` guard blocks
 * that write the same way `applyDeliveryStatus`'s does, and a blocked write
 * is exactly as "nothing changed" as the preflight check above it.
 */
export async function updateSmsStatusBySid(
  twilioSid: string,
  status: string,
  errorCode: string | null = null,
): Promise<"updated" | "unknown_message" | "ignored"> {
  if (!twilioSid) return "unknown_message"
  const client = getClient()

  const { data: existing, error: readErr } = await client
    .from("sms_messages")
    .select("id, status")
    .eq("twilio_sid", twilioSid)
    .maybeSingle()
  if (readErr) throw new Error(`updateSmsStatusBySid failed (${readErr.code}): ${readErr.message}`)
  if (!existing) return "unknown_message"

  const row = existing as { id: string; status: string }
  if (row.status === "delivered") return "ignored"

  const patch: Record<string, unknown> = { status }
  if (errorCode) patch.error_code = errorCode

  const { data, error } = await client
    .from("sms_messages")
    .update(patch)
    .eq("id", row.id)
    // In-database guard against the read-then-write race, identical in
    // spirit to `applyDeliveryStatus`'s: even a stale in-memory read that
    // thinks the row is not yet `delivered` cannot un-deliver a row the
    // database already knows is `delivered`, because this filter is
    // evaluated against the row's CURRENT state at UPDATE time, not against
    // the read above.
    .neq("status", "delivered")
    .select("id")
  if (error) throw new Error(`updateSmsStatusBySid failed (${error.code}): ${error.message}`)
  return (data ?? []).length > 0 ? "updated" : "ignored"
}

/**
 * `twilioSid` is nullable on the `sent` arm because
 * `sendRenderedSequenceSms` types its `providerMessageId` as
 * `string | null`: Twilio answering 2xx without a sid is pathological, but
 * the row must still stop saying `queued` when it happens, and `twilio_sid`
 * is a nullable column. An empty string would be a worse answer than null —
 * this repo already has one column whose `''` default matches everything.
 */
export type SmsOutcome = { kind: "sent"; twilioSid: string | null } | { kind: "failed"; errorCode: string | null }

/**
 * Stamps the result of one send onto the row that was already written for it.
 *
 * `sendManualSms` inserts a `queued` row BEFORE the Twilio POST and calls
 * this afterwards, which is the only way the row can exist while the status
 * callback for it is in flight. BE PRECISE ABOUT WHAT THAT BUYS: it does NOT
 * close the race. The Twilio sid is not known until the POST RETURNS, and
 * `updateSmsStatusBySid` finds the row by `twilio_sid`, so a status callback
 * that arrives before this function writes the sid still resolves to
 * `unknown_message`. What changes is the size of the window -- from "the
 * whole Twilio POST latency plus an INSERT" down to "the response landing,
 * then one UPDATE". Narrower, not gone.
 *
 * MONOTONIC, the same rule and for the same reason as `updateSmsStatusBySid`
 * above and `applyDeliveryStatus` (lib/db/sequences.ts): a row the database
 * already knows is `delivered` is never written back down. That is not
 * theoretical here -- it is precisely the ordering this function's window
 * leaves open. If the sid write and a fast `delivered` callback interleave
 * badly, an unconditional update would regress a delivered text to `sent`
 * in the conversation view, which is the one thing that view exists to get
 * right. The guard is a `.neq("status", "delivered")` evaluated against the
 * row's CURRENT state at UPDATE time, so no stale in-memory read is involved.
 *
 * Throws on a write error rather than resolving quietly. The caller
 * deliberately logs and carries on (losing this row must not report a text
 * that really went out as failed), but it can only make that choice if it is
 * told the write failed.
 */
export async function markSmsMessageOutcome(id: string, outcome: SmsOutcome): Promise<void> {
  const patch: Record<string, unknown> =
    outcome.kind === "sent"
      ? { status: "sent", twilio_sid: outcome.twilioSid }
      : // `error_code` is written even when null: a failure with no carrier
        // code is still a failure, and the row must stop saying `queued`.
        { status: "failed", error_code: outcome.errorCode }

  const { error } = await getClient().from("sms_messages").update(patch).eq("id", id).neq("status", "delivered")
  if (error) throw new Error(`markSmsMessageOutcome failed (${error.code}): ${error.message}`)
}

/**
 * Whether we have sent this phone an outbound text within the last
 * `withinDays` days, scoped to the tenant. Used to decide whether a legal
 * opt-out sentence still needs to be appended to a new outbound message.
 *
 * Throws on a query error rather than returning false: "the read broke" and
 * "we have not texted them" must not look the same to a caller, because a
 * false answer here silently appends (or omits) the opt-out sentence based
 * on a read that never actually happened.
 */
export async function recentOutboundExists(phone: string, businessId: string, withinDays = 30): Promise<boolean> {
  const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await getClient()
    .from("sms_messages")
    .select("id")
    .eq("business_id", businessId)
    .eq("phone", phone)
    .eq("direction", "outbound")
    .gte("occurred_at", since)
    .limit(1)
  if (error) throw new Error(`recentOutboundExists failed (${error.code}): ${error.message}`)
  return (data ?? []).length > 0
}
