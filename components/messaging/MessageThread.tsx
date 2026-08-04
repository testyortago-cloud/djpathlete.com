"use client"

import { useEffect, useRef } from "react"
import { useMessaging } from "./MessagingProvider"
import { MessageBubble } from "./MessageBubble"
import { MessageComposer } from "./MessageComposer"

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-1 py-2 text-xs text-muted-foreground" aria-live="polite">
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
      <span className="ml-1">typing…</span>
    </div>
  )
}

export function MessageThread({ conversationId }: { conversationId: string }) {
  const {
    messages,
    loadingThread,
    viewerId,
    viewerRole,
    conversations,
    typingFromOther,
    connectionState,
    sendMessage,
    toggleReaction,
    broadcastTyping,
  } = useMessaging()

  const bottomRef = useRef<HTMLDivElement>(null)
  const conversation = conversations.find((c) => c.id === conversationId)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [messages.length, typingFromOther])

  // Read receipt: the other side's stamp, which the delayed email also uses.
  const otherLastReadAt = viewerRole === "admin" ? conversation?.client_last_read_at : conversation?.admin_last_read_at
  const myLastMessage = [...messages].reverse().find((m) => m.sender_role === viewerRole)
  const seen =
    !!otherLastReadAt && !!myLastMessage && Date.parse(otherLastReadAt) >= Date.parse(myLastMessage.created_at)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {loadingThread && messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading the conversation…</p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No messages yet. Say hello — they will get an email if they miss it.
          </p>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              viewerId={viewerId}
              mine={message.sender_role === viewerRole}
              onToggleReaction={(id, emoji) => void toggleReaction(id, emoji)}
            />
          ))
        )}

        {seen && <p className="text-right text-[10px] text-muted-foreground">Seen</p>}
        {typingFromOther && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {connectionState === "unavailable" && (
        // A silent dead socket looks like a broken app. Say what is true.
        <p className="border-t border-border bg-surface px-3 py-1.5 text-[11px] text-muted-foreground">
          Live updates are off — messages still send, and the thread refreshes when you reopen it.
        </p>
      )}

      <MessageComposer conversationId={conversationId} onSend={sendMessage} onTyping={broadcastTyping} />
    </div>
  )
}
