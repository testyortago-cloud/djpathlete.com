"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Send } from "lucide-react"
import { toast } from "sonner"
import { VoiceRecorder, type VoiceRecorderState } from "@/components/shared/VoiceRecorder"

interface Attachment {
  id: string
  kind: "audio"
  storage_path: string
  mime_type: string
  duration_seconds: number | null
  playback_url?: string | null
}

interface Message {
  id: string
  user_id: string
  message: string | null
  created_at: string
  attachments?: Attachment[]
  users?: {
    first_name: string
    last_name: string
    avatar_url?: string | null
    role?: string
  } | null
}

interface FormReviewThreadProps {
  messages: Message[]
  currentUserId: string
  reviewId: string
  apiBasePath: string // e.g. "/api/client/form-reviews" or "/api/admin/form-reviews"
}

export function FormReviewThread({
  messages: initialMessages,
  currentUserId,
  reviewId,
  apiBasePath,
}: FormReviewThreadProps) {
  const [messages, setMessages] = useState(initialMessages)
  const [newMessage, setNewMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [voiceState, setVoiceState] = useState<VoiceRecorderState>("idle")
  const isComposingVoice = voiceState !== "idle"

  async function handleSend() {
    if (!newMessage.trim() || sending) return

    setSending(true)
    try {
      const res = await fetch(`${apiBasePath}/${reviewId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: newMessage.trim() }),
      })

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

  async function handleSendAudio(payload: {
    storage_path: string
    mime_type: string
    duration_seconds: number
    byte_size: number
  }) {
    const res = await fetch(`${apiBasePath}/${reviewId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: payload }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || "Failed to send voice message")
    }
    const created = await res.json()
    setMessages((prev) => [...prev, created])
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr)
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-foreground">Conversation</h3>

      {/* Messages */}
      <div className="space-y-3 max-h-[400px] overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">
            No messages yet. Start the conversation below.
          </p>
        )}
        {messages.map((msg) => {
          const isOwn = msg.user_id === currentUserId
          const name = msg.users ? `${msg.users.first_name} ${msg.users.last_name}` : "Unknown"
          const isCoach = msg.users?.role === "admin"

          return (
            <div key={msg.id} className={cn("flex flex-col gap-1", isOwn ? "items-end" : "items-start")}>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{name}</span>
                {isCoach && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground font-medium">
                    Coach
                  </span>
                )}
              </div>
              <div
                className={cn(
                  "max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed",
                  isOwn ? "bg-primary text-primary-foreground" : "bg-white border border-border text-foreground",
                )}
              >
                {msg.attachments?.[0]?.kind === "audio" ? (
                  <div className="flex items-center gap-2 min-w-0">
                    {msg.attachments[0].playback_url ? (
                      <audio
                        src={msg.attachments[0].playback_url}
                        controls
                        className="h-8 min-w-0 max-w-full flex-1"
                      />
                    ) : (
                      <span className="text-xs italic opacity-70">Audio unavailable</span>
                    )}
                    {msg.attachments[0].duration_seconds != null && (
                      <span className="text-xs opacity-70 tabular-nums shrink-0">
                        ({Math.floor(msg.attachments[0].duration_seconds / 60)}:
                        {(msg.attachments[0].duration_seconds % 60).toString().padStart(2, "0")})
                      </span>
                    )}
                  </div>
                ) : (
                  msg.message
                )}
              </div>
              <span className="text-[10px] text-muted-foreground">{formatTime(msg.created_at)}</span>
            </div>
          )
        })}
      </div>

      {/* Reply input — when voice recorder is active (recording / previewing /
          uploading), the recorder takes the full row and we hide the text
          input + text-send button so the native <audio controls> widget
          doesn't push the row off-screen on mobile. */}
      <div className="flex gap-2 items-end">
        {!isComposingVoice && (
          <Textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="min-h-[44px] max-h-[120px] resize-none flex-1 min-w-0"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
        )}
        <VoiceRecorder
          userId={currentUserId}
          onSend={handleSendAudio}
          onStateChange={setVoiceState}
          disabled={sending}
        />
        {!isComposingVoice && (
          <Button size="icon" onClick={handleSend} disabled={!newMessage.trim() || sending} className="shrink-0">
            <Send className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
