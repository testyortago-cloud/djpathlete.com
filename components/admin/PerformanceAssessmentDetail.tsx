"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { VideoPlayer } from "@/components/shared/VideoPlayer"
import { YouTubeEmbed } from "@/components/shared/YouTubeEmbed"
import { AssessmentExerciseThread } from "@/components/shared/AssessmentExerciseThread"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  CheckCircle2,
  Clock,
  MessageSquare,
  FileEdit,
  Loader2,
  Share2,
  ChevronDown,
  ChevronUp,
  Youtube,
  Video,
  Trash2,
  Ruler,
  Save,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { PerformanceAssessmentStatus } from "@/types/database"

interface AssessmentExercise {
  id: string
  exercise_id: string | null
  custom_name: string | null
  youtube_url: string | null
  video_path: string | null
  admin_notes: string | null
  result_value: number | null
  result_unit: string | null
  order_index: number
  exercises?: { id: string; name: string } | null
}

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

interface PerformanceAssessmentDetailProps {
  assessment: {
    id: string
    title: string
    notes: string | null
    status: string
    created_at: string
    client_user_id: string
    users?: {
      id: string
      first_name: string
      last_name: string
      email: string
      avatar_url?: string | null
    } | null
  }
  exercises: AssessmentExercise[]
  messagesMap: Record<string, Message[]>
  videoUrlsMap: Record<string, string>
  currentUserId: string
}

const statusConfig: Record<PerformanceAssessmentStatus, { label: string; icon: typeof Clock; className: string }> = {
  draft: { label: "Draft", icon: FileEdit, className: "bg-gray-100 text-gray-700" },
  in_progress: { label: "In Progress", icon: MessageSquare, className: "bg-blue-100 text-blue-700" },
  completed: { label: "Completed", icon: CheckCircle2, className: "bg-green-100 text-green-700" },
}

