import type { Conversation, Message, MessageSenderRole } from "@/types/database"

export interface NotifyInput {
  messages: Message[]
  conversations: Conversation[]
  now: number
  delayMs: number
}

export interface NotifyGroup {
  conversation_id: string
  recipient_role: MessageSenderRole
  /** The client's user id, or null for the shared admin inbox. */
  recipient_user_id: string | null
  message_ids: string[]
  previews: string[]
}

interface Split {
  /** Still unread past the delay — email these. */
  due: Message[]
  /** Read in the meantime — stamp, never email. */
  read: Message[]
}

/**
 * Partition un-notified messages whose delay has elapsed.
 *
 * Messages younger than the delay are left entirely alone so the next run
 * reconsiders them — that is what makes a rapid back-and-forth in the widget
 * produce zero emails.
 */
function split(input: NotifyInput): Split {
  const byId = new Map(input.conversations.map((c) => [c.id, c]))
  const due: Message[] = []
  const read: Message[] = []

  for (const message of input.messages) {
    if (message.email_notified_at) continue

    const sentAt = Date.parse(message.created_at)
    if (input.now - sentAt < input.delayMs) continue

    const conversation = byId.get(message.conversation_id)
    if (!conversation) continue

    const recipientReadAt =
      message.sender_role === "admin" ? conversation.client_last_read_at : conversation.admin_last_read_at

    if (recipientReadAt && Date.parse(recipientReadAt) >= sentAt) read.push(message)
    else due.push(message)
  }

  return { due, read }
}

/**
 * Messages to stamp `email_notified_at` on WITHOUT emailing — the recipient
 * read them before the delay elapsed. Stamping matters: an unstamped read
 * message is reconsidered on every run, forever.
 */
export function alreadyReadIds(input: NotifyInput): string[] {
  return split(input).read.map((m) => m.id)
}

/** One group per (conversation, recipient), so a burst becomes one email. */
export function messagesNeedingEmail(input: NotifyInput): NotifyGroup[] {
  const byId = new Map(input.conversations.map((c) => [c.id, c]))
  const groups = new Map<string, NotifyGroup>()

  const due = [...split(input).due].sort((a, b) => a.created_at.localeCompare(b.created_at))

  for (const message of due) {
    const conversation = byId.get(message.conversation_id)
    if (!conversation) continue

    const recipientRole: MessageSenderRole = message.sender_role === "admin" ? "client" : "admin"
    const key = `${message.conversation_id}:${recipientRole}`

    let group = groups.get(key)
    if (!group) {
      group = {
        conversation_id: message.conversation_id,
        recipient_role: recipientRole,
        recipient_user_id: recipientRole === "client" ? conversation.client_user_id : null,
        message_ids: [],
        previews: [],
      }
      groups.set(key, group)
    }

    group.message_ids.push(message.id)
    group.previews.push(message.body?.trim() || (message.attachment_count > 0 ? "Sent an attachment" : ""))
  }

  return [...groups.values()]
}
