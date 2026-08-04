"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, Maximize2, MessageCircle, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMessaging } from "./MessagingProvider"
import { ConversationList, clientName } from "./ConversationList"
import { MessageThread } from "./MessageThread"

export function MessagingDock() {
  const [open, setOpen] = useState(false)
  const {
    totalUnread,
    conversations,
    activeConversationId,
    openConversation,
    closeConversation,
    isOtherOnline,
    viewerRole,
  } = useMessaging()

  const active = conversations.find((c) => c.id === activeConversationId)
  const fullPageHref = viewerRole === "admin" ? "/admin/messages" : "/client/messages"

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={totalUnread > 0 ? `Messages, ${totalUnread} unread` : "Messages"}
        // Sits above the client shell's mobile tab bar rather than over it.
        className="fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg transition-transform hover:scale-105 lg:bottom-4"
      >
        <MessageCircle className="size-5" strokeWidth={1.5} />
        <span className="text-sm font-medium">Messages</span>
        {totalUnread > 0 && (
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
            {totalUnread}
          </span>
        )}
      </button>
    )
  }

  return (
    <div
      className={cn(
        "fixed z-40 flex flex-col overflow-hidden border border-border bg-white shadow-2xl",
        // Mobile: a full-height sheet. Desktop: the LinkedIn-style corner panel.
        "inset-x-0 bottom-0 top-0 rounded-none",
        "lg:inset-auto lg:bottom-4 lg:right-4 lg:h-[480px] lg:w-[360px] lg:rounded-xl",
      )}
      role="dialog"
      aria-label="Messages"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        {activeConversationId ? (
          <>
            <button
              type="button"
              aria-label="Back to conversations"
              onClick={closeConversation}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" strokeWidth={1.5} />
            </button>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {active ? clientName(active) : "Conversation"}
            </span>
            {isOtherOnline && (
              <span
                aria-label="Online"
                title="Online"
                className="size-2 shrink-0 rounded-full bg-[var(--success)]"
              />
            )}
          </>
        ) : (
          <span className="flex-1 text-sm font-semibold">Messages</span>
        )}

        <Link
          href={fullPageHref}
          aria-label="Open the full inbox"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <Maximize2 className="size-4" strokeWidth={1.5} />
        </Link>
        <button
          type="button"
          aria-label="Close messages"
          onClick={() => setOpen(false)}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" strokeWidth={1.5} />
        </button>
      </header>

      {activeConversationId ? (
        <MessageThread conversationId={activeConversationId} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ConversationList activeId={activeConversationId} onSelect={openConversation} />
        </div>
      )}
    </div>
  )
}
