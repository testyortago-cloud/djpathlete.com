"use client"

import { useEffect, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useMessaging } from "./MessagingProvider"
import { ConversationList, clientName } from "./ConversationList"
import { MessageThread } from "./MessageThread"
import { NewConversationDialog } from "./NewConversationDialog"

/**
 * Two panes for the coach, one for the client.
 *
 * A client has exactly one conversation, so a list would be a list of one —
 * they go straight to the thread.
 */
export function InboxPage({ initialConversationId }: { initialConversationId?: string }) {
  const { conversations, activeConversationId, openConversation, viewerRole, isOtherOnline } = useMessaging()
  const [filter, setFilter] = useState("")

  // Client: open their single conversation as soon as it loads. Coach: honour a
  // ?conversation= deep link, which is what the notification email points at.
  useEffect(() => {
    if (activeConversationId || conversations.length === 0) return
    if (viewerRole === "client") {
      openConversation(conversations[0].id)
      return
    }
    if (initialConversationId && conversations.some((c) => c.id === initialConversationId)) {
      openConversation(initialConversationId)
    }
  }, [activeConversationId, conversations, initialConversationId, openConversation, viewerRole])

  const active = conversations.find((c) => c.id === activeConversationId)

  if (viewerRole === "client") {
    return (
      <div className="flex h-[calc(100dvh-12rem)] flex-col overflow-hidden rounded-xl border border-border bg-white">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h1 className="flex-1 font-heading text-sm font-semibold">Messages with your coach</h1>
          {isOtherOnline && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-[var(--success)]" />
              Online
            </span>
          )}
        </header>
        {activeConversationId ? (
          <MessageThread conversationId={activeConversationId} />
        ) : (
          <p className="p-8 text-center text-sm text-muted-foreground">Opening your conversation…</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-12rem)] overflow-hidden rounded-xl border border-border bg-white">
      <aside className="flex w-full max-w-xs shrink-0 flex-col border-r border-border">
        <div className="space-y-2 border-b border-border p-3">
          <div className="flex items-center gap-2">
            <h1 className="flex-1 font-heading text-sm font-semibold">Inbox</h1>
            <NewConversationDialog />
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              className="h-8 pl-7 text-sm"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ConversationList activeId={activeConversationId} onSelect={openConversation} filter={filter} />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {activeConversationId ? (
          <>
            <header className="flex items-center gap-2 border-b border-border px-4 py-3">
              <h2 className="flex-1 truncate font-heading text-sm font-semibold">
                {active ? clientName(active) : "Conversation"}
              </h2>
              {isOtherOnline && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2 rounded-full bg-[var(--success)]" />
                  Online
                </span>
              )}
            </header>
            <MessageThread conversationId={activeConversationId} />
          </>
        ) : (
          <p className="m-auto max-w-xs p-8 text-center text-sm text-muted-foreground">
            Pick a conversation, or start a new one with a client.
          </p>
        )}
      </section>
    </div>
  )
}
