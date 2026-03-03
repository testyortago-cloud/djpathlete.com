"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAiJob } from "@/hooks/use-ai-job"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import {
  MessageSquare,
  Loader2,
  CheckCircle2,
  XCircle,
  Send,
  ArrowUp,
  Bot,
  User,
  UserPlus,
  Search,
  Sparkles,
  Square,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { AssignProgramDialog } from "@/components/admin/AssignProgramDialog"
import type { User as UserType } from "@/types/database"

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  status: "streaming" | "done" | "error"
}

interface ToolEvent {
  id: string
  type: "tool_start" | "tool_result" | "program_created"
  tool?: string
  summary?: string
  error?: boolean
  programId?: string
  validationPass?: boolean
  durationMs?: number
}

type ChatItem =
  | { kind: "message"; data: ChatMessage }
  | { kind: "event"; data: ToolEvent }

// ─── Constants ───────────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, { loading: string; done: string }> = {
  list_clients: { loading: "Looking up clients...", done: "Clients loaded" },
  lookup_client_profile: {
    loading: "Loading client profile...",
    done: "Profile loaded",
  },
  generate_program: {
    loading: "Generating program...",
    done: "Program generated",
  },
}

const WELCOME_MESSAGE: ChatItem = {
  kind: "message",
  data: {
    id: "welcome",
    role: "assistant",
    content:
      "Hi! I'm your AI program builder. Tell me about the program you'd like to create — who is it for, and what are their goals?",
    status: "done",
  },
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ToolStatusCard({ event }: { event: ToolEvent }) {
  const isLoading = event.type === "tool_start"
  const labels = TOOL_LABELS[event.tool ?? ""] ?? {
    loading: "Processing...",
    done: "Done",
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface/50 border border-border text-sm text-muted-foreground mx-4 my-1"
    >
      {isLoading ? (
        <Loader2 className="size-3.5 animate-spin text-primary shrink-0" />
      ) : event.error ? (
        <XCircle className="size-3.5 text-destructive shrink-0" />
      ) : (
        <CheckCircle2 className="size-3.5 text-success shrink-0" />
      )}
      <span>{isLoading ? labels.loading : event.summary ?? labels.done}</span>
    </motion.div>
  )
}

function GeneratingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2 mx-4 my-1"
    >
      <div className="flex items-center gap-2">
        <Loader2 className="size-4 animate-spin text-primary" />
        <span className="text-sm font-medium text-foreground">
          Building your program...
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        This typically takes 30-90 seconds. The AI is analyzing the profile,
        designing the structure, and selecting exercises.
      </p>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <motion.div
          className="h-full bg-primary rounded-full"
          initial={{ width: "0%" }}
          animate={{ width: "90%" }}
          transition={{ duration: 60, ease: "easeOut" }}
        />
      </div>
    </motion.div>
  )
}

function ProgramResultCard({
  event,
  onAssign,
}: {
  event: ToolEvent
  onAssign: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="rounded-xl border border-success/30 bg-success/5 p-4 space-y-3 mx-4 my-1"
    >
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-5 text-success" />
        <span className="text-sm font-semibold text-foreground">
          Program Generated
        </span>
        {event.validationPass && (
          <Badge className="bg-success/10 text-success border-success/20 text-[10px]">
            Validated
          </Badge>
        )}
      </div>
      {event.durationMs != null && (
        <p className="text-xs text-muted-foreground">
          Generated in {Math.round(event.durationMs / 1000)}s
        </p>
      )}
      <div className="flex items-center gap-2">
        <Link href={`/admin/programs/${event.programId}`}>
          <Button size="sm">View Program</Button>
        </Link>
        <Button size="sm" variant="outline" onClick={onAssign}>
          <UserPlus className="size-3.5" />
          Assign
        </Button>
      </div>
    </motion.div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn("flex gap-2 px-4 py-1", isUser ? "flex-row-reverse" : "")}
    >
      <div
        className={cn(
          "size-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-accent/20 text-accent"
        )}
      >
        {isUser ? (
          <User className="size-3.5" />
        ) : (
          <Bot className="size-3.5" />
        )}
      </div>
      <div
        className={cn(
          "rounded-2xl px-3.5 py-2.5 max-w-[80%] text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-surface/50 border border-border text-foreground rounded-tl-sm"
        )}
      >
        {renderContent(message.content)}
        {message.status === "streaming" && (
          <span className="inline-block w-1.5 h-4 bg-current opacity-60 animate-pulse ml-0.5 -mb-0.5 rounded-sm" />
        )}
      </div>
    </motion.div>
  )
}

