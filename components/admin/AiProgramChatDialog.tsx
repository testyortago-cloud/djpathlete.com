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

interface ProposedParams {
  id: string
  client_id?: string | null
  client_name?: string
  goals: string[]
  duration_weeks: number
  sessions_per_week: number
  session_minutes?: number
  split_type?: string
  periodization?: string
  additional_instructions?: string
  equipment_override?: string[]
  status: "pending" | "confirmed" | "modified"
}

type ChatItem =
  | { kind: "message"; data: ChatMessage }
  | { kind: "event"; data: ToolEvent }
  | { kind: "params"; data: ProposedParams }

// ─── LocalStorage persistence ────────────────────────────────────────────────

const PROGRAM_CHAT_STORAGE_KEY = "djp-program-chat-state"

interface StoredChatState {
  sessionId: string
  items: ChatItem[]
  savedAt: string
}

function loadChatState(): StoredChatState | null {
  try {
    const raw = localStorage.getItem(PROGRAM_CHAT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredChatState
    // Expire after 2 hours
    if (Date.now() - new Date(parsed.savedAt).getTime() > 2 * 60 * 60 * 1000) {
      localStorage.removeItem(PROGRAM_CHAT_STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function saveChatState(sessionId: string, items: ChatItem[]) {
  try {
    // Only save messages that are "done" (skip streaming/in-progress)
    const safeItems = items.filter(
      (item) => item.kind === "event" || item.kind === "params" || (item.kind === "message" && item.data.status !== "streaming")
    )
    const state: StoredChatState = {
      sessionId,
      items: safeItems,
      savedAt: new Date().toISOString(),
    }
    localStorage.setItem(PROGRAM_CHAT_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

function clearChatState() {
  try {
    localStorage.removeItem(PROGRAM_CHAT_STORAGE_KEY)
  } catch {
    // ignore
  }
}

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

const PROMPT_TEMPLATES = [
  {
    label: "Client Program",
    icon: "user",
    prompt:
      "Create a training program for [client name]. Look up their profile and build something tailored to their goals and equipment.",
  },
  {
    label: "Strength Focus",
    icon: "dumbbell",
    prompt:
      "Build a 12-week strength-focused program, 4 sessions per week, 60 minutes each. Focus on progressive overload with compound movements.",
  },
  {
    label: "Weight Loss",
    icon: "flame",
    prompt:
      "Create an 8-week weight loss program, 5 sessions per week, 45 minutes. Mix of resistance training and metabolic conditioning.",
  },
  {
    label: "Beginner Friendly",
    icon: "sparkles",
    prompt:
      "Design a 6-week beginner program, 3 sessions per week, 45 minutes. Full body sessions with simple exercises and clear progression.",
  },
] as const

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

interface PipelineStep {
  step: string
  current: number
  total: number
  detail?: string
}

const PIPELINE_LABELS = [
  "Analyzing client profile",
  "Designing program structure",
  "Selecting exercises",
  "Validating program",
  "Saving program",
]

function PipelineProgress({ steps }: { steps: PipelineStep[] }) {
  const latestStep = steps.length > 0 ? steps[steps.length - 1] : null
  const currentNum = latestStep?.current ?? 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3 mx-4 my-1"
    >
      <div className="flex items-center gap-2">
        <Loader2 className="size-4 animate-spin text-primary" />
        <span className="text-sm font-medium text-foreground">
          Building your program...
        </span>
      </div>
      <div className="space-y-1.5">
        {PIPELINE_LABELS.map((label, idx) => {
          const stepNum = idx + 1
          const isComplete = stepNum < currentNum
          const isActive = stepNum === currentNum
          const isPending = stepNum > currentNum
          const activeStep = steps.find((s) => s.current === stepNum)

          return (
            <div
              key={label}
              className={cn(
                "flex items-center gap-2 text-xs transition-colors",
                isComplete && "text-success",
                isActive && "text-primary font-medium",
                isPending && "text-muted-foreground/40"
              )}
            >
              {isComplete ? (
                <CheckCircle2 className="size-3.5 shrink-0" />
              ) : isActive ? (
                <Loader2 className="size-3.5 animate-spin shrink-0" />
              ) : (
                <div className="size-3.5 rounded-full border border-current shrink-0 opacity-50" />
              )}
              <span>{label}</span>
              {isActive && activeStep?.detail && (
                <span className="text-muted-foreground ml-1">
                  — {activeStep.detail}
                </span>
              )}
            </div>
          )
        })}
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

const GOAL_LABELS: Record<string, string> = {
  weight_loss: "Weight Loss",
  muscle_gain: "Muscle Gain",
  endurance: "Endurance",
  flexibility: "Flexibility",
  sport_specific: "Sport Specific",
  general_health: "General Health",
}

const SPLIT_LABELS: Record<string, string> = {
  full_body: "Full Body",
  upper_lower: "Upper/Lower",
  push_pull_legs: "Push/Pull/Legs",
  push_pull: "Push/Pull",
  body_part: "Body Part",
  movement_pattern: "Movement Pattern",
}

function ParametersCard({
  params,
  onGenerate,
  onModify,
  disabled,
}: {
  params: ProposedParams
  onGenerate: () => void
  onModify: () => void
  disabled: boolean
}) {
  const isConfirmed = params.status === "confirmed"

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3 mx-4 my-1"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">
          {params.client_name ? `Program for ${params.client_name}` : "Proposed Program"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div>
          <span className="text-muted-foreground">Goals:</span>{" "}
          <span className="text-foreground font-medium">
            {params.goals.map((g) => GOAL_LABELS[g] ?? g).join(", ")}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Duration:</span>{" "}
          <span className="text-foreground font-medium">{params.duration_weeks} weeks</span>
        </div>
        <div>
          <span className="text-muted-foreground">Sessions:</span>{" "}
          <span className="text-foreground font-medium">
            {params.sessions_per_week}x/week{params.session_minutes ? `, ${params.session_minutes}min` : ""}
          </span>
        </div>
        {params.split_type && (
          <div>
            <span className="text-muted-foreground">Split:</span>{" "}
            <span className="text-foreground font-medium">
              {SPLIT_LABELS[params.split_type] ?? params.split_type}
            </span>
          </div>
        )}
        {params.periodization && (
          <div>
            <span className="text-muted-foreground">Periodization:</span>{" "}
            <span className="text-foreground font-medium capitalize">{params.periodization}</span>
          </div>
        )}
        {params.equipment_override && params.equipment_override.length > 0 && (
          <div className="col-span-2">
            <span className="text-muted-foreground">Equipment:</span>{" "}
            <span className="text-foreground font-medium">{params.equipment_override.join(", ")}</span>
          </div>
        )}
        {params.additional_instructions && (
          <div className="col-span-2">
            <span className="text-muted-foreground">Notes:</span>{" "}
            <span className="text-foreground font-medium">{params.additional_instructions}</span>
          </div>
        )}
      </div>

      {!isConfirmed && (
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={onGenerate} disabled={disabled}>
            <Sparkles className="size-3.5 mr-1" />
            Generate Program
          </Button>
          <Button size="sm" variant="outline" onClick={onModify} disabled={disabled}>
            Modify
          </Button>
        </div>
      )}
      {isConfirmed && (
        <div className="flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 className="size-3.5" />
          <span>Confirmed — generating program...</span>
        </div>
      )}
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
  const [items, setItems] = useState<ChatItem[]>(() => {
    const stored = loadChatState()
    return stored ? stored.items : [WELCOME_MESSAGE]
  })
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const sessionIdRef = useRef(
    loadChatState()?.sessionId ?? `program-chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )

  // Assign dialog
  const [assignProgramId, setAssignProgramId] = useState<string | null>(null)
  const [clients, setClients] = useState<UserType[]>([])

  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([])

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

        case "pipeline_step": {
          const pStep: PipelineStep = {
            step: chunk.data.step as string,
            current: chunk.data.current as number,
            total: chunk.data.total as number,
            detail: (chunk.data.detail as string) ?? undefined,
          }
          setPipelineSteps((prev) => {
            const existing = prev.findIndex((s) => s.current === pStep.current)
            if (existing >= 0) {
              const updated = [...prev]
              updated[existing] = pStep
              return updated
            }
            return [...prev, pStep]
          })
          break
        }

        case "parameters_proposed": {
          // Remove the tool_start card for propose_parameters
          setItems((prev) => {
            const filtered = prev.filter(
              (i) => !(i.kind === "event" && i.data.type === "tool_start" && i.data.tool === "propose_parameters")
            )
            return [
              ...filtered,
              {
                kind: "params" as const,
                data: {
                  id: nextId("params"),
                  client_id: (chunk.data.client_id as string) ?? null,
                  client_name: (chunk.data.client_name as string) ?? undefined,
                  goals: (chunk.data.goals as string[]) ?? [],
                  duration_weeks: (chunk.data.duration_weeks as number) ?? 4,
                  sessions_per_week: (chunk.data.sessions_per_week as number) ?? 3,
                  session_minutes: (chunk.data.session_minutes as number) ?? undefined,
                  split_type: (chunk.data.split_type as string) ?? undefined,
                  periodization: (chunk.data.periodization as string) ?? undefined,
                  additional_instructions: (chunk.data.additional_instructions as string) ?? undefined,
                  equipment_override: (chunk.data.equipment_override as string[]) ?? undefined,
                  status: "pending" as const,
                },
              },
            ]
          })
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
          setPipelineSteps([])
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
          setPipelineSteps([])
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

  // Handle job completion, failure, or cancellation from status
  useEffect(() => {
    if (!currentJobId) return
    if (aiJob.status === "completed" && aiJob.result) {
      // Direct generate endpoint completed (no chunks emitted)
      // Only handle if we don't already have a program_created event from chunks
      const alreadyHasProgramCreated = items.some(
        (i) => i.kind === "event" && i.data.type === "program_created"
      )
      if (!alreadyHasProgramCreated && aiJob.result.program_id) {
        setIsGenerating(false)
        setIsStreaming(false)
        setPipelineSteps([])
        setItems((prev) => [
          ...prev,
          {
            kind: "event" as const,
            data: {
              id: nextId("program"),
              type: "program_created" as const,
              programId: aiJob.result!.program_id as string,
              validationPass: (aiJob.result!.validation as Record<string, unknown>)?.pass as boolean ?? true,
              durationMs: aiJob.result!.duration_ms as number ?? 0,
            },
          },
        ])
        setCurrentJobId(null)
        prevChunkCountRef.current = 0
        router.refresh()
      }
    } else if (aiJob.status === "failed" && aiJob.error) {
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
    } else if (aiJob.status === "cancelled") {
      setIsGenerating(false)
      setIsStreaming(false)
      setCurrentJobId(null)
      prevChunkCountRef.current = 0
      // Finalize any in-progress assistant message
      const assistantId = jobAssistantIdRef.current
      setItems((prev) =>
        prev.map((item) =>
          item.kind === "message" && item.data.id === assistantId && item.data.status === "streaming"
            ? { ...item, data: { ...item.data, status: "done" as const } }
            : item
        )
      )
    }
  }, [currentJobId, aiJob.status, aiJob.error, aiJob.result, nextId, items, router])

  // Persist chat state to localStorage when not streaming
  useEffect(() => {
    if (!isStreaming && items.length > 1) {
      saveChatState(sessionIdRef.current, items)
    }
  }, [items, isStreaming])

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

  // Reset on close — keep localStorage so it can be restored on reopen
  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      abortRef.current?.abort()
      setIsStreaming(false)
      setIsGenerating(false)
      setAssignProgramId(null)
      // Don't reset items/session — they're saved in localStorage for continuity
    }
    onOpenChange(newOpen)
  }

  // Start a fresh conversation (wipes localStorage)
  function handleNewChat() {
    if (isStreaming) return
    abortRef.current?.abort()
    setItems([WELCOME_MESSAGE])
    setInput("")
    setIsStreaming(false)
    setIsGenerating(false)
    setPipelineSteps([])
    setCurrentJobId(null)
    prevChunkCountRef.current = 0
    sessionIdRef.current = `program-chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
    clearChatState()
  }

  // Get conversation messages WITH tool context interleaved.
  // Tool events are embedded as assistant messages so the backend always
  // has full context for its summary fallback, even if ai_chat_state is lost.
  function getConversationMessages() {
    const result: Array<{ role: "user" | "assistant"; content: string }> = []
    let lastRole: "user" | "assistant" | null = null

    for (const item of items) {
      if (item.kind === "message" && item.data.status === "done" && item.data.content.trim()) {
        // Merge consecutive same-role messages to keep alternating pattern
        if (item.data.role === lastRole && result.length > 0) {
          result[result.length - 1].content += "\n\n" + item.data.content
        } else {
          result.push({ role: item.data.role, content: item.data.content })
          lastRole = item.data.role
        }
      } else if (item.kind === "params") {
        // Embed proposed parameters as assistant context
        const p = item.data
        const paramsText = `[Proposed parameters: goals=${p.goals.join(",")}, duration=${p.duration_weeks}wk, sessions=${p.sessions_per_week}x/wk${p.session_minutes ? `, ${p.session_minutes}min` : ""}${p.split_type ? `, split=${p.split_type}` : ""}${p.periodization ? `, periodization=${p.periodization}` : ""}, status=${p.status}]`
        if (lastRole === "assistant" && result.length > 0) {
          result[result.length - 1].content += "\n" + paramsText
        } else {
          result.push({ role: "assistant", content: paramsText })
          lastRole = "assistant"
        }
      } else if (
        item.kind === "event" &&
        (item.data.type === "tool_result" || item.data.type === "program_created")
      ) {
        // Embed tool results as part of the assistant context
        const toolName = item.data.tool ?? "tool"
        const summary = item.data.summary ?? "completed"
        const toolText = `[Used ${toolName}: ${summary}]`

        if (lastRole === "assistant" && result.length > 0) {
          result[result.length - 1].content += "\n" + toolText
        } else {
          result.push({ role: "assistant", content: toolText })
          lastRole = "assistant"
        }
      }
    }
    return result
  }

  // Get tool events history so backend can build calledTools set
  function getToolEvents() {
    return items
      .filter((i): i is Extract<ChatItem, { kind: "event" }> => i.kind === "event")
      .filter((i) => i.data.type === "tool_result" || i.data.type === "program_created")
      .map((i) => ({ tool: i.data.tool, summary: i.data.summary }))
  }

  // ─── Generate from proposed params (bypasses chat AI) ────────────────────

  async function handleGenerateFromParams(params: ProposedParams) {
    if (isStreaming) return

    // Mark params as confirmed
    setItems((prev) =>
      prev.map((item) =>
        item.kind === "params" && item.data.id === params.id
          ? { ...item, data: { ...item.data, status: "confirmed" as const } }
          : item
      )
    )

    setIsStreaming(true)
    setIsGenerating(true)
    jobAssistantIdRef.current = nextId("assistant")
    prevChunkCountRef.current = 0

    try {
      // Build generation request matching aiGenerationRequestSchema
      const genRequest: Record<string, unknown> = {
        goals: params.goals,
        duration_weeks: params.duration_weeks,
        sessions_per_week: params.sessions_per_week,
      }
      if (params.client_id) genRequest.client_id = params.client_id
      if (params.session_minutes) genRequest.session_minutes = params.session_minutes
      if (params.split_type) genRequest.split_type = params.split_type
      if (params.periodization) genRequest.periodization = params.periodization
      if (params.additional_instructions) genRequest.additional_instructions = params.additional_instructions
      if (params.equipment_override) genRequest.equipment_override = params.equipment_override

      // Call the direct generate endpoint (bypasses chat AI entirely)
      const res = await fetch("/api/admin/programs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(genRequest),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }))
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      const data = await res.json()
      setCurrentJobId(data.jobId)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong"
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

  function handleModifyParams() {
    setInput("")
    inputRef.current?.focus()
    // Set placeholder hint
    if (inputRef.current) {
      inputRef.current.placeholder = "Tell me what to change (e.g. 'make it 8 weeks instead')..."
    }
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

      let res: Response | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await fetch("/api/admin/programs/generate-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages, session_id: sessionIdRef.current, tool_events: getToolEvents() }),
        })
        if (res.status !== 429) break
        // Wait before retrying on rate limit
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
      }

      if (!res || !res.ok) {
        const data = await res?.json().catch(() => ({ error: "Request failed" })) ?? { error: "Request failed" }
        throw new Error(data.error || `HTTP ${res?.status}`)
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

  async function handleStop() {
    const jobId = currentJobId

    // Stop listening and reset streaming state
    setCurrentJobId(null)
    setIsStreaming(false)
    setIsGenerating(false)
    setPipelineSteps([])
    prevChunkCountRef.current = 0

    // Finalize any in-progress assistant message
    const assistantId = jobAssistantIdRef.current
    setItems((prev) =>
      prev.map((item) =>
        item.kind === "message" && item.data.id === assistantId && item.data.status === "streaming"
          ? { ...item, data: { ...item.data, status: "done" as const } }
          : item
      )
    )

    // Cancel the backend job so it stops processing
    if (jobId) {
      try {
        await fetch("/api/admin/programs/generate/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        })
      } catch {
        // Non-critical — the job will eventually time out
      }
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
        priceCents={null}
        clients={clients}
        assignedUserIds={[]}
      />
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl h-[80vh] max-h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-base font-heading font-semibold text-foreground">
              <MessageSquare className="size-4 text-accent" />
              AI Program Builder
            </DialogTitle>
            {items.length > 1 && !isStreaming && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNewChat}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                <Sparkles className="size-3 mr-1" />
                New Chat
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Messages area */}
        <div className="flex-1 min-h-0 overflow-y-auto py-3 space-y-1">
          <AnimatePresence initial={false}>
            {items.map((item) => {
              if (item.kind === "message") {
                return (
                  <MessageBubble key={item.data.id} message={item.data} />
                )
              }

              if (item.kind === "params") {
                return (
                  <ParametersCard
                    key={item.data.id}
                    params={item.data}
                    onGenerate={() => handleGenerateFromParams(item.data)}
                    onModify={handleModifyParams}
                    disabled={isStreaming}
                  />
                )
              }

              // Event items
              const evt = item.data
              if (
                evt.type === "tool_start" &&
                evt.tool === "generate_program"
              ) {
                return <PipelineProgress key={evt.id} steps={pipelineSteps} />
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

          {/* Prompt templates — show only on fresh chat */}
          {items.length === 1 && !isStreaming && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.1 }}
              className="grid grid-cols-2 gap-2 px-4 pt-2"
            >
              {PROMPT_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.label}
                  onClick={() => {
                    setInput(tpl.prompt)
                    inputRef.current?.focus()
                  }}
                  className="text-left rounded-xl border border-border bg-surface/30 hover:bg-surface/60 p-3 transition-colors group"
                >
                  <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors">
                    {tpl.label}
                  </span>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                    {tpl.prompt.slice(0, 80)}...
                  </p>
                </button>
              ))}
            </motion.div>
          )}

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
                onClick={handleStop}
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
