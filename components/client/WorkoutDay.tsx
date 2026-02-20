"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import {
  Dumbbell,
  Clock,
  Weight,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { AiCoachDialog } from "@/components/client/AiCoachDialog"
import { CelebrationOverlay } from "@/components/client/CelebrationOverlay"
import type { Exercise, ProgramExercise } from "@/types/database"
import type { WeightRecommendation } from "@/lib/weight-recommendation"

// ─── Types ──────────────────────────────────────────────────────────────────

interface ExerciseWithRecommendation {
  programExercise: ProgramExercise
  exercise: Exercise
  recommendation: WeightRecommendation
  loggedToday: boolean
}

interface WorkoutDayProps {
  day: number
  dayLabel: string
  exercises: ExerciseWithRecommendation[]
  assignmentId: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRestTime(seconds: number | null): string {
  if (!seconds) return ""
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60)
    const remaining = seconds % 60
    return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`
  }
  return `${seconds}s`
}

const RPE_LABELS: Record<number, string> = {
  1: "Very Light",
  2: "Light",
  3: "Light",
  4: "Moderate",
  5: "Moderate",
  6: "Moderate",
  7: "Somewhat Hard",
  8: "Hard",
  9: "Very Hard",
  10: "Max Effort",
}

function TrendIcon({ trend }: { trend: WeightRecommendation["trend"] }) {
  if (trend === "increasing")
    return <TrendingUp className="size-3 text-success" />
  if (trend === "decreasing")
    return <TrendingDown className="size-3 text-error" />
  return <Minus className="size-3 text-muted-foreground" />
}

// ─── Exercise Card ──────────────────────────────────────────────────────────

function ExerciseCard({
  programExercise: pe,
  exercise,
  recommendation: rec,
  loggedToday: initialLogged,
  assignmentId,
}: ExerciseWithRecommendation & { assignmentId: string }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [loggedToday, setLoggedToday] = useState(initialLogged)
  const [submitting, setSubmitting] = useState(false)
  const [showAiCoach, setShowAiCoach] = useState(false)
  const [showExtra, setShowExtra] = useState(false)
  const [celebrations, setCelebrations] = useState<
    Array<{
      achievement_type: string
      title: string
      description: string | null
      icon: string
    }>
  >([])

  // Form state
  const [weight, setWeight] = useState<string>(
    rec.recommended_kg != null ? String(rec.recommended_kg) : ""
  )
  const [sets, setSets] = useState<string>(pe.sets ? String(pe.sets) : "3")
  const [reps, setReps] = useState<string>(pe.reps || "")
  const [rpe, setRpe] = useState<number | null>(null)
  const [duration, setDuration] = useState<string>("")
  const [notes, setNotes] = useState<string>("")

  function handleUseRecommended() {
    if (rec.recommended_kg != null) {
      setWeight(String(rec.recommended_kg))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return

    setSubmitting(true)
    try {
      const res = await fetch("/api/client/workouts/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exercise_id: exercise.id,
          assignment_id: assignmentId,
          sets_completed: parseInt(sets, 10) || 1,
          reps_completed: reps || "0",
          weight_kg: weight ? parseFloat(weight) : null,
          rpe: rpe,
          duration_seconds: duration ? parseInt(duration, 10) : null,
          notes: notes || null,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to log workout")
      }

      toast.success(`${exercise.name} logged!`)
      setLoggedToday(true)
      setExpanded(false)

      // Check for achievements and trigger celebrations
      if (data.achievements && data.achievements.length > 0) {
        setCelebrations(data.achievements)
      }

      router.refresh()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to log workout"
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="px-4 py-3">
        {/* Collapsed row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-foreground text-sm truncate">
                {exercise.name}
              </p>
              {rec.recommended_kg != null && (
                <Badge
                  variant="outline"
                  className="shrink-0 gap-1 text-[10px] border-primary/20 text-primary"
                >
                  <TrendIcon trend={rec.trend} />
                  {rec.recommended_kg}kg
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              {pe.sets && pe.reps && (
                <span className="flex items-center gap-1">
                  <Dumbbell className="size-3" strokeWidth={1.5} />
                  {pe.sets} x {pe.reps}
                </span>
              )}
              {pe.duration_seconds && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" strokeWidth={1.5} />
                  {formatRestTime(pe.duration_seconds)}
                </span>
              )}
              {exercise.equipment && (
                <span className="flex items-center gap-1">
                  <Weight className="size-3" strokeWidth={1.5} />
                  {exercise.equipment}
                </span>
              )}
              {pe.rest_seconds && (
                <span className="text-muted-foreground/60">
                  Rest: {formatRestTime(pe.rest_seconds)}
                </span>
              )}
            </div>
          </div>

          {loggedToday ? (
            <CheckCircle2 className="size-5 text-success shrink-0" />
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1"
              onClick={() => setExpanded(!expanded)}
            >
              Log
              <ChevronDown
                className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </Button>
          )}
        </div>

        {/* Expanded log form */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <form onSubmit={handleSubmit} className="pt-4 space-y-4">
                {/* Recommendation card */}
                {rec.reasoning && (
                  <div className="rounded-lg bg-primary/5 border border-primary/10 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-primary leading-relaxed">
                        {rec.reasoning}
                      </p>
                      {rec.confidence !== "none" && (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px] capitalize"
                        >
                          {rec.confidence}
                        </Badge>
                      )}
                    </div>
                    {rec.recommended_kg != null && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-xs gap-1 h-7"
                        onClick={handleUseRecommended}
                      >
                        Use Recommended ({rec.recommended_kg}kg)
                      </Button>
                    )}
                  </div>
                )}

                {/* Weight & Sets & Reps */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`weight-${pe.id}`} className="text-xs">
                      Weight (kg)
                    </Label>
                    <Input
                      id={`weight-${pe.id}`}
                      type="number"
                      step="0.5"
                      min="0"
                      placeholder="0"
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`sets-${pe.id}`} className="text-xs">
                      Sets
                    </Label>
                    <Input
                      id={`sets-${pe.id}`}
                      type="number"
                      min="1"
                      max="20"
                      value={sets}
                      onChange={(e) => setSets(e.target.value)}
                      required
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`reps-${pe.id}`} className="text-xs">
                      Reps
                    </Label>
                    <Input
                      id={`reps-${pe.id}`}
                      type="text"
                      placeholder="8-12"
                      value={reps}
                      onChange={(e) => setReps(e.target.value)}
                      required
                      className="h-9"
                    />
                  </div>
                </div>

                {/* RPE Slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">
                      RPE (Rate of Perceived Exertion)
                    </Label>
                    <span className="text-xs font-medium text-primary">
                      {rpe != null
                        ? `${rpe} — ${RPE_LABELS[rpe] ?? ""}`
                        : "Not set"}
                    </span>
                  </div>
                  <Slider
                    min={1}
                    max={10}
                    step={1}
                    value={rpe != null ? [rpe] : undefined}
                    defaultValue={[5]}
                    onValueChange={(vals) => setRpe(vals[0])}
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Easy</span>
                    <span>Max</span>
                  </div>
                </div>

                {/* Collapsible extra fields */}
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowExtra(!showExtra)}
                >
                  {showExtra ? "Hide" : "Show"} duration & notes
                </button>

                <AnimatePresence>
                  {showExtra && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden space-y-3"
                    >
                      <div className="space-y-1.5">
                        <Label
                          htmlFor={`duration-${pe.id}`}
                          className="text-xs"
                        >
                          Duration (seconds)
                        </Label>
                        <Input
                          id={`duration-${pe.id}`}
                          type="number"
                          min="0"
                          placeholder="Optional"
                          value={duration}
                          onChange={(e) => setDuration(e.target.value)}
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`notes-${pe.id}`} className="text-xs">
                          Notes
                        </Label>
                        <Textarea
                          id={`notes-${pe.id}`}
                          placeholder="How did it feel?"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={2}
                          maxLength={500}
                          className="resize-none"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Action buttons */}
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={submitting || !reps}
                    className="gap-1"
                  >
                    {submitting ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3" />
                    )}
                    Save Workout
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => setShowAiCoach(true)}
                  >
                    <Sparkles className="size-3" />
                    AI Coach
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setExpanded(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AiCoachDialog
        open={showAiCoach}
        onOpenChange={setShowAiCoach}
        exerciseId={exercise.id}
        exerciseName={exercise.name}
      />

      <CelebrationOverlay
        achievements={celebrations}
        onComplete={() => setCelebrations([])}
      />
    </>
  )
}

// ─── WorkoutDay ─────────────────────────────────────────────────────────────

export function WorkoutDay({
  day,
  dayLabel,
  exercises,
  assignmentId,
}: WorkoutDayProps) {
  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="bg-surface px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-primary">
          {dayLabel ?? `Day ${day}`}
        </h3>
      </div>
      <div className="divide-y divide-border">
        {exercises.map((item) => (
          <ExerciseCard
            key={item.programExercise.id}
            {...item}
            assignmentId={assignmentId}
          />
        ))}
      </div>
    </div>
  )
}