function renderContent(content: string) {
  const lines = content.split("\n")
  const elements: React.ReactNode[] = []
  let listItems: string[] = []
  let listType: "ul" | "ol" | null = null

  function flushList() {
    if (listItems.length === 0) return
    const Tag = listType === "ol" ? "ol" : "ul"
    elements.push(
      <Tag
        key={`list-${elements.length}`}
        className={cn(
          "my-1 pl-4 space-y-0.5",
          listType === "ol" ? "list-decimal" : "list-disc"
        )}
      >
        {listItems.map((item, i) => (
          <li key={i}>{formatBold(item)}</li>
        ))}
      </Tag>
    )
    listItems = []
    listType = null
  }

  for (const line of lines) {
    const bulletMatch = line.match(/^[-•]\s+(.+)/)
    const numberedMatch = line.match(/^\d+\.\s+(.+)/)

    if (bulletMatch) {
      if (listType !== "ul") flushList()
      listType = "ul"
      listItems.push(bulletMatch[1])
    } else if (numberedMatch) {
      if (listType !== "ol") flushList()
      listType = "ol"
      listItems.push(numberedMatch[1])
    } else {
      flushList()
      if (line.trim() === "") {
        elements.push(<div key={`sp-${elements.length}`} className="h-2" />)
      } else {
        elements.push(
          <p key={`p-${elements.length}`}>{formatBold(line)}</p>
        )
      }
    }
  }
  flushList()
  return <>{elements}</>
}

function formatBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <span key={i} className="font-semibold">
          {part.slice(2, -2)}
        </span>
      )
    }
    return part
  })
}

