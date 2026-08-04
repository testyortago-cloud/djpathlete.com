"use client"

import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { MessageAttachmentView } from "./MessageAttachment"
import { EmojiPickerPopover } from "./EmojiPickerPopover"
import type { MessageWithExtras } from "@/types/database"

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

interface GroupedReaction {
  emoji: string
  count: number
  mine: boolean
}

/** Collapse per-user rows into one chip per emoji. */
function groupReactions(message: MessageWithExtras, viewerId: string): GroupedReaction[] {
  const byEmoji = new Map<string, GroupedReaction>()
  for (const reaction of message.reactions) {
    const existing = byEmoji.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, mine: false }
    existing.count += 1
    if (reaction.user_id === viewerId) existing.mine = true
    byEmoji.set(reaction.emoji, existing)
  }
  return [...byEmoji.values()]
}

export function MessageBubble({
  message,
  viewerId,
  mine,
  onToggleReaction,
}: {
  message: MessageWithExtras
  viewerId: string
  mine: boolean
  onToggleReaction: (messageId: string, emoji: string) => void
}) {
  const reactions = useMemo(() => groupReactions(message, viewerId), [message, viewerId])

  return (
    <div className={cn("group flex flex-col gap-1", mine ? "items-end" : "items-start")}>
      <div className={cn("flex max-w-[85%] items-end gap-1", mine && "flex-row-reverse")}>
        <div
          className={cn(
            "rounded-2xl px-3 py-2 text-sm",
            mine ? "bg-primary text-primary-foreground" : "bg-surface text-foreground",
          )}
        >
          {message.body ? <p className="whitespace-pre-wrap break-words">{message.body}</p> : null}

          {message.attachments.map((attachment) => (
            <MessageAttachmentView key={attachment.id} attachment={attachment} mine={mine} />
          ))}

          <span
            className={cn(
              "mt-1 block text-[10px]",
              mine ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {formatTime(message.created_at)}
          </span>
        </div>

        {/* Reaction affordance appears on hover, and is always reachable by keyboard. */}
        <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <EmojiPickerPopover onPick={(emoji) => onToggleReaction(message.id, emoji)} />
        </div>
      </div>

      {reactions.length > 0 && (
        <div className={cn("flex flex-wrap gap-1", mine ? "justify-end" : "justify-start")}>
          {reactions.map((reaction) => (
            <button
              key={reaction.emoji}
              type="button"
              onClick={() => onToggleReaction(message.id, reaction.emoji)}
              aria-label={`${reaction.emoji} ${reaction.count}`}
              aria-pressed={reaction.mine}
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs transition-colors",
                reaction.mine
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground",
              )}
            >
              <span aria-hidden>{reaction.emoji}</span>{" "}
              <span className="tabular-nums">{reaction.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
