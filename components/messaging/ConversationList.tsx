"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { useMessaging } from "./MessagingProvider"
import type { ConversationWithClient } from "@/types/database"

export function clientName(conversation: ConversationWithClient): string {
  const name = [conversation.client?.first_name, conversation.client?.last_name].filter(Boolean).join(" ").trim()
  return name || conversation.client?.email || "Client"
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

function relativeDay(iso: string | null) {
  if (!iso) return ""
  const date = new Date(iso)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" })
}

export function ConversationList({
  activeId,
  onSelect,
  filter = "",
}: {
  activeId?: string | null
  onSelect: (id: string) => void
  filter?: string
}) {
  const { conversations } = useMessaging()

  const visible = filter.trim()
    ? conversations.filter((c) => {
        const haystack = `${clientName(c)} ${c.last_message_preview ?? ""}`.toLowerCase()
        return haystack.includes(filter.trim().toLowerCase())
      })
    : conversations

  if (visible.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        {filter.trim() ? "No conversations match that." : "No conversations yet."}
      </p>
    )
  }

  return (
    <ul className="divide-y divide-border">
      {visible.map((conversation) => {
        const name = clientName(conversation)
        const unread = conversation.unread_count ?? 0
        return (
          <li key={conversation.id}>
            <button
              type="button"
              onClick={() => onSelect(conversation.id)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface",
                activeId === conversation.id && "bg-surface",
              )}
            >
              <Avatar className="size-9 shrink-0">
                {conversation.client?.avatar_url && (
                  <AvatarImage src={conversation.client.avatar_url} alt="" />
                )}
                <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
              </Avatar>

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={cn("truncate text-sm", unread > 0 ? "font-semibold" : "font-medium")}>{name}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {relativeDay(conversation.last_message_at)}
                  </span>
                </span>
                <span
                  className={cn(
                    "mt-0.5 block truncate text-xs",
                    unread > 0 ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {conversation.last_message_preview || "No messages yet"}
                </span>
              </span>

              {unread > 0 && (
                <span
                  aria-label={`${unread} unread`}
                  className="ml-1 shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground"
                >
                  {unread}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