function TypingDots() {
  return (
    <div className="flex gap-2 px-4 py-1">
      <div className="size-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-accent/20 text-accent">
        <Bot className="size-3.5" />
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-surface/50 border border-border px-4 py-3 flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="size-1.5 rounded-full bg-muted-foreground/50"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

interface AiProgramChatDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AiProgramChatDialog({
  open,
  onOpenChange,
}: AiProgramChatDialogProps) {
  const router = useRouter()
  const [items, setItems] = useState<ChatItem[]>([WELCOME_MESSAGE])
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const sessionIdRef = useRef(`program-chat-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  // Assign dialog
  const [assignProgramId, setAssignProgramId] = useState<string | null>(null)
  const [clients, setClients] = useState<UserType[]>([])

  const [currentJobId, setCurrentJobId] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const idCounter = useRef(0)
  const nextId = useCallback((prefix: string) => `${prefix}-${++idCounter.current}`, [])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Firestore realtime listener for AI job
  const aiJob = useAiJob(currentJobId)
  const prevChunkCountRef = useRef(0)
  const jobAssistantIdRef = useRef("")

  // Process AI job chunks from Firestore
  useEffect(() => {
    if (!currentJobId) return

    const newChunks = aiJob.chunks.slice(prevChunkCountRef.current)
    if (newChunks.length === 0) return
    prevChunkCountRef.current = aiJob.chunks.length

    for (const chunk of newChunks) {
      switch (chunk.type) {
        case "delta": {
          const assistantId = jobAssistantIdRef.current
          setItems((prev) => {
            const exists = prev.some(
              (item) => item.kind === "message" && item.data.id === assistantId
            )
            if (!exists) {
              return [
                ...prev,
                {
                  kind: "message" as const,
                  data: {
                    id: assistantId,
                    role: "assistant" as const,
                    content: chunk.data.text as string,
                    status: "streaming" as const,
                  },
                },
              ]
            }
            return prev.map((item) =>
              item.kind === "message" && item.data.id === assistantId
                ? { ...item, data: { ...item.data, content: item.data.content + (chunk.data.text as string) } }
                : item
            )
          })
          break
        }

        case "tool_start": {
          // Flush current assistant message and start new one
          const flushedId = jobAssistantIdRef.current
          setItems((prev) => {
            const updated = prev.map((item) => {
              if (item.kind === "message" && item.data.id === flushedId && item.data.status === "streaming") {
                return item.data.content.trim()
                  ? { ...item, data: { ...item.data, status: "done" as const } }
                  : null
              }
              return item
            }).filter(Boolean) as ChatItem[]

            return [
              ...updated,
              {
                kind: "event" as const,
                data: {
                  id: nextId(`tool-${chunk.data.tool}`),
                  type: "tool_start" as const,
                  tool: chunk.data.tool as string,
                },
              },
            ]
          })
          jobAssistantIdRef.current = nextId("assistant")
          if (chunk.data.tool === "generate_program") setIsGenerating(true)
          break
        }

        case "tool_result": {
          setIsGenerating(false)
          setItems((prev) => {
            const lastToolIdx = prev.findLastIndex(
              (i) => i.kind === "event" && i.data.type === "tool_start" && i.data.tool === (chunk.data.tool as string)
            )
            if (lastToolIdx === -1) return prev
            const updated = [...prev]
            updated[lastToolIdx] = {
              kind: "event",
              data: {
                ...(updated[lastToolIdx] as Extract<ChatItem, { kind: "event" }>).data,
                type: "tool_result",
                summary: chunk.data.summary as string,
                error: !!chunk.data.error,
              },
            }
            return updated
          })
          break
        }

        case "program_created": {
          setIsGenerating(false)
          setItems((prev) => {
            const lastToolIdx = prev.findLastIndex(
              (i) => i.kind === "event" && i.data.tool === "generate_program"
            )
            const newItem: ChatItem = {
              kind: "event",
              data: {
                id: nextId("program"),
                type: "program_created",
                programId: chunk.data.programId as string,
                validationPass: chunk.data.validationPass as boolean,
                durationMs: chunk.data.durationMs as number,
              },
            }
            if (lastToolIdx === -1) return [...prev, newItem]
            const updated = [...prev]
            updated[lastToolIdx] = newItem
            return updated
          })
          router.refresh()
          break
        }

        case "error": {
          setIsGenerating(false)
          setItems((prev) => [
            ...prev,
            {
              kind: "message" as const,
              data: {
                id: nextId("error"),
                role: "assistant" as const,
                content: (chunk.data.message as string) ?? "Something went wrong. Please try again.",
                status: "error" as const,
              },
            },
          ])
          break
        }

        case "done": {
          const doneAssistantId = jobAssistantIdRef.current
          setItems((prev) =>
            prev.map((item) =>
              item.kind === "message" && item.data.id === doneAssistantId && item.data.status === "streaming"
                ? { ...item, data: { ...item.data, status: "done" as const } }
                : item
            )
          )
          setIsStreaming(false)
          setCurrentJobId(null)
          prevChunkCountRef.current = 0
          break
        }
      }
    }
  }, [currentJobId, aiJob.chunks, nextId, router])

  // Handle job failure from status
  useEffect(() => {
    if (!currentJobId) return
    if (aiJob.status === "failed" && aiJob.error) {
      setIsGenerating(false)
      setIsStreaming(false)
      setItems((prev) => [
        ...prev,
        {
          kind: "message" as const,
          data: {
            id: nextId("error"),
            role: "assistant" as const,
            content: aiJob.error ?? "Something went wrong.",
            status: "error" as const,
          },
        },
      ])
      setCurrentJobId(null)
      prevChunkCountRef.current = 0
    }
  }, [currentJobId, aiJob.status, aiJob.error, nextId])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [items, isStreaming])

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  // Fetch clients for assign dialog
  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users?role=client")
      if (res.ok) {
        const data = await res.json()
        setClients(data.users ?? data ?? [])
      }
    } catch {
      // Silent
    }
  }, [])

  useEffect(() => {
    if (open && clients.length === 0) fetchClients()
  }, [open, clients.length, fetchClients])

  // Reset on close
  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      abortRef.current?.abort()
      setItems([WELCOME_MESSAGE])
      setInput("")
      setIsStreaming(false)
      setIsGenerating(false)
      setAssignProgramId(null)
      sessionIdRef.current = `program-chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    onOpenChange(newOpen)
  }

  // Get conversation messages (only role+content, no events)
  function getConversationMessages() {
    return items
      .filter((i): i is Extract<ChatItem, { kind: "message" }> => i.kind === "message")
      .filter((i) => i.data.status === "done" && i.data.content.trim() !== "")
      .map((i) => ({ role: i.data.role, content: i.data.content }))
  }

  // ─── Send message ────────────────────────────────────────────────────────

  async function sendMessage() {
    const text = input.trim()
    if (!text || isStreaming) return

    // Add user message
    const userMsg: ChatItem = {
      kind: "message",
      data: {
        id: nextId("user"),
        role: "user",
        content: text,
        status: "done",
      },
    }
    setItems((prev) => [...prev, userMsg])
    setInput("")
    setIsStreaming(true)

    // Auto-resize textarea back
    if (inputRef.current) inputRef.current.style.height = "44px"

    // Set up assistant ID for the Firestore chunk processing effect
    jobAssistantIdRef.current = nextId("assistant")
    prevChunkCountRef.current = 0

    try {
      const messages = [
        ...getConversationMessages(),
        { role: "user" as const, content: text },
      ]

      const res = await fetch("/api/admin/programs/generate-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, session_id: sessionIdRef.current }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }))
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      const data = await res.json()
      setCurrentJobId(data.jobId)
      // Streaming is now handled by the useAiJob effect above
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong"
      setItems((prev) => [
        ...prev,
        {
          kind: "message",
          data: {
            id: nextId("error"),
            role: "assistant",
            content: message,
            status: "error",
          },
        },
      ])
      setIsStreaming(false)
      setIsGenerating(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    // Auto-resize
    const el = e.target
    el.style.height = "44px"
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  // ─── Assign dialog ──────────────────────────────────────────────────────

  if (assignProgramId) {
    return (
      <AssignProgramDialog
        open={open}
        onOpenChange={(o) => {
          if (!o) setAssignProgramId(null)
        }}
        programId={assignProgramId}
        clients={clients}
        assignedUserIds={[]}
      />
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl h-[80vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base font-heading font-semibold text-foreground">
            <MessageSquare className="size-4 text-accent" />
            AI Program Builder
          </DialogTitle>
        </DialogHeader>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto py-3 space-y-1">
          <AnimatePresence initial={false}>
            {items.map((item) => {
              if (item.kind === "message") {
                return (
                  <MessageBubble key={item.data.id} message={item.data} />
                )
              }

              // Event items
              const evt = item.data
              if (
                evt.type === "tool_start" &&
                evt.tool === "generate_program"
              ) {
                return <GeneratingIndicator key={evt.id} />
              }
              if (evt.type === "program_created") {
                return (
                  <ProgramResultCard
                    key={evt.id}
                    event={evt}
                    onAssign={() =>
                      evt.programId && setAssignProgramId(evt.programId)
                    }
                  />
                )
              }
              return <ToolStatusCard key={evt.id} event={evt} />
            })}
          </AnimatePresence>

          {isStreaming &&
            !items.some(
              (i) =>
                i.kind === "message" &&
                i.data.status === "streaming" &&
                i.data.content.length > 0
            ) &&
            !isGenerating && <TypingDots />}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t border-border px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                isStreaming
                  ? "Waiting for response..."
                  : "Tell me about the program you want to build..."
              }
              disabled={isStreaming}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              style={{ minHeight: "44px", maxHeight: "200px" }}
            />
            {isStreaming ? (
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-10 shrink-0 rounded-xl"
                onClick={() => abortRef.current?.abort()}
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                className="size-10 shrink-0 rounded-xl"
                onClick={sendMessage}
                disabled={!input.trim()}
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
