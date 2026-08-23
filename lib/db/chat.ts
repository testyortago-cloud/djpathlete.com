// lib/db/chat.ts — the IO layer for the public chat assistant.
//
// THIS IS THE ONLY FILE THAT TALKS TO chat_conversations / chat_messages
// (migration 00227). Everything above it — the route, the tools, the
// validator — works in memory and hands finished values to these functions.
//
// Two things are deliberate here and are worth reading before changing:
//
//  1. `ip_hash` is the only origin identifier that ever reaches a row. The
//     hashing happens in the route; this file has no opinion about how, and
//     no function takes a raw address. A DAL that accepted one would make the
//     privacy property depend on every caller remembering.
//
//  2. `appendMessage` re-derives `message_count` from an exact COUNT of the
//     messages rather than incrementing the stored value. PostgREST cannot
//     express `message_count = message_count + 1`, so a read-then-write
//     increment loses updates under concurrent appends — and that counter is
//     what caps a conversation's length on an unauthenticated endpoint, so a
//     lost update is a rate limit that quietly stops holding. Counting is
//     self-healing: two racing appends both write the true number.
//     `tokens_used` still adds to the stored value, which can undercount by
//     one turn in a genuine race; that is accepted because the token cap is a
//     spend ceiling with slack in it, not a correctness boundary.
//
// Spec: docs/superpowers/specs/2026-08-23-lead-engine-stage3-chat-design.md §3

import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import type { ChatConversation, ChatMessage } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface CreateConversationInput {
  /** sha256(ip + salt). Never a raw address — see the file header. */
  ipHash: string
  userAgent?: string | null
  landingPath?: string | null
  attributionSessionId?: string | null
}

export async function createConversation(input: CreateConversationInput): Promise<ChatConversation> {
  const { data, error } = await getClient()
    .from("chat_conversations")
    .insert({
      business_id: SINGLETON_BUSINESS_ID,
      ip_hash: input.ipHash,
      user_agent: input.userAgent ?? null,
      landing_path: input.landingPath ?? null,
      attribution_session_id: input.attributionSessionId ?? null,
    })
    .select("*")
    .single()

  if (error) throw error
  return data as ChatConversation
}

/**
 * `null` means the row is not there. A failed READ throws, because "the
 * database was unreachable" and "no such conversation" are different answers
 * and a caller that conflates them turns an outage into a silent new session.
 */
export async function getConversation(id: string): Promise<ChatConversation | null> {
  const { data, error } = await getClient().from("chat_conversations").select("*").eq("id", id).maybeSingle()

  if (error) throw error
  return (data as ChatConversation | null) ?? null
}

/** Oldest first — this is the transcript, and it is also what the model is fed. */
export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await getClient()
    .from("chat_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })

  if (error) throw error
  return (data ?? []) as ChatMessage[]
}

export interface AppendMessageInput {
  conversationId: string
  role: "user" | "assistant"
  content: string
  factSet?: Record<string, unknown>
  cards?: unknown[]
  verdict?: "ok" | "blocked" | "short_circuit" | null
  violations?: unknown[]
  tokensInput?: number | null
  tokensOutput?: number | null
  model?: string | null
}

/**
 * Writes the turn and brings the parent conversation's counters with it.
 *
 * The message is inserted FIRST. If the counter update then fails, the
 * transcript is still complete and the counters are one turn stale — the
 * recoverable direction. Inserting second would risk a conversation that
 * claims a message it does not have.
 */
export async function appendMessage(input: AppendMessageInput): Promise<ChatMessage> {
  const supabase = getClient()

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      business_id: SINGLETON_BUSINESS_ID,
      conversation_id: input.conversationId,
      role: input.role,
      content: input.content,
      fact_set: input.factSet ?? {},
      cards: input.cards ?? [],
      verdict: input.verdict ?? null,
      violations: input.violations ?? [],
      tokens_input: input.tokensInput ?? null,
      tokens_output: input.tokensOutput ?? null,
      model: input.model ?? null,
    })
    .select("*")
    .single()

  if (error) throw error
  const message = data as ChatMessage

  // The true count, not a stored value plus one. See the file header.
  const { count, error: countError } = await supabase
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", input.conversationId)

  if (countError) throw countError

  const { data: parent, error: parentError } = await supabase
    .from("chat_conversations")
    .select("tokens_used")
    .eq("id", input.conversationId)
    .maybeSingle()

  if (parentError) throw parentError

  const spent = (input.tokensInput ?? 0) + (input.tokensOutput ?? 0)
  const tokensUsed = ((parent as { tokens_used: number } | null)?.tokens_used ?? 0) + spent

  const { error: bumpError } = await supabase
    .from("chat_conversations")
    .update({
      message_count: count ?? 0,
      tokens_used: tokensUsed,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", input.conversationId)

  if (bumpError) throw bumpError

  return message
}

/**
 * How many conversations this origin has started since `sinceIso`.
 *
 * `head: true` so only the count crosses the wire. A null count from
 * PostgREST is returned as 0 — but note that path is unreachable with
 * `count: "exact"`, and a genuine read failure throws above rather than
 * arriving here as a zero. "Nobody has asked yet" and "we could not tell"
 * must not be the same answer to a rate limiter.
 */
export async function countRecentConversationsByIp(ipHash: string, sinceIso: string): Promise<number> {
  const { count, error } = await getClient()
    .from("chat_conversations")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", sinceIso)

  if (error) throw error
  return count ?? 0
}

/**
 * How many messages this origin has sent since `sinceIso`, across every
 * conversation it has ever opened — including ones started before the window,
 * which is why the conversation lookup is not itself time-bounded.
 *
 * Two queries rather than one embedded `!inner` filter. The single-query form
 * reads well but its failure mode does not: if the embedded filter ever stops
 * restricting the top-level rows, the count silently becomes "every message
 * anyone sent this hour" and locks out every visitor at once. Two plain
 * queries have no such mode.
 */
export async function countRecentMessagesByIp(ipHash: string, sinceIso: string): Promise<number> {
  const supabase = getClient()

  const { data, error } = await supabase.from("chat_conversations").select("id").eq("ip_hash", ipHash)

  if (error) throw error

  const ids = (data ?? []).map((row) => (row as { id: string }).id)
  if (ids.length === 0) return 0

  const { count, error: countError } = await supabase
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .in("conversation_id", ids)
    .gte("created_at", sinceIso)

  if (countError) throw countError
  return count ?? 0
}

/**
 * Stamps the handover time. Idempotent by intent: the FIRST escalation is the
 * one that matters for a response-time measurement, so a conversation that
 * escalates twice keeps the earlier timestamp.
 */
export async function markEscalated(id: string): Promise<void> {
  const { error } = await getClient()
    .from("chat_conversations")
    .update({ escalated_at: new Date().toISOString(), last_activity_at: new Date().toISOString() })
    .eq("id", id)
    .is("escalated_at", null)

  if (error) throw error
}

/**
 * Links the conversation to the contact the capture route created.
 *
 * Called only by that route — nothing the model can reach writes a contact,
 * and this function does not create one either; it records a link that the
 * capture path has already made.
 */
export async function markCaptured(id: string, contactId: string): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await getClient()
    .from("chat_conversations")
    .update({ contact_id: contactId, captured_at: now, last_activity_at: now })
    .eq("id", id)

  if (error) throw error
}
