"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js"
import { REALTIME_TOKEN_REFRESH_MS } from "@/lib/messaging/realtime-token"
import type {
  ConversationWithClient,
  Message,
  MessageReaction,
  MessageSenderRole,
  MessageWithExtras,
} from "@/types/database"

export type ConnectionState = "connecting" | "live" | "unavailable"

export interface SendInput {
  body?: string | null
  attachments?: {
    storage_path: string
    original_filename?: string | null
    width?: number | null
    height?: number | null
    duration_seconds?: number | null
  }[]
}

interface MessagingContextValue {
  viewerRole: MessageSenderRole
  viewerId: string
  conversations: ConversationWithClient[]
  totalUnread: number
  activeConversationId: string | null
  messages: MessageWithExtras[]
  loadingThread: boolean
  connectionState: ConnectionState
  typingFromOther: boolean
  isOtherOnline: boolean
  openConversation: (id: string) => void
  closeConversation: () => void
  sendMessage: (input: SendInput) => Promise<{ ok: boolean; error?: string }>
  toggleReaction: (messageId: string, emoji: string) => Promise<void>
  broadcastTyping: () => void
  refreshConversations: () => Promise<void>
}

const MessagingContext = createContext<MessagingContextValue | null>(null)

export function useMessaging(): MessagingContextValue {
  const value = useContext(MessagingContext)
  if (!value) throw new Error("useMessaging must be used inside <MessagingProvider>")
  return value
}

/** Typing broadcasts are throttled to one every two seconds. */
const TYPING_THROTTLE_MS = 2000
/** How long a received "typing" stays visible without a refresh. */
const TYPING_LINGER_MS = 4000

