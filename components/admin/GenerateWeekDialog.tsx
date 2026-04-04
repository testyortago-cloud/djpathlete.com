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
import { Switch } from "@/components/ui/switch"
import { useAiJob } from "@/hooks/use-ai-job"
import { TemplateSelector } from "@/components/admin/TemplateSelector"

interface GenerateWeekDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  programId: string
  assignmentId?: string
  clientId?: string
  currentWeekCount: number
  onWeekGenerated: (newWeekNumber: number) => void
  /** When set, fill this specific blank week instead of appending a new one */
  targetWeekNumber?: number
  poolExerciseIds?: string[]
}

export function GenerateWeekDialog({
  open,
  onOpenChange,
  programId,
  assignmentId,
  clientId,
  currentWeekCount,
  onWeekGenerated,
  targetWeekNumber,
  poolExerciseIds = [],
}: GenerateWeekDialogProps) {
  const router = useRouter()
  const [instructions, setInstructions] = useState("")
  const [ignoreProfile, setIgnoreProfile] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [usePool, setUsePool] = useState(true)

  const { status, result, error, reset } = useAiJob(jobId)

  const isGenerating = jobId !== null && (status === "pending" || status === "processing")
  const isComplete = status === "completed"
  const isFailed = status === "failed"

  const isFillingBlank = !!targetWeekNumber
  const weekLabel = targetWeekNumber ?? currentWeekCount + 1
  const hasPool = poolExerciseIds.length > 0

  async function handleSubmit() {
    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/admin/programs/${programId}/generate-week`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(assignmentId && { assignment_id: assignmentId }),
          ...(clientId && { client_id: clientId }),
          admin_instructions: instructions || undefined,
          target_week_number: targetWeekNumber ?? undefined,
          ...(hasPool && usePool && { pool_exercise_ids: poolExerciseIds }),
          ...(ignoreProfile && { ignore_profile: true }),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to start week generation")
      }

      const data = await response.json()
      setJobId(data.jobId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate week")
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleClose() {
    if (isGenerating) return
    if (isComplete && result) {
      const newWeekNumber = (result as { new_week_number?: number }).new_week_number ?? weekLabel
      onWeekGenerated(newWeekNumber)
      router.refresh()
    }
    setJobId(null)
    setInstructions("")
    setIgnoreProfile(false)
    reset()
    onOpenChange(false)
  }

  function getProgressMessage(): string {
    if (status === "pending") return "Queued..."
    if (status === "processing") return "Generating week..."
    if (status === "completed") {
      const r = result as { new_week_number?: number; exercises_added?: number } | null
      return `Week ${r?.new_week_number ?? weekLabel} generated with ${r?.exercises_added ?? 0} exercises!`
    }
    if (status === "failed") return error ?? "Generation failed"
    return ""
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" />
            {isFillingBlank ? `AI Fill Week ${weekLabel}` : `AI Generate Week ${weekLabel}`}
          </DialogTitle>
          <DialogDescription>
            {isFillingBlank
              ? `Fill blank Week ${weekLabel} with AI-generated exercises based on the program structure${clientId ? ", previous weeks, and the client\u2019s workout logs" : " and previous weeks"}.`
              : `Generate a new week based on the existing program structure${clientId ? " and the client\u2019s workout logs" : ""}. The AI will apply appropriate progression.`}
          </DialogDescription>
        </DialogHeader>

        {!isGenerating && !isComplete && !isFailed && (
          <div className="space-y-4">
            {hasPool && (
              <button
                type="button"
                className={`w-full flex items-center gap-2.5 rounded-lg border-2 px-3 py-2.5 text-left transition-colors ${
                  usePool
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/30"
                }`}
                onClick={() => setUsePool(!usePool)}
              >
                <div className={`flex items-center justify-center size-5 rounded border-2 transition-colors ${
                  usePool ? "border-primary bg-primary" : "border-muted-foreground/30"
                }`}>
                  {usePool && (
                    <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
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

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="week-ignore-profile" className="text-sm font-medium cursor-pointer">
                  Ignore athlete profile
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  {clientId
                    ? "Skip the client\u2019s profile and create from your instructions"
                    : "Generate based on your instructions only"}
                </p>
              </div>
              <Switch
                id="week-ignore-profile"
                checked={ignoreProfile}
                onCheckedChange={setIgnoreProfile}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="instructions">
                  {ignoreProfile ? "Coach Instructions (recommended)" : "Coach Instructions (optional)"}
                </Label>
                <TemplateSelector onSelect={(prompt) => setInstructions((prev) => prev ? `${prev}\n\n${prompt}` : prompt)} />
              </div>
              <Textarea
                id="instructions"
                placeholder={
                  ignoreProfile
                    ? "Describe what you want — focus areas, intensity, techniques..."
                    : "e.g., Make it a deload week, increase squat volume, add more posterior chain work..."
                }
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={3}
                maxLength={2000}
                disabled={isSubmitting}
              />
              {!ignoreProfile && (
                <p className="text-xs text-muted-foreground">
                  Leave blank for automatic progression based on performance data.
                </p>
              )}
            </div>
          </div>
        )}

        {(isGenerating || isComplete || isFailed) && (
          <div className="flex flex-col items-center gap-3 py-4">
            {isGenerating && (
              <Loader2 className="size-8 text-accent animate-spin" />
            )}
            {isComplete && (
              <CheckCircle2 className="size-8 text-success" />
            )}
            {isFailed && (
              <XCircle className="size-8 text-destructive" />
            )}
            <p className="text-sm text-center text-muted-foreground">
              {getProgressMessage()}
            </p>
          </div>
        )}

        <DialogFooter>
          {!isGenerating && !isComplete && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="gap-1.5"
              >
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
          {isComplete && (
            <Button onClick={handleClose}>
              View Week {(result as { new_week_number?: number })?.new_week_number ?? weekLabel}
            </Button>
          )}
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
