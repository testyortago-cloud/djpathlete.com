import { getConversationById } from "@/lib/db/conversations"
import type { Conversation, MessageSenderRole } from "@/types/database"

export interface Participant {
  role: MessageSenderRole
  userId: string
  conversation: Conversation
}

export interface SessionLike {
  user?: { id?: string | null; role?: string | null } | null
}

/**
 * The SINGLE authorization decision for every conversation-scoped route.
 *
 * Admin → "admin" (the shared coach inbox sees every conversation).
 * The owning client → "client".
 * Anyone else → null, which every caller turns into a 403.
 *
 * Routes call this and never re-derive the rule: a second copy of the predicate
 * is a second place for it to be wrong.
 */
export async function resolveParticipant(
  session: SessionLike | null,
  conversationId: string,
): Promise<Participant | null> {
  const userId = session?.user?.id
  if (!userId) return null

  const conversation = await getConversationById(conversationId)
  if (!conversation) return null

  if (session?.user?.role === "admin") {
    return { role: "admin", userId, conversation }
  }
  if (conversation.client_user_id === userId) {
    return { role: "client", userId, conversation }
  }
  return null
}

/** The viewer's side of any conversation, without loading one. */
export function sideForSession(session: SessionLike | null): MessageSenderRole | null {
  if (!session?.user?.id) return null
  return session.user.role === "admin" ? "admin" : "client"
}