export function MessagingProvider({
  viewerId,
  viewerRole,
  children,
}: {
  viewerId: string
  viewerRole: MessageSenderRole
  children: React.ReactNode
}) {
  const [conversations, setConversations] = useState<ConversationWithClient[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageWithExtras[]>([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting")
  const [typingFromOther, setTypingFromOther] = useState(false)
  const [isOtherOnline, setIsOtherOnline] = useState(false)

  const supabaseRef = useRef<SupabaseClient | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const lastTypingSentRef = useRef(0)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The subscription callbacks are registered once but need the CURRENT active
  // conversation. A ref avoids tearing down and rebuilding the socket on every
  // thread switch.
  activeIdRef.current = activeConversationId

  const refreshConversations = useCallback(async () => {
    const res = await fetch("/api/messaging/conversations")
    if (!res.ok) return
    const data = await res.json()
    setConversations(data.conversations ?? [])
  }, [])

  const loadThread = useCallback(async (conversationId: string) => {
    setLoadingThread(true)
    try {
      const res = await fetch(`/api/messaging/conversations/${conversationId}`)
      if (!res.ok) {
        setMessages([])
        return
      }
      const data = await res.json()
      setMessages(data.messages ?? [])
    } finally {
      setLoadingThread(false)
    }
  }, [])

  /** Pull one message (with attachments) that arrived over the socket. */
  const appendFromRealtime = useCallback(async (row: Message) => {
    // Only the open thread needs the full record; other conversations just move
    // the unread badge, which the list refresh handles.
    if (row.conversation_id !== activeIdRef.current) return

    let hydrated: MessageWithExtras = { ...row, attachments: [], reactions: [] }
    if (row.attachment_count > 0) {
      const res = await fetch(`/api/messaging/conversations/${row.conversation_id}`)
      if (res.ok) {
        const data = await res.json()
        const found = (data.messages as MessageWithExtras[]).find((m) => m.id === row.id)
        if (found) hydrated = found
      }
    }

    setMessages((current) => {
      // The sender already appended this optimistically, and a second copy of
      // your own message is the classic realtime chat bug.
      if (current.some((m) => m.id === hydrated.id)) return current
      return [...current, hydrated]
    })
  }, [])

  // ── Socket ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    async function connect() {
      const res = await fetch("/api/messaging/realtime-token")
      if (cancelled) return

      if (!res.ok) {
        // 503 means SUPABASE_JWT_SECRET is not deployed. Say so rather than
        // holding a socket that will never deliver anything.
        setConnectionState("unavailable")
        return
      }

      const { token } = await res.json()
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      if (!url || !anonKey) {
        setConnectionState("unavailable")
        return
      }

      const supabase = supabaseRef.current ?? createClient(url, anonKey)
      supabaseRef.current = supabase
      await supabase.realtime.setAuth(token)

      if (!channelRef.current) {
        // ONE unfiltered subscription each. RLS scopes it: a client receives
        // only their own rows, an admin receives every conversation's.
        channelRef.current = supabase
          .channel("messaging")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
            void appendFromRealtime(payload.new as Message)
            void refreshConversations()
          })
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reactions" }, (payload) => {
            const reaction = payload.new as MessageReaction
            setMessages((current) =>
              current.map((m) =>
                m.id === reaction.message_id && !m.reactions.some((r) => r.id === reaction.id)
                  ? { ...m, reactions: [...m.reactions, reaction] }
                  : m,
              ),
            )
          })
          .on("postgres_changes", { event: "DELETE", schema: "public", table: "message_reactions" }, (payload) => {
            // DELETE carries only the primary key by design — see the migration.
            const removedId = (payload.old as { id?: string } | null)?.id
            if (!removedId) return
            setMessages((current) =>
              current.map((m) => ({ ...m, reactions: m.reactions.filter((r) => r.id !== removedId) })),
            )
          })
          .subscribe((status) => {
            if (cancelled) return
            if (status === "SUBSCRIBED") setConnectionState("live")
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConnectionState("unavailable")
          })
      }

      refreshTimer = setTimeout(() => void connect(), REALTIME_TOKEN_REFRESH_MS)
    }

    void connect()

    // A backgrounded tab can miss messages; re-read on return rather than
    // trusting the socket to have stayed healthy.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshConversations()
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      cancelled = true
      if (refreshTimer) clearTimeout(refreshTimer)
      document.removeEventListener("visibilitychange", onVisible)
      channelRef.current?.unsubscribe()
      channelRef.current = null
    }
  }, [appendFromRealtime, refreshConversations])

  useEffect(() => {
    void refreshConversations()
  }, [refreshConversations])

  // ── Per-conversation presence + typing ────────────────────────────────────
  useEffect(() => {
    const supabase = supabaseRef.current
    if (!supabase || !activeConversationId || connectionState !== "live") {
      setIsOtherOnline(false)
      setTypingFromOther(false)
      return
    }

    const channel = supabase.channel(`conversation:${activeConversationId}`, {
      config: { private: true, presence: { key: viewerId } },
    })

    channel
      .on("broadcast", { event: "typing" }, (payload) => {
        if ((payload.payload as { userId?: string })?.userId === viewerId) return
        setTypingFromOther(true)
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
        typingTimerRef.current = setTimeout(() => setTypingFromOther(false), TYPING_LINGER_MS)
      })
      .on("presence", { event: "sync" }, () => {
        const others = Object.keys(channel.presenceState()).filter((key) => key !== viewerId)
        setIsOtherOnline(others.length > 0)
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel.track({ online_at: new Date().toISOString() })
      })

    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      setTypingFromOther(false)
      setIsOtherOnline(false)
      void channel.unsubscribe()
    }
  }, [activeConversationId, connectionState, viewerId])

  const broadcastTyping = useCallback(() => {
    const supabase = supabaseRef.current
    const conversationId = activeIdRef.current
    if (!supabase || !conversationId) return

    const now = Date.now()
    if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) return
    lastTypingSentRef.current = now

    void supabase
      .channel(`conversation:${conversationId}`, { config: { private: true } })
      .send({ type: "broadcast", event: "typing", payload: { userId: viewerId } })
  }, [viewerId])

  // ── Actions ───────────────────────────────────────────────────────────────
  const openConversation = useCallback(
    (id: string) => {
      setActiveConversationId(id)
      activeIdRef.current = id
      void loadThread(id)
      void fetch(`/api/messaging/conversations/${id}/read`, { method: "POST" }).then(() => refreshConversations())
    },
    [loadThread, refreshConversations],
  )

  const closeConversation = useCallback(() => {
    setActiveConversationId(null)
    activeIdRef.current = null
    setMessages([])
  }, [])

  const sendMessage = useCallback(
    async (input: SendInput): Promise<{ ok: boolean; error?: string }> => {
      const conversationId = activeIdRef.current
      if (!conversationId) return { ok: false, error: "No conversation is open." }

      const res = await fetch("/api/messaging/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, ...input }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return { ok: false, error: data.error ?? "That message did not send." }
      }

      const { message } = await res.json()
      setMessages((current) => (current.some((m) => m.id === message.id) ? current : [...current, message]))
      void refreshConversations()
      return { ok: true }
    },
    [refreshConversations],
  )

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    const res = await fetch(`/api/messaging/messages/${messageId}/reactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emoji }),
    })
    if (!res.ok) return

    const { added, reaction } = await res.json()
    setMessages((current) =>
      current.map((m) => {
        if (m.id !== messageId) return m
        if (added && reaction) {
          return m.reactions.some((r) => r.id === reaction.id) ? m : { ...m, reactions: [...m.reactions, reaction] }
        }
        return { ...m, reactions: m.reactions.filter((r) => !(r.emoji === emoji && r.user_id === viewerId)) }
      }),
    )
  }, [viewerId])

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0),
    [conversations],
  )

  const value = useMemo<MessagingContextValue>(
    () => ({
      viewerRole,
      viewerId,
      conversations,
      totalUnread,
      activeConversationId,
      messages,
      loadingThread,
      connectionState,
      typingFromOther,
      isOtherOnline,
      openConversation,
      closeConversation,
      sendMessage,
      toggleReaction,
      broadcastTyping,
      refreshConversations,
    }),
    [
      viewerRole,
      viewerId,
      conversations,
      totalUnread,
      activeConversationId,
      messages,
      loadingThread,
      connectionState,
      typingFromOther,
      isOtherOnline,
      openConversation,
      closeConversation,
      sendMessage,
      toggleReaction,
      broadcastTyping,
      refreshConversations,
    ],
  )

  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>
}