export function PerformanceAssessmentDetail({
  assessment,
  exercises,
  messagesMap,
  videoUrlsMap,
  currentUserId,
}: PerformanceAssessmentDetailProps) {
  const router = useRouter()
  const [status, setStatus] = useState(assessment.status as PerformanceAssessmentStatus)
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(new Set(exercises.map((e) => e.id)))
  const [results, setResults] = useState<Record<string, { value: string; unit: string }>>(() => {
    const initial: Record<string, { value: string; unit: string }> = {}
    for (const ex of exercises) {
      initial[ex.id] = {
        value: ex.result_value != null ? String(ex.result_value) : "",
        unit: ex.result_unit ?? "",
      }
    }
    return initial
  })
  const [savingResult, setSavingResult] = useState<string | null>(null)

  const config = statusConfig[status]
  const StatusIcon = config.icon
  const clientName = assessment.users ? `${assessment.users.first_name} ${assessment.users.last_name}` : "Unknown"

  async function updateStatus(newStatus: PerformanceAssessmentStatus) {
    setUpdating(true)
    try {
      const res = await fetch(`/api/admin/performance-assessments/${assessment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error("Failed to update status")
      setStatus(newStatus)
      toast.success(newStatus === "in_progress" ? "Assessment shared with client" : "Assessment marked as completed")
      router.refresh()
    } catch {
      toast.error("Failed to update status")
    } finally {
      setUpdating(false)
    }
  }

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this assessment? This cannot be undone.")) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/performance-assessments/${assessment.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete")
      toast.success("Assessment deleted")
      router.push("/admin/performance-assessments")
    } catch {
      toast.error("Failed to delete assessment")
    } finally {
      setDeleting(false)
    }
  }

  async function saveResult(exerciseId: string) {
    const r = results[exerciseId]
    if (!r) return

    setSavingResult(exerciseId)
    try {
      const res = await fetch(`/api/admin/performance-assessments/${assessment.id}/exercises/${exerciseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result_value: r.value ? parseFloat(r.value) : null,
          result_unit: r.unit.trim() || null,
        }),
      })
      if (!res.ok) throw new Error("Failed to save result")
      toast.success("Result saved")
    } catch {
      toast.error("Failed to save result")
    } finally {
      setSavingResult(null)
    }
  }

  function toggleExercise(id: string) {
    setExpandedExercises((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-primary">{assessment.title}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
            <span>{clientName}</span>
            <span className="text-border">|</span>
            <span>
              {new Date(assessment.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <span className="text-border">|</span>
            <span>{exercises.length} exercises</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full",
              config.className,
            )}
          >
            <StatusIcon className="size-3.5" />
            {config.label}
          </span>
          {status === "draft" && (
            <Button size="sm" onClick={() => updateStatus("in_progress")} disabled={updating}>
              {updating ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Share2 className="size-4 mr-1.5" />}
              Share with Client
            </Button>
          )}
          {status === "in_progress" && (
            <Button size="sm" variant="outline" onClick={() => updateStatus("completed")} disabled={updating}>
              {updating ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4 mr-1.5" />
              )}
              Mark Complete
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleDelete}
            disabled={deleting}
            className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
          >
            {deleting ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Trash2 className="size-4 mr-1.5" />}
            Delete
          </Button>
        </div>
      </div>

      {/* Assessment notes */}
      {assessment.notes && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-1">Assessment Notes</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{assessment.notes}</p>
        </div>
      )}

      {/* Exercise list */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Exercises</h2>
        {exercises.map((exercise, index) => {
          const exerciseName = exercise.exercises?.name ?? exercise.custom_name ?? "Unnamed"
          const isExpanded = expandedExercises.has(exercise.id)
          const messages = messagesMap[exercise.id] ?? []
          const videoUrl = videoUrlsMap[exercise.id]
          const hasVideo = !!exercise.video_path

          return (
            <div key={exercise.id} className="bg-white rounded-xl border border-border overflow-hidden">
              {/* Exercise header */}
              <button
                type="button"
                onClick={() => toggleExercise(exercise.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-surface/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground w-6">{index + 1}.</span>
                  <span className="text-sm font-medium text-foreground">{exerciseName}</span>
                  {exercise.youtube_url && <Youtube className="size-4 text-red-500" />}
                  {hasVideo && <Video className="size-4 text-green-600" />}
                  {exercise.result_value != null && (
                    <span className="text-xs bg-accent/15 text-accent-foreground px-1.5 py-0.5 rounded-full font-medium">
                      {exercise.result_value}
                      {exercise.result_unit ? ` ${exercise.result_unit}` : ""}
                    </span>
                  )}
                  {messages.length > 0 && (
                    <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                      {messages.length} {messages.length === 1 ? "message" : "messages"}
                    </span>
                  )}
                </div>
                {isExpanded ? (
                  <ChevronUp className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-4 text-muted-foreground" />
                )}
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t border-border p-4 space-y-4">
                  {/* Coach notes */}
                  {exercise.admin_notes && (
                    <div className="bg-surface rounded-lg p-3">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Coach Notes</p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{exercise.admin_notes}</p>
                    </div>
                  )}

                  {/* Result input */}
                  <div className="bg-surface rounded-lg p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Ruler className="size-3.5" />
                      Result
                    </p>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="any"
                        placeholder="Value"
                        value={results[exercise.id]?.value ?? ""}
                        onChange={(e) =>
                          setResults((prev) => ({
                            ...prev,
                            [exercise.id]: {
                              ...prev[exercise.id],
                              value: e.target.value,
                            },
                          }))
                        }
                        className="h-9 w-28"
                      />
                      <Input
                        type="text"
                        placeholder="Unit (e.g. inches, seconds)"
                        value={results[exercise.id]?.unit ?? ""}
                        onChange={(e) =>
                          setResults((prev) => ({
                            ...prev,
                            [exercise.id]: {
                              ...prev[exercise.id],
                              unit: e.target.value,
                            },
                          }))
                        }
                        className="h-9 w-48"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => saveResult(exercise.id)}
                        disabled={savingResult === exercise.id}
                        className="h-9"
                      >
                        {savingResult === exercise.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Save className="size-3.5" />
                        )}
                      </Button>
                    </div>
                    {exercise.result_value != null && (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Current:{" "}
                        <span className="font-medium text-foreground">
                          {exercise.result_value}
                          {exercise.result_unit ? ` ${exercise.result_unit}` : ""}
                        </span>
                      </p>
                    )}
                  </div>

                  {/* YouTube example */}
                  {exercise.youtube_url && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                        <Youtube className="size-3.5 text-red-500" />
                        Example Video
                      </p>
                      <YouTubeEmbed url={exercise.youtube_url} className="max-w-lg" />
                    </div>
                  )}

                  {/* Client video */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Video className="size-3.5" />
                      Client Video
                    </p>
                    {videoUrl ? (
                      <VideoPlayer src={videoUrl} className="max-w-lg" />
                    ) : (
                      <div className="bg-muted rounded-xl p-6 text-center text-sm text-muted-foreground max-w-lg">
                        {status === "draft"
                          ? "Client will upload after you share the assessment"
                          : "Client hasn't uploaded a video yet"}
                      </div>
                    )}
                  </div>

                  {/* Thread */}
                  <div className="border-t border-border pt-4">
                    <AssessmentExerciseThread
                      messages={messages}
                      currentUserId={currentUserId}
                      assessmentId={assessment.id}
                      exerciseId={exercise.id}
                      apiBasePath="/api/admin/performance-assessments"
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
