"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import {
  Bot,
  User,
  ArrowUp,
  Sparkles,
  RotateCcw,
  Square,
  Plus,
  MessageSquare,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  Zap,
  Brain,
  Wand2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import {
  AI_CHAT_STORAGE_KEY,
  AI_CHAT_HISTORY_LIMIT,
  AI_CHAT_MAX_CONVERSATIONS,
} from "@/lib/admin-ai-config"

// ── Types ────────────────────────────────────────────────────────────────────

type ErrorType = "rate_limit" | "auth" | "server" | "network" | null

interface Message {
  role: "user" | "assistant"
  content: string
  timestamp: Date
  status?: "streaming" | "done" | "error"
  errorType?: ErrorType
}

interface StoredMessage {
  role: "user" | "assistant"
  content: string
  timestamp: string
  status?: "done" | "error"
  errorType?: ErrorType
}

interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
  updatedAt: Date
}

interface StoredConversation {
  id: string
  title: string
  messages: StoredMessage[]
  createdAt: string
  updatedAt: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content:
    "Hi Darren! I've analyzed your platform data. Ask me anything about your clients, revenue, or programs.",
  timestamp: new Date(),
  status: "done",
}

const SUGGESTED_PROMPTS = [
  "Which clients need attention?",
  "How's revenue this month?",
  "Who are my top performers?",
  "Any program recommendations?",
]

// ── Storage helpers ──────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(AI_CHAT_STORAGE_KEY)
    if (!raw) return []
    const stored: StoredConversation[] = JSON.parse(raw)
    if (!Array.isArray(stored)) return []
    return stored.map((c) => ({
      ...c,
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.updatedAt),
      messages: c.messages.map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp),
        status: m.status === "error" ? ("error" as const) : ("done" as const),
      })),
    }))
  } catch {
    return []
  }
}

function saveConversations(convos: Conversation[]) {
  try {
    const toStore: StoredConversation[] = convos
      .slice(0, AI_CHAT_MAX_CONVERSATIONS)
      .map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        messages: c.messages
          .filter((m) => m.content && m.status !== "streaming")
          .slice(-AI_CHAT_HISTORY_LIMIT)
          .map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp.toISOString(),
            status: m.status === "error" ? ("error" as const) : ("done" as const),
            errorType: m.errorType ?? null,
          })),
      }))
    localStorage.setItem(AI_CHAT_STORAGE_KEY, JSON.stringify(toStore))
  } catch {
    // localStorage full or unavailable
  }
}

// ── Date grouping ────────────────────────────────────────────────────────────

function getDateGroup(date: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 7 * 86400000)

  if (date >= today) return "Today"
  if (date >= yesterday) return "Yesterday"
  if (date >= weekAgo) return "Previous 7 days"
  return "Older"
}

// ── Renderers ────────────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

function getErrorMessage(status: number): { message: string; errorType: ErrorType } {
  if (status === 429)
    return { message: "AI is busy right now. Please wait a moment and try again.", errorType: "rate_limit" }
  if (status === 401 || status === 403)
    return { message: "Your session has expired. Please refresh the page and sign in again.", errorType: "auth" }
  return { message: "Something went wrong. Please try again.", errorType: "server" }
}

function renderContent(content: string) {
  const lines = content.split("\n")
  const elements: React.ReactNode[] = []

  lines.forEach((line, i) => {
    if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <li key={i} className="ml-4 list-disc">{renderInline(line.slice(2))}</li>
      )
      return
    }
    const numberedMatch = line.match(/^\d+\.\s(.+)/)
    if (numberedMatch) {
      elements.push(
        <li key={i} className="ml-4 list-decimal">{renderInline(numberedMatch[1])}</li>
      )
      return
    }
    if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />)
      return
    }
    elements.push(
      <p key={i} className="leading-relaxed">{renderInline(line)}</p>
    )
  })

  return <div className="space-y-1">{elements}</div>
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <span key={i} className="font-semibold">{part.slice(2, -2)}</span>
    }
    return part
  })
}

