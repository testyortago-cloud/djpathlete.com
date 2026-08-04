import type { AttachmentKind, MessageSenderRole } from "@/types/database"

const PREVIEW_LENGTH = 120

/**
 * Unread = messages from the OTHER side, strictly newer than this side's
 * last_read_at.
 *
 * Derived, never stored: a counter column drifts the first time any path
 * forgets to decrement it.
 *
 * The comparison is strict (`>`) because marking-read stamps `now` — a message
 * sent at exactly that instant HAS been read. A `>=` here yields a phantom
 * unread badge that no amount of reading can clear.
 */
export function unreadCount(
  messages: { created_at: string; sender_role: MessageSenderRole }[],
  lastReadAt: string | null,
  viewerRole: MessageSenderRole,
): number {
  const readAt = lastReadAt ? Date.parse(lastReadAt) : Number.NEGATIVE_INFINITY
  return messages.filter((m) => m.sender_role !== viewerRole && Date.parse(m.created_at) > readAt).length
}

/** One-line summary for the conversation list. */
export function previewFor(
  body: string | null,
  attachmentCount: number,
  firstKind: AttachmentKind | null,
): string {
  const trimmed = body?.trim()
  if (trimmed) return trimmed.slice(0, PREVIEW_LENGTH)
  if (attachmentCount > 1) return `${attachmentCount} ${firstKind === "video" ? "videos" : "photos"}`
  if (attachmentCount === 1) return firstKind === "video" ? "Video" : "Photo"
  return ""
}
