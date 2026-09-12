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

export async function listSmsThreads(
  businessId: string,
  limit = 500,
): Promise<SmsThreadSummary[]> {
  const { data, error } = await getClient()
    .from("sms_messages")
    .select("phone, contact_id, body, direction, occurred_at, status, contacts(name)")
    .eq("business_id", businessId)
    .order("occurred_at", { ascending: false })
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

  return [...byPhone.values()].slice(0, limit)
}

/**
 * Applies one Twilio status callback to the `sms_messages` row carrying that
 * sid. Mirrors `applyDeliveryStatus`'s outcome space (never throws on an
 * unknown sid) so the webhook can report both without branching on an error.
 */
export async function updateSmsStatusBySid(
  twilioSid: string,
  status: string,
  errorCode: string | null = null,
): Promise<"updated" | "unknown_message"> {
  if (!twilioSid) return "unknown_message"
  const patch: Record<string, unknown> = { status }
  if (errorCode) patch.error_code = errorCode
  const { data, error } = await getClient()
    .from("sms_messages")
    .update(patch)
    .eq("twilio_sid", twilioSid)
    .select("id")
  if (error) throw new Error(`updateSmsStatusBySid failed (${error.code}): ${error.message}`)
  return (data ?? []).length > 0 ? "updated" : "unknown_message"
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
export async function recentOutboundExists(
  phone: string,
  businessId: string,
  withinDays = 30,
): Promise<boolean> {
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
