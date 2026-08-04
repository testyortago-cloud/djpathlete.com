import { createServiceRoleClient } from "@/lib/supabase"
import type {
  AttachmentKind,
  Message,
  MessageAttachment,
  MessageReaction,
  MessageSenderRole,
  MessageWithExtras,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

/** How many messages a thread loads at once. */
export const THREAD_PAGE_SIZE = 50

export interface AttachmentInsert {
  kind: AttachmentKind
  storage_path: string
  mime_type: string
  byte_size: number
  width?: number | null
  height?: number | null
  duration_seconds?: number | null
  original_filename?: string | null
}

export interface CreateMessageInput {
  conversation_id: string
  sender_user_id: string
  sender_role: MessageSenderRole
  body: string | null
  preview: string
  attachments: AttachmentInsert[]
}

/** Join a page of messages with their attachments and reactions. */
async function hydrate(messages: Message[]): Promise<MessageWithExtras[]> {
  if (messages.length === 0) return []
  const supabase = getClient()
  const ids = messages.map((m) => m.id)

  const [attachments, reactions] = await Promise.all([
    supabase.from("message_attachments").select("*").in("message_id", ids),
    supabase.from("message_reactions").select("*").in("message_id", ids),
  ])
  if (attachments.error) throw attachments.error
  if (reactions.error) throw reactions.error

  const attachmentsBy = new Map<string, MessageAttachment[]>()
  for (const row of (attachments.data ?? []) as MessageAttachment[]) {
    const list = attachmentsBy.get(row.message_id) ?? []
    list.push(row)
    attachmentsBy.set(row.message_id, list)
  }

  const reactionsBy = new Map<string, MessageReaction[]>()
  for (const row of (reactions.data ?? []) as MessageReaction[]) {
    const list = reactionsBy.get(row.message_id) ?? []
    list.push(row)
    reactionsBy.set(row.message_id, list)
  }

  return messages.map((m) => ({
    ...m,
    attachments: attachmentsBy.get(m.id) ?? [],
    reactions: reactionsBy.get(m.id) ?? [],
  }))
}

export async function listMessages(
  conversationId: string,
  limit: number = THREAD_PAGE_SIZE,
  before?: string,
): Promise<MessageWithExtras[]> {
  const supabase = getClient()
  let query = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (before) query = query.lt("created_at", before)

  const { data, error } = await query
  if (error) throw error

  // Fetched newest-first for the limit; the thread renders oldest-first.
  const messages = ((data ?? []) as Message[]).reverse()
  return hydrate(messages)
}

export async function getMessageWithExtras(messageId: string): Promise<MessageWithExtras | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("messages").select("*").eq("id", messageId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const [hydrated] = await hydrate([data as Message])
  return hydrated ?? null
}

/**
 * Insert through the create_message RPC — never a bare insert.
 *
 * The RPC writes the message, its attachments, and the conversation's
 * denormalized last_message_* fields in ONE transaction, which is the only
 * reason the conversation list can be trusted to match the thread.
 */
export async function createMessage(input: CreateMessageInput): Promise<{ message_id: string; created_at: string }> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("create_message", {
    p_conversation_id: input.conversation_id,
    p_sender_user_id: input.sender_user_id,
    p_sender_role: input.sender_role,
    p_body: input.body,
    p_preview: input.preview,
    p_attachments: input.attachments,
  })
  if (error) throw error

  const row = (Array.isArray(data) ? data[0] : data) as { message_id: string; created_at: string } | undefined
  if (!row?.message_id) throw new Error("create_message returned no row")
  return row
}

/** The attachment plus the conversation it belongs to, for authorization. */
export async function getAttachmentWithConversation(
  attachmentId: string,
): Promise<(MessageAttachment & { conversation_id: string }) | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("message_attachments")
    .select("*, message:messages!message_attachments_message_id_fkey(conversation_id)")
    .eq("id", attachmentId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as unknown as MessageAttachment & { message: { conversation_id: string } | null }
  if (!row.message) return null
  const { message, ...attachment } = row
  return { ...attachment, conversation_id: message.conversation_id }
}

export async function getMessageConversationId(messageId: string): Promise<string | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("messages")
    .select("conversation_id")
    .eq("id", messageId)
    .maybeSingle()
  if (error) throw error
  return (data as { conversation_id: string } | null)?.conversation_id ?? null
}

export async function countReactionsByUser(messageId: string, userId: string): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("message_reactions")
    .select("*", { count: "exact", head: true })
    .eq("message_id", messageId)
    .eq("user_id", userId)
  if (error) throw error
  return count ?? 0
}

/**
 * Toggle: the same emoji from the same user removes it, anything else adds.
 * Returns which happened so the optimistic UI can reconcile.
 */
export async function toggleReaction(
  messageId: string,
  userId: string,
  emoji: string,
): Promise<{ added: boolean; reaction: MessageReaction | null }> {
  const supabase = getClient()

  const { data: existing, error: findError } = await supabase
    .from("message_reactions")
    .select("id")
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .eq("emoji", emoji)
    .maybeSingle()
  if (findError) throw findError

  if (existing) {
    const { error } = await supabase.from("message_reactions").delete().eq("id", (existing as { id: string }).id)
    if (error) throw error
    return { added: false, reaction: null }
  }

  const { data, error } = await supabase
    .from("message_reactions")
    .insert({ message_id: messageId, user_id: userId, emoji })
    .select()
    .single()
  if (error) throw error
  return { added: true, reaction: data as MessageReaction }
}

/** Un-notified messages old enough to be worth considering, for the cron. */
export async function listUnnotifiedMessages(olderThan: string): Promise<Message[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .is("email_notified_at", null)
    .lt("created_at", olderThan)
    .order("created_at", { ascending: true })
    .limit(500)
  if (error) throw error
  return (data ?? []) as Message[]
}

export async function stampNotified(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return
  const supabase = getClient()
  const { error } = await supabase
    .from("messages")
    .update({ email_notified_at: new Date().toISOString() })
    .in("id", messageIds)
  if (error) throw error
}