function TypingIndicator() {
  return (
    <div className="flex gap-3 w-full">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Bot className="size-3.5 text-primary" />
      </div>
      <div className="pt-1">
        <div className="flex items-center gap-1.5" role="status">
          {[0, 0.2, 0.4].map((delay) => (
            <motion.span
              key={delay}
              className="size-2 rounded-full bg-muted-foreground/40"
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.2, repeat: Infinity, delay }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function AdminAiChat() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [modelPref, setModelPref] = useState<"auto" | "sonnet" | "haiku">("auto")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const initializedRef = useRef(false)

  // Current conversation's messages
  const activeConvo = conversations.find((c) => c.id === activeId)
  const messages = activeConvo?.messages ?? [WELCOME_MESSAGE]

  // ── Init from localStorage ──────────────────────────────────────────────
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    const restored = loadConversations()
    setConversations(restored)
    // Open the most recent conversation if any
    if (restored.length > 0) {
      setActiveId(restored[0].id)
    }
  }, [])

  // ── Persist on change ───────────────────────────────────────────────────
  useEffect(() => {
    if (!initializedRef.current) return
    const hasStreaming = messages.some((m) => m.status === "streaming")
    if (!hasStreaming) {
      saveConversations(conversations)
    }
  }, [conversations, messages])

  // ── Scroll ──────────────────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, isStreaming, scrollToBottom])

  // ── Abort on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => { abortControllerRef.current?.abort() }
  }, [])

  // ── Auto-resize textarea ────────────────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = "auto"
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
    }
  }, [input])

  // ── Conversation management ─────────────────────────────────────────────

  const updateActiveMessages = useCallback(
    (updater: (prev: Message[]) => Message[]) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? { ...c, messages: updater(c.messages), updatedAt: new Date() }
            : c
        )
      )
    },
    [activeId]
  )

  const startNewChat = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsStreaming(false)
    setInput("")

    const newConvo: Conversation = {
      id: generateId(),
      title: "New chat",
      messages: [{ ...WELCOME_MESSAGE, timestamp: new Date() }],
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    setConversations((prev) => [newConvo, ...prev])
    setActiveId(newConvo.id)
  }, [])

  const switchConversation = useCallback(
    (id: string) => {
      if (isStreaming) return
      setActiveId(id)
      setInput("")
    },
    [isStreaming]
  )

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (activeId === id) {
        setConversations((prev) => {
          if (prev.length > 0) setActiveId(prev[0].id)
          else setActiveId(null)
          return prev
        })
      }
    },
    [activeId]
  )

  const stopGenerating = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsStreaming(false)

    updateActiveMessages((prev) => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (last?.role === "assistant" && last.status === "streaming") {
        updated[updated.length - 1] = {
          ...last,
          status: "done",
          content: last.content || "Response was stopped.",
        }
      }
      return updated
    })
  }, [updateActiveMessages])

  // ── Send message ────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return

      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller

      const userMessage: Message = {
        role: "user",
        content: content.trim(),
        timestamp: new Date(),
        status: "done",
      }

      // If no active conversation, create one
      let currentId = activeId
      if (!currentId) {
        const newConvo: Conversation = {
          id: generateId(),
          title: content.trim().slice(0, 60),
          messages: [{ ...WELCOME_MESSAGE, timestamp: new Date() }],
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        currentId = newConvo.id
        setConversations((prev) => [newConvo, ...prev])
        setActiveId(currentId)
      }

      // Auto-title: set title from first user message if it's still "New chat"
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentId && c.title === "New chat"
            ? { ...c, title: content.trim().slice(0, 60) }
            : c
        )
      )

      // Add user message + streaming placeholder
      const updatedMessages = [...messages, userMessage]
      const placeholder: Message = {
        role: "assistant",
        content: "",
        timestamp: new Date(),
        status: "streaming",
      }

      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentId
            ? { ...c, messages: [...updatedMessages, placeholder], updatedAt: new Date() }
            : c
        )
      )
      setInput("")
      setIsStreaming(true)

      const updateMsgs = (updater: (prev: Message[]) => Message[]) => {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === currentId
              ? { ...c, messages: updater(c.messages), updatedAt: new Date() }
              : c
          )
        )
      }

      try {
        const res = await fetch("/api/admin/ai-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            messages: updatedMessages.map(({ role, content }) => ({ role, content })),
            model: modelPref,
          }),
        })

        if (!res.ok) {
          const { message, errorType } = getErrorMessage(res.status)
          updateMsgs((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last?.role === "assistant") {
              updated[updated.length - 1] = { ...last, content: message, status: "error", errorType }
            }
            return updated
          })
          setIsStreaming(false)
          return
        }

        const reader = res.body?.getReader()
        if (!reader) throw new Error("No response body")

        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            try {
              const event = JSON.parse(line.slice(6))
              if (event.type === "delta") {
                updateMsgs((prev) => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last?.role === "assistant" && last.status === "streaming") {
                    updated[updated.length - 1] = { ...last, content: last.content + event.text }
                  }
                  return updated
                })
              } else if (event.type === "done") {
                updateMsgs((prev) => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last?.role === "assistant") {
                    updated[updated.length - 1] = { ...last, status: "done" }
                  }
                  return updated
                })
              } else if (event.type === "error") {
                updateMsgs((prev) => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last?.role === "assistant") {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content || "Something went wrong. Please try again.",
                      status: "error",
                      errorType: "server",
                    }
                  }
                  return updated
                })
              }
            } catch {
              // malformed SSE
            }
          }
        }

        // Finalize if still streaming
        updateMsgs((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === "assistant" && last.status === "streaming") {
            updated[updated.length - 1] = {
              ...last,
              status: last.content ? "done" : "error",
              content: last.content || "Sorry, I couldn't process that request.",
              errorType: last.content ? null : "server",
            }
          }
          return updated
        })
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return

        const isNetworkError = err instanceof TypeError && err.message.includes("fetch")
        const errorType: ErrorType = isNetworkError ? "network" : "server"
        const message = isNetworkError
          ? "You appear to be offline. Check your connection and try again."
          : "I'm having trouble connecting right now. Please try again in a moment."

        updateMsgs((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === "assistant") {
            updated[updated.length - 1] = {
              ...last,
              content: last.content || message,
              status: "error",
              errorType,
            }
          }
          return updated
        })
      } finally {
        setIsStreaming(false)
        abortControllerRef.current = null
        textareaRef.current?.focus()
      }
    },
    [messages, isStreaming, activeId, modelPref]
  )

  const retryLastMessage = useCallback(() => {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")
    if (!lastUserMessage) return

    updateActiveMessages((prev) => {
      const updated = [...prev]
      if (updated[updated.length - 1]?.status === "error") updated.pop()
      if (updated[updated.length - 1]?.role === "user") updated.pop()
      return updated
    })

    setTimeout(() => sendMessage(lastUserMessage.content), 50)
  }, [messages, sendMessage, updateActiveMessages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  // ── Derived state ───────────────────────────────────────────────────────
  const isNewChat = !activeId || messages.length <= 1
  const lastMessage = messages[messages.length - 1]
  const showTyping = isStreaming && lastMessage?.role === "assistant" && !lastMessage.content
  const showStop = isStreaming && lastMessage?.role === "assistant" && !!lastMessage.content

  // Group conversations by date
  const grouped = conversations.reduce<Record<string, Conversation[]>>((acc, c) => {
    const group = getDateGroup(c.updatedAt)
    ;(acc[group] ??= []).push(c)
    return acc
  }, {})
  const groupOrder = ["Today", "Yesterday", "Previous 7 days", "Older"]

  return (
    <div
      className="fixed inset-0 flex lg:left-64"
      style={{ top: "4rem" }}
    >
      {/* ── Conversation sidebar ──────────────────────────────────────── */}
      <div
        className={cn(
          "shrink-0 flex flex-col bg-surface/60 border-r border-border transition-all duration-200 overflow-hidden",
          sidebarOpen ? "w-64" : "w-0"
        )}
      >
        {/* New chat button */}
        <div className="p-3">
          <Button
            onClick={startNewChat}
            variant="outline"
            className="w-full justify-start gap-2 text-sm"
          >
            <Plus className="size-4" />
            New chat
          </Button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {groupOrder.map((group) => {
            const items = grouped[group]
            if (!items?.length) return null
            return (
              <div key={group} className="mb-3">
                <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {group}
                </p>
                {items.map((convo) => (
                  <div
                    key={convo.id}
                    className={cn(
                      "group flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer transition-colors",
                      convo.id === activeId
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground hover:bg-muted"
                    )}
                    onClick={() => switchConversation(convo.id)}
                  >
                    <MessageSquare className="size-4 shrink-0 opacity-60" />
                    <span className="flex-1 truncate">{convo.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteConversation(convo.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 text-muted-foreground hover:text-destructive transition-all"
                      aria-label="Delete conversation"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )
          })}

          {conversations.length === 0 && (
            <p className="px-3 py-6 text-xs text-muted-foreground text-center">
              No conversations yet
            </p>
          )}
        </div>
      </div>

      {/* ── Chat panel ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header bar */}
        <div className="shrink-0 flex items-center justify-between h-10 px-3 border-b border-border bg-background">
          <div className="flex items-center min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={() => setSidebarOpen((p) => !p)}
              aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="size-4" />
              ) : (
                <PanelLeftOpen className="size-4" />
              )}
            </Button>
            {activeConvo && (
              <span className="ml-2 text-sm text-muted-foreground truncate">
                {activeConvo.title}
              </span>
            )}
          </div>

          {/* Model selector */}
          <div className="flex items-center gap-1 shrink-0 bg-muted rounded-lg p-0.5">
            {([
              { value: "auto", label: "Auto", icon: Wand2 },
              { value: "sonnet", label: "Sonnet", icon: Brain },
              { value: "haiku", label: "Haiku", icon: Zap },
            ] as const).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setModelPref(value)}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
                  modelPref === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-3" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto min-h-0" role="log" aria-live="polite">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
            <AnimatePresence initial={false}>
              {messages.map((message, index) => {
                if (
                  message.role === "assistant" &&
                  !message.content &&
                  message.status === "streaming" &&
                  index === messages.length - 1
                ) {
                  return null
                }

                const isUser = message.role === "user"

                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className={cn("flex gap-3", isUser && "justify-end")}
                  >
                    {!isUser && (
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                        <Bot className="size-3.5 text-primary" />
                      </div>
                    )}

                    <div className={cn("flex flex-col gap-1", isUser ? "items-end max-w-[80%]" : "flex-1 min-w-0")}>
                      <div
                        className={cn(
                          "rounded-2xl px-4 py-2.5 text-sm",
                          isUser
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : message.status === "error"
                              ? "bg-red-50 border border-red-200 text-foreground rounded-bl-sm"
                              : "text-foreground"
                        )}
                      >
                        {isUser ? message.content : renderContent(message.content)}
                      </div>

                      <div className="flex items-center gap-2 px-1">
                        <span className="text-[10px] text-muted-foreground">
                          {formatTime(message.timestamp)}
                        </span>
                        {message.status === "error" &&
                          message.errorType !== "auth" &&
                          index === messages.length - 1 && (
                            <button
                              onClick={retryLastMessage}
                              className="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
                            >
                              <RotateCcw className="size-3" />
                              Try again
                            </button>
                          )}
                      </div>
                    </div>

                    {isUser && (
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary mt-0.5">
                        <User className="size-3.5 text-primary-foreground" />
                      </div>
                    )}
                  </motion.div>
                )
              })}
            </AnimatePresence>

            {showTyping && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                aria-busy="true"
              >
                <TypingIndicator />
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Bottom input area */}
        <div className="shrink-0 border-t border-border bg-background">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 space-y-3">
            {showStop && (
              <div className="flex justify-center">
                <Button variant="outline" size="sm" onClick={stopGenerating} className="gap-1.5 text-xs">
                  <Square className="size-3" />
                  Stop generating
                </Button>
              </div>
            )}

            {isNewChat && !isStreaming && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles className="size-3.5 text-accent-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Suggested questions</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => sendMessage(prompt)}
                      className="inline-flex items-center rounded-full border border-border bg-surface/50 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-colors"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex items-end gap-2">
              <div className="relative flex-1">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message DJP Assistant..."
                  disabled={isStreaming}
                  rows={1}
                  className="!resize-none pr-12 min-h-[48px] max-h-[200px] rounded-xl border-border"
                  autoComplete="off"
                  aria-label="Chat message"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!input.trim() || isStreaming}
                  className="absolute right-2 bottom-2 size-8 rounded-lg"
                  aria-label="Send message"
                >
                  <ArrowUp className="size-4" />
                </Button>
              </div>
            </form>

            <p className="text-[10px] text-muted-foreground text-center">
              AI can make mistakes. Verify important information.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
