"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Send, ChevronUp } from "lucide-react"
import { toast } from "sonner"

interface Message {
  id: string
  user_id: string
  message: string
  created_at: string
  users?: {
    first_name: string
    last_name: string
    avatar_url?: string | null
    role?: string
  } | null
}

interface AssessmentExerciseThreadProps {
  messages: Message[]
  currentUserId: string
  assessmentId: string
  exerciseId: string
  apiBasePath: string // "/api/client/performance-assessments" or "/api/admin/performance-assessments"
}

const INITIAL_VISIBLE = 5

export function AssessmentExerciseThread({
  messages: initialMessages,
  currentUserId,
  assessmentId,
  exerciseId,
  apiBasePath,
}: AssessmentExerciseThreadProps) {
  const [messages, setMessages] = useState(initialMessages)
  const [newMessage, setNewMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [showAll, setShowAll] = useState(messages.length <= INITIAL_VISIBLE)
  const scrollRef = useRef<HTMLDivElement>(null)

  const hiddenCount = showAll ? 0 : Math.max(messages.length - INITIAL_VISIBLE, 0)
  const visibleMessages = showAll ? messages : messages.slice(-INITIAL_VISIBLE)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, showAll])

  async function handleSend() {
    if (!newMessage.trim() || sending) return

    setSending(true)
    try {
      const res = await fetch(
        `${apiBasePath}/${assessmentId}/exercises/${exerciseId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: newMessage.trim() }),
        }
      )

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to send message")
      }

      const created = await res.json()
      setMessages((prev) => [...prev, created])
      setNewMessage("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send message")
    } finally {
      setSending(false)
    }
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr)
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })
  }

  function formatDateLabel(dateStr: string) {
    const d = new Date(dateStr)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const diffDays = Math.round((today.getTime() - msgDate.getTime()) / 86400000)

    if (diffDays === 0) return "Today"
    if (diffDays === 1) return "Yesterday"
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }

  function getDateKey(dateStr: string) {
    return new Date(dateStr).toDateString()
  }

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Conversation
      </h4>

      {/* Messages */}
      <div ref={scrollRef} className="space-y-3 max-h-[400px] overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No messages yet.
          </p>
        )}

        {/* Show earlier button */}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="flex items-center gap-1 mx-auto text-xs font-medium text-primary hover:text-primary/80 transition-colors py-2"
          >
            <ChevronUp className="size-3.5" />
            Show {hiddenCount} earlier message{hiddenCount !== 1 ? "s" : ""}
          </button>
        )}

        {visibleMessages.map((msg, i) => {
          const isOwn = msg.user_id === currentUserId
          const name = msg.users
            ? `${msg.users.first_name} ${msg.users.last_name}`
            : "Unknown"
          const isCoach = msg.users?.role === "admin"

          // Show date separator when the date changes
          const prevMsg = i > 0 ? visibleMessages[i - 1] : null
          const showDateSep =
            !prevMsg || getDateKey(msg.created_at) !== getDateKey(prevMsg.created_at)

          return (
            <div key={msg.id}>
              {showDateSep && (
                <div className="flex items-center gap-3 py-2">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {formatDateLabel(msg.created_at)}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
              <div
                className={cn("flex flex-col gap-1", isOwn ? "items-end" : "items-start")}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {name}
                  </span>
                  {isCoach && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground font-medium">
                      Coach
                    </span>
                  )}
                </div>
                <div
                  className={cn(
                    "max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                    isOwn
                      ? "bg-primary text-primary-foreground"
                      : "bg-white border border-border text-foreground"
                  )}
                >
                  {msg.message}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {formatTime(msg.created_at)}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Reply input */}
      <div className="flex gap-2 items-end">
        <Textarea
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..."
          className="min-h-[40px] max-h-[100px] resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!newMessage.trim() || sending}
          className="shrink-0 size-9"
        >
          <Send className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
