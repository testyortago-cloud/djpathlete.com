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
import { MAX_MESSAGES_PER_CONVERSATION } from "@/lib/lead-engine/chat/constants"
import type { ChatConversation, ChatMessage } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface CreateConversationInput {
  /**
   * The tenant this conversation belongs to. REQUIRED, not defaulted: this is
   * the one place the tenant genuinely ENTERS the chat feature (see the file
   * header) -- every later turn reads it back off the conversation row rather
   * than deciding it again, so a default here would be a default for the
   * whole feature. The public route has no session and no Host resolution yet
   * (phase 4), so it passes `platformBusinessId()` (lib/tenancy/platform.ts)
   * rather than deciding a tenant it cannot actually resolve.
   */
  businessId: string
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
      business_id: input.businessId,
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
  /**
   * The tenant this message belongs to. REQUIRED: the conversation row is the
   * tenant carrier once it exists (see the file header and
   * `CreateConversationInput.businessId`), so every caller that already has
   * the conversation passes `conversation.business_id` straight through
   * rather than re-deciding a tenant here.
   */
  businessId: string
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
      business_id: input.businessId,
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

// ---------------------------------------------------------------------------
// THE ADMIN LIST — /admin/chat
// ---------------------------------------------------------------------------
//
// Reading the conversations as a LIST, which is a different question from the
// ones above: those serve one live turn on a public endpoint, these serve an
// operator scanning what the assistant has been saying.
//
// TWO THINGS ARE DELIBERATE HERE.
//
//  1. THE LIST SELECTS NAMED COLUMNS, NOT `*`, and `ip_hash`, `user_agent` and
//     `attribution_session_id` are not among them. A list surface is the wrong
//     place to widen the amount of visitor data being pulled out of the table
//     by default — the same rule `lib/db/contacts-list.ts` states for the
//     contact spine. The hash is a join key for the rate limiter, not
//     something an operator reads.
//
//  2. "BLOCKED" IS A PROPERTY OF THE MESSAGES, NOT OF THE CONVERSATION, so it
//     costs a second query. It is deliberately NOT an embedded `!inner` filter
//     for the reason `countRecentMessagesByIp` above spells out: if the
//     embedded filter ever stops restricting the parent rows, the failure is
//     silent and wrong rather than loud.

/** What the toolbar can narrow the list to. Spec §6.3. */
export type ChatListFilter = "all" | "escalated" | "captured" | "blocked"

/**
 * One row of the admin list.
 *
 * `blocked_count` is derived rather than stored: the honesty control's own
 * record lives on the messages, and a denormalised counter on the parent would
 * be a second source of truth for the one number this feature is judged on.
 */
export interface ChatConversationListRow {
  id: string
  created_at: string
  last_activity_at: string
  message_count: number
  tokens_used: number
  landing_path: string | null
  escalated_at: string | null
  captured_at: string | null
  contact_id: string | null
  blocked_count: number
}

export interface ChatListFilters {
  show: ChatListFilter
  /** 1-based, already validated. */
  page: number
}

const LIST_SELECT_COLUMNS =
  "id, created_at, last_activity_at, message_count, tokens_used, landing_path, escalated_at, captured_at, contact_id"

const SHOW_VALUES = new Set<string>(["all", "escalated", "captured", "blocked"])

/** 999 pages of 25 is 24,975 conversations — far past anything this holds. */
const MAX_PAGE = 999

/**
 * Turns raw URL strings into filters, discarding anything that is not one of
 * the shapes this page defined.
 *
 * Lives in the DAL rather than in the page so the rejection is unit-testable
 * without rendering a server component, and so there is exactly one answer to
 * "what does `?show=junk` do" — the same arrangement `parseContactFilters`
 * uses. A junk filter narrows to nothing there; here it falls back to `all`,
 * because "show me everything" is the obviously right answer to an unreadable
 * filter and an empty list would read as "the assistant has never run".
 */
export function parseChatFilters(raw: { show?: string; page?: string }): ChatListFilters {
  const requested = raw.show ?? ""
  const show = (SHOW_VALUES.has(requested) ? requested : "all") as ChatListFilter

  let page = 1
  const rawPage = raw.page ?? ""
  if (/^\d{1,3}$/.test(rawPage)) {
    const requestedPage = Number(rawPage)
    if (requestedPage >= 1 && requestedPage <= MAX_PAGE) page = requestedPage
  }

  return { show, page }
}

/**
 * The four chainable methods this list needs from a PostgREST query builder,
 * declared structurally rather than imported — the repo drops the `Database`
 * generic (see `lib/supabase.ts`), so the real builder type is wide enough
 * that threading it through a generic helper costs more casts than it prevents.
 */
interface ChatFilterable {
  eq(column: string, value: unknown): ChatFilterable
  not(column: string, operator: string, value: unknown): ChatFilterable
  in(column: string, values: unknown[]): ChatFilterable
}

/**
 * ONE place, used by the list read AND by the count — so a filter that narrows
 * the table cannot narrow the count differently, which is how a page ends up
 * reporting "12 conversations" above a list of 3.
 *
 * `blockedIds` is passed in rather than fetched here because fetching it is
 * async and this has to stay usable from both callers without either of them
 * forgetting to apply it.
 */
function applyChatFilter<T>(query: T, businessId: string, show: ChatListFilter, blockedIds: string[]): T {
  let q = query as ChatFilterable
  q = q.eq("business_id", businessId)
  if (show === "escalated") q = q.not("escalated_at", "is", null)
  if (show === "captured") q = q.not("captured_at", "is", null)
  if (show === "blocked") q = q.in("id", blockedIds)
  return q as T
}

/** PostgREST silently caps a `.select()` at ~1000 rows. Never assume otherwise. */
const POSTGREST_ROW_CAP = 1000

/**
 * How many pages of blocked-message ids we are willing to walk before giving
 * up. 20 × 1000 is 20,000 blocked replies inside the retention window — a
 * number that would itself be the emergency, not this query.
 */
const MAX_BLOCKED_ID_PAGES = 20

/**
 * Every conversation that has at least one blocked reply in it.
 *
 * Walked in pages rather than read in one shot, and it THROWS rather than
 * returning a short list if it runs past the ceiling. A truncated list here
 * would be worse than an error: the page would render as "these are the
 * conversations where the assistant was stopped", quietly missing some — and
 * the whole point of the blocked filter is that it is complete.
 */
async function blockedConversationIds(
  supabase: ReturnType<typeof createServiceRoleClient>,
  businessId: string,
): Promise<string[]> {
  const ids = new Set<string>()

  for (let page = 0; page < MAX_BLOCKED_ID_PAGES; page++) {
    const from = page * POSTGREST_ROW_CAP
    const { data, error } = await supabase
      .from("chat_messages")
      .select("conversation_id")
      .eq("business_id", businessId)
      .eq("verdict", "blocked")
      .order("created_at", { ascending: false })
      .range(from, from + POSTGREST_ROW_CAP - 1)

    if (error) throw new Error(`blockedConversationIds: ${error.message}`)

    const rows = (data ?? []) as Array<{ conversation_id: string }>
    for (const row of rows) ids.add(row.conversation_id)
    if (rows.length < POSTGREST_ROW_CAP) return [...ids]
  }

  throw new Error(
    `blockedConversationIds: more than ${MAX_BLOCKED_ID_PAGES * POSTGREST_ROW_CAP} blocked replies are on file. ` +
      "Refusing to answer with a truncated list — a partial 'these are the blocked conversations' is worse than an error.",
  )
}

/**
 * How many conversation ids to ask about in one blocked-count query.
 *
 * A conversation cannot hold more than `MAX_MESSAGES_PER_CONVERSATION`
 * messages, so 25 ids can match at most 500 rows — comfortably inside
 * PostgREST's 1000-row ceiling however big the caller's page size is. That
 * arithmetic is the reason this cannot silently under-count.
 */
const BLOCKED_COUNT_CHUNK = Math.max(1, Math.floor(POSTGREST_ROW_CAP / MAX_MESSAGES_PER_CONVERSATION / 2))

/** Blocked replies per conversation, for the rows actually on screen. */
async function blockedCountsFor(
  supabase: ReturnType<typeof createServiceRoleClient>,
  businessId: string,
  ids: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (ids.length === 0) return counts

  for (let start = 0; start < ids.length; start += BLOCKED_COUNT_CHUNK) {
    const chunk = ids.slice(start, start + BLOCKED_COUNT_CHUNK)
    const { data, error } = await supabase
      .from("chat_messages")
      .select("conversation_id")
      .eq("business_id", businessId)
      .eq("verdict", "blocked")
      .in("conversation_id", chunk)

    if (error) throw new Error(`blockedCountsFor: ${error.message}`)

    for (const row of (data ?? []) as Array<{ conversation_id: string }>) {
      counts.set(row.conversation_id, (counts.get(row.conversation_id) ?? 0) + 1)
    }
  }

  return counts
}

export interface ListChatConversationsInput {
  /**
   * REQUIRED, not defaulted -- this is an admin read. The caller resolves it
   * from `resolveAdminTenant()` (a server component) or
   * `resolveAdminTenantForRequest(req)` (a route handler); it is never
   * `platformBusinessId()` here, which would freeze this list at the
   * singleton for every coach that ever gets onboarded.
   */
  businessId: string
  show?: ChatListFilter
  limit?: number
  offset?: number
}

/**
 * One page of conversations, most recently active first.
 *
 * Throws rather than returning `[]`. "The read failed" and "nobody has used
 * the assistant" are different answers, and the admin page deliberately does
 * not catch this — see app/(admin)/admin/chat/page.tsx.
 */
export async function listChatConversations(input: ListChatConversationsInput): Promise<ChatConversationListRow[]> {
  const supabase = getClient()
  const { businessId } = input
  const show = input.show ?? "all"
  const limit = Math.min(input.limit ?? 25, POSTGREST_ROW_CAP)
  const offset = input.offset ?? 0

  const blockedIds = show === "blocked" ? await blockedConversationIds(supabase, businessId) : []
  if (show === "blocked" && blockedIds.length === 0) return []

  const base = supabase.from("chat_conversations").select(LIST_SELECT_COLUMNS)
  const filtered = applyChatFilter(base, businessId, show, blockedIds)
  const { data, error } = await (filtered as typeof base)
    .order("last_activity_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw new Error(`listChatConversations: ${error.message}`)

  const rows = (data ?? []) as Array<Omit<ChatConversationListRow, "blocked_count">>
  const counts = await blockedCountsFor(
    supabase,
    businessId,
    rows.map((row) => row.id),
  )

  return rows.map((row) => ({ ...row, blocked_count: counts.get(row.id) ?? 0 }))
}

/** How many conversations match, for the footer count and the pager. Same businessId contract as `listChatConversations`. */
export async function countChatConversations(input: { businessId: string; show?: ChatListFilter }): Promise<number> {
  const supabase = getClient()
  const { businessId } = input
  const show = input.show ?? "all"

  const blockedIds = show === "blocked" ? await blockedConversationIds(supabase, businessId) : []
  if (show === "blocked" && blockedIds.length === 0) return 0

  const base = supabase.from("chat_conversations").select("id", { count: "exact", head: true })
  const filtered = applyChatFilter(base, businessId, show, blockedIds)
  const { count, error } = await (filtered as typeof base)

  if (error) throw new Error(`countChatConversations: ${error.message}`)
  return count ?? 0
}
