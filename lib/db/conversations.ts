import { createServiceRoleClient } from "@/lib/supabase"
import { unreadCount } from "@/lib/messaging/unread"
import type { Conversation, ConversationWithClient, MessageSenderRole } from "@/types/database"

/** Service-role client bypasses RLS — every caller is a server route. */
function getClient() {
  return createServiceRoleClient()
}

const CLIENT_COLUMNS = "id, first_name, last_name, email, avatar_url"

export async function getConversationById(id: string): Promise<Conversation | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("conversations").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as Conversation) ?? null
}

export async function getConversationForClient(clientUserId: string): Promise<Conversation | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("client_user_id", clientUserId)
    .maybeSingle()
  if (error) throw error
  return (data as Conversation) ?? null
}

/**
 * One conversation per client, so this is a get-or-create rather than a create.
 * The insert races harmlessly: `client_user_id` is UNIQUE, so a concurrent
 * second caller hits the conflict and re-reads the winner's row.
 */
export async function getOrCreateConversation(clientUserId: string): Promise<Conversation> {
  const existing = await getConversationForClient(clientUserId)
  if (existing) return existing

  const supabase = getClient()
  const { data, error } = await supabase
    .from("conversations")
    .insert({ client_user_id: clientUserId })
    .select()
    .single()

  if (error) {
    // 23505 = unique violation: someone else created it between our read and
    // our insert. Their row is the right answer.
    if ((error as { code?: string }).code === "23505") {
      const raced = await getConversationForClient(clientUserId)
      if (raced) return raced
    }
    throw error
  }
  return data as Conversation
}

/**
 * Every conversation with its client and the viewer's unread count.
 *
 * `unread_count` is DERIVED here rather than read from a column — see
 * lib/messaging/unread.ts for why a stored counter is a bug waiting to happen.
 */
export async function listConversationsWithClients(
  viewerRole: MessageSenderRole,
  clientUserId?: string,
): Promise<ConversationWithClient[]> {
  const supabase = getClient()

  let query = supabase
    .from("conversations")
    .select(`*, client:users!conversations_client_user_id_fkey(${CLIENT_COLUMNS})`)
    .order("last_message_at", { ascending: false, nullsFirst: false })

  if (viewerRole === "client") {
    if (!clientUserId) return []
    query = query.eq("client_user_id", clientUserId)
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as unknown as ConversationWithClient[]
  if (rows.length === 0) return []

  // One round trip for the timestamps every unread count needs, rather than one
  // per conversation.
  const { data: stamps, error: stampsError } = await supabase
    .from("messages")
    .select("conversation_id, sender_role, created_at")
    .in(
      "conversation_id",
      rows.map((r) => r.id),
    )
  if (stampsError) throw stampsError

  const byConversation = new Map<string, { created_at: string; sender_role: MessageSenderRole }[]>()
  for (const row of (stamps ?? []) as { conversation_id: string; sender_role: MessageSenderRole; created_at: string }[]) {
    const list = byConversation.get(row.conversation_id) ?? []
    list.push({ created_at: row.created_at, sender_role: row.sender_role })
    byConversation.set(row.conversation_id, list)
  }

  return rows.map((row) => ({
    ...row,
    unread_count: unreadCount(
      byConversation.get(row.id) ?? [],
      viewerRole === "admin" ? row.admin_last_read_at : row.client_last_read_at,
      viewerRole,
    ),
  }))
}

/** Plain conversation rows for the notifier cron — no joins, no unread math. */
export async function listConversationsForNotify(ids: string[]): Promise<Conversation[]> {
  if (ids.length === 0) return []
  const supabase = getClient()
  const { data, error } = await supabase.from("conversations").select("*").in("id", ids)
  if (error) throw error
  return (data ?? []) as Conversation[]
}

/** Stamps ONLY the caller's side. The other side's timestamp is never touched. */
export async function markRead(
  conversationId: string,
  side: MessageSenderRole,
  at: string = new Date().toISOString(),
): Promise<string> {
  const supabase = getClient()
  const column = side === "admin" ? "admin_last_read_at" : "client_last_read_at"
  const { error } = await supabase
    .from("conversations")
    .update({ [column]: at })
    .eq("id", conversationId)
  if (error) throw error
  return at
}
