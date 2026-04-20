"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Sparkles, Loader2, CheckCircle2, XCircle, Layers } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useAiJob } from "@/hooks/use-ai-job"
import { TemplateSelector } from "@/components/admin/TemplateSelector"

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

// ─── Week mode props ───────────────────────────────────────────────────────

interface WeekModeProps {
  mode: "week"
  programId: string
  assignmentId?: string
  clientId?: string
  currentWeekCount: number
  onGenerated: (newWeekNumber: number) => void
  /** When set, fill this specific blank week instead of appending a new one */
  targetWeekNumber?: number
  poolExerciseIds?: string[]
}

// ─── Day mode props ────────────────────────────────────────────────────────

interface DayModeProps {
  mode: "day"
  programId: string
  assignmentId?: string
  clientId?: string
  weekNumber: number
  dayOfWeek: number
  onGenerated: () => void
  poolExerciseIds?: string[]
}

type GenerationDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
} & (WeekModeProps | DayModeProps)

export function GenerationDialog(props: GenerationDialogProps) {
  const { open, onOpenChange, mode } = props
  const router = useRouter()
  const [instructions, setInstructions] = useState("")
  const [jobId, setJobId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [usePool, setUsePool] = useState(true)

  const { status, result, error, reset } = useAiJob(jobId)

  const isGenerating = jobId !== null && (status === "pending" || status === "processing")
  const isComplete = status === "completed"
  const isFailed = status === "failed"

  const poolExerciseIds = props.poolExerciseIds ?? []
  const hasPool = poolExerciseIds.length > 0

  // Derive labels based on mode
  const isWeek = mode === "week"
  const isFillingBlank = isWeek && !!props.targetWeekNumber
  const weekLabel = isWeek ? (props.targetWeekNumber ?? props.currentWeekCount + 1) : props.weekNumber
  const dayName = !isWeek ? DAY_NAMES[props.dayOfWeek - 1] : null
  const entityLabel = isWeek ? `Week ${weekLabel}` : dayName!

  async function handleSubmit() {
    setIsSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        ...(props.assignmentId && { assignment_id: props.assignmentId }),
        ...(props.clientId && { client_id: props.clientId }),
        admin_instructions: instructions || undefined,
        ...(hasPool && usePool && { pool_exercise_ids: poolExerciseIds }),
      }

      if (isWeek) {
        body.target_week_number = props.targetWeekNumber ?? undefined
      } else {
        body.target_week_number = props.weekNumber
        body.target_day_of_week = props.dayOfWeek
      }

      const response = await fetch(`/api/admin/programs/${props.programId}/generate-week`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || `Failed to start ${mode} generation`)
      }

      const data = await response.json()
      setJobId(data.jobId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to generate ${mode}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const [isCancelling, setIsCancelling] = useState(false)

  async function handleCancel() {
    if (!jobId || isCancelling) return
    setIsCancelling(true)
    try {
      await fetch("/api/admin/programs/generate/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      })
    } catch {
      // Best-effort cancel
    }
    setJobId(null)
    setInstructions("")
    reset()
    setIsCancelling(false)
    onOpenChange(false)
  }

  function handleClose() {
    if (isGenerating) return
    if (isComplete) {
      if (isWeek) {
        const newWeekNumber = (result as { new_week_number?: number })?.new_week_number ?? weekLabel
        ;(props as WeekModeProps).onGenerated(newWeekNumber)
      } else {
        ;(props as DayModeProps).onGenerated()
      }
      router.refresh()
    }
    setJobId(null)
    setInstructions("")
    reset()
    onOpenChange(false)
  }

  function getProgressMessage(): string {
    if (status === "pending") return "Queued..."
    if (status === "processing") return `Generating ${entityLabel}...`
    if (status === "completed") {
      const r = result as { new_week_number?: number; exercises_added?: number } | null
      if (isWeek) {
        return `Week ${r?.new_week_number ?? weekLabel} generated with ${r?.exercises_added ?? 0} exercises!`
      }
      return `${dayName} generated with ${r?.exercises_added ?? 0} exercises!`
    }
    if (status === "failed") return error ?? "Generation failed"
    return ""
  }

  // Dialog text
  const title = isWeek
    ? isFillingBlank
      ? `AI Fill Week ${weekLabel}`
      : `AI Generate Week ${weekLabel}`
    : `AI Generate ${dayName}`

  const description = isWeek
    ? isFillingBlank
      ? `Fill blank Week ${weekLabel} with AI-generated exercises based on the program structure${props.clientId ? ", previous weeks, and the client\u2019s workout logs" : " and previous weeks"}.`
      : `Generate a new week based on the existing program structure${props.clientId ? " and the client\u2019s workout logs" : ""}. The AI will apply appropriate progression.`
    : `Fill ${dayName} in Week ${(props as DayModeProps).weekNumber} with AI-generated exercises based on the program structure${props.clientId ? ", previous weeks, and the client\u2019s workout logs" : " and previous weeks"}.`

  const placeholder = isWeek
    ? "e.g., Make it a deload week, increase squat volume, add more posterior chain work..."
    : "e.g., Upper body push focus, include bench press variations..."

  const helperText = isWeek
    ? "Leave blank for automatic progression based on performance data."
    : "Leave blank for automatic programming based on the week\u2019s structure."

  const completedButtonLabel = isWeek
    ? `View Week ${(result as { new_week_number?: number })?.new_week_number ?? weekLabel}`
    : "Done"

  return (
    <Dialog open={open} onOpenChange={isGenerating ? handleCancel : handleClose}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={isGenerating ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={
          isGenerating
            ? (e) => {
                e.preventDefault()
                handleCancel()
              }
            : undefined
        }
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {!isGenerating && !isComplete && !isFailed && (
          <div className="space-y-4">
            {hasPool && (
              <button
                type="button"
                className={`w-full flex items-center gap-2.5 rounded-lg border-2 px-3 py-2.5 text-left transition-colors ${
                  usePool ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"
                }`}
                onClick={() => setUsePool(!usePool)}
              >
                <div
                  className={`flex items-center justify-center size-5 rounded border-2 transition-colors ${
                    usePool ? "border-primary bg-primary" : "border-muted-foreground/30"
                  }`}
                >
                  {usePool && (
                    <svg
                      className="size-3 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Layers className="size-3.5 text-primary" />
                    <span className="text-sm font-medium">Use Exercise Pool</span>
                    <span className="text-[10px] font-medium bg-primary/10 text-primary rounded-full px-1.5 py-0.5">
                      {poolExerciseIds.length}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    AI will select from your curated exercises only
                  </p>
                </div>
              </button>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="gen-instructions">Coach Instructions (optional)</Label>
                <TemplateSelector
                  scope={isWeek ? "week" : "day"}
                  currentText={instructions}
                  onSelect={(prompt) => setInstructions((prev) => (prev ? `${prev}\n\n${prompt}` : prompt))}
                />
              </div>
              <Textarea
                id="gen-instructions"
                placeholder={placeholder}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={8}
                maxLength={2000}
                disabled={isSubmitting}
                className="field-sizing-fixed resize-none"
              />
              <p className="text-xs text-muted-foreground">{helperText}</p>
            </div>
          </div>
        )}

        {(isGenerating || isComplete || isFailed) && (
          <div className="flex flex-col items-center gap-3 py-4">
            {isGenerating && <Loader2 className="size-8 text-accent animate-spin" />}
            {isComplete && <CheckCircle2 className="size-8 text-success" />}
            {isFailed && <XCircle className="size-8 text-destructive" />}
            <p className="text-sm text-center text-muted-foreground">{getProgressMessage()}</p>
          </div>
        )}

        <DialogFooter>
          {isGenerating && (
            <Button variant="outline" onClick={handleCancel} disabled={isCancelling}>
              {isCancelling ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Cancelling...
                </>
              ) : (
                "Cancel Generation"
              )}
            </Button>
          )}
          {!isGenerating && !isComplete && (
            <>
              <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={isSubmitting} className="gap-1.5">
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" />
                    Generate
                  </>
                )}
              </Button>
            </>
          )}
          {isComplete && <Button onClick={handleClose}>{completedButtonLabel}</Button>}
          {isFailed && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button
                onClick={() => {
                  setJobId(null)
                  reset()
                }}
              >
                Try Again
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
