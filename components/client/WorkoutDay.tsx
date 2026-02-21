"use client"

import { useState, useEffect, useRef } from "react"
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
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
  Play,
  Check,
  Lightbulb,
  Plus,
  X,
  ArrowLeftRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { useWeightUnit } from "@/hooks/use-weight-unit"
import { CoachDjpPanel } from "@/components/client/CoachDjpPanel"
import { CelebrationOverlay } from "@/components/client/CelebrationOverlay"
import { ExerciseSwapSheet } from "@/components/client/ExerciseSwapSheet"
import { extractYouTubeId } from "@/lib/youtube"
import type { Exercise, ProgramExercise, TrainingTechnique } from "@/types/database"
import type { WeightRecommendation } from "@/lib/weight-recommendation"

// ─── Types ──────────────────────────────────────────────────────────────────

interface SetRow {
  weight: string
  reps: string
  rpe: number | null
}

export interface ExerciseWithRecommendation {
  programExercise: ProgramExercise
  exercise: Exercise
  recommendation: WeightRecommendation
  loggedToday: boolean
}

export interface WorkoutDayProps {
  day: number
  dayLabel: string
  exercises: ExerciseWithRecommendation[]
  assignmentId: string
  onExerciseLogged?: (exerciseId: string) => void
}

interface ExerciseGroup {
  tag: string | null
  technique: TrainingTechnique
  exercises: ExerciseWithRecommendation[]
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

const MUSCLE_GROUP_COLORS: Record<string, string> = {
  chest: "bg-red-100 text-red-700",
  pectorals: "bg-red-100 text-red-700",
  back: "bg-blue-100 text-blue-700",
  lats: "bg-blue-100 text-blue-700",
  traps: "bg-blue-100 text-blue-700",
  legs: "bg-green-100 text-green-700",
  quadriceps: "bg-green-100 text-green-700",
  quads: "bg-green-100 text-green-700",
  hamstrings: "bg-green-100 text-green-700",
  calves: "bg-green-100 text-green-700",
  shoulders: "bg-violet-100 text-violet-700",
  deltoids: "bg-violet-100 text-violet-700",
  delts: "bg-violet-100 text-violet-700",
  biceps: "bg-orange-100 text-orange-700",
  triceps: "bg-orange-100 text-orange-700",
  arms: "bg-orange-100 text-orange-700",
  forearms: "bg-orange-100 text-orange-700",
  core: "bg-yellow-100 text-yellow-700",
  abs: "bg-yellow-100 text-yellow-700",
  abdominals: "bg-yellow-100 text-yellow-700",
  glutes: "bg-pink-100 text-pink-700",
  "hip flexors": "bg-pink-100 text-pink-700",
  "full body": "bg-primary/10 text-primary",
}

function getMuscleGroupColor(group: string | null): string {
  if (!group) return "bg-muted text-muted-foreground"
  const key = group.toLowerCase().trim()
  return MUSCLE_GROUP_COLORS[key] ?? "bg-muted text-muted-foreground"
}

function formatTempo(tempo: string): string {
  return tempo.split("").join("-")
}

function getGroupLabel(technique: TrainingTechnique): string {
  switch (technique) {
    case "superset":
      return "Superset"
    case "giant_set":
      return "Giant Set"
    case "circuit":
      return "Circuit"
    case "dropset":
      return "Drop Set"
    case "rest_pause":
      return "Rest-Pause"
    case "amrap":
      return "AMRAP"
    default:
      return "Superset"
  }
}

function groupExercisesByTag(
  exercises: ExerciseWithRecommendation[]
): ExerciseGroup[] {
  const groups: ExerciseGroup[] = []
  for (const item of exercises) {
    const tag = item.programExercise.group_tag
    const lastGroup = groups[groups.length - 1]
    if (tag && lastGroup && lastGroup.tag === tag) {
      lastGroup.exercises.push(item)
    } else {
      groups.push({
        tag,
        technique: item.programExercise.technique,
        exercises: [item],
      })
    }
  }
  return groups
}

function TrendIcon({ trend }: { trend: WeightRecommendation["trend"] }) {
  if (trend === "increasing")
    return <TrendingUp className="size-3 text-success" />
  if (trend === "decreasing")
    return <TrendingDown className="size-3 text-error" />
  return <Minus className="size-3 text-muted-foreground" />
}

/** Detect concerning patterns in set data worth nudging the coach for */
function shouldNudgeCoach(rows: SetRow[]): boolean {
  const filled = rows.filter((r) => parseInt(r.reps, 10) > 0)
  if (filled.length < 2) return false

  for (let i = 1; i < filled.length; i++) {
    const prevReps = parseInt(filled[i - 1].reps, 10)
    const currReps = parseInt(filled[i].reps, 10)
    // Reps dropped by 2+
    if (prevReps - currReps >= 2) return true

    const prevRpe = filled[i - 1].rpe
    const currRpe = filled[i].rpe
    // RPE spiked by 2+
    if (prevRpe != null && currRpe != null && currRpe - prevRpe >= 2) return true
  }

  return false
}

/** Create initial set rows from prescribed sets count */
function createInitialSetRows(
  numSets: number,
  defaultWeight: string,
  defaultReps: string
): SetRow[] {
  return Array.from({ length: numSets }, () => ({
    weight: defaultWeight,
    reps: defaultReps,
    rpe: null,
  }))
}

// ─── Exercise Video Sheet ───────────────────────────────────────────────────

function ExerciseVideoSheet({
  open,
  onOpenChange,
  videoUrl,
  exerciseName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  videoUrl: string
  exerciseName: string
}) {
  const videoId = extractYouTubeId(videoUrl)
  if (!videoId) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="px-4 pb-8 pt-4 max-h-[85dvh]">
        <SheetHeader className="p-0 pb-2">
          <SheetTitle className="text-sm">{exerciseName}</SheetTitle>
          <SheetDescription className="sr-only">
            Exercise demonstration video
          </SheetDescription>
        </SheetHeader>
        <div className="relative w-full overflow-hidden rounded-lg bg-black aspect-video">
          {open && (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`}
              title={`${exerciseName} demonstration`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 size-full border-0"
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Exercise Card ──────────────────────────────────────────────────────────

function ExerciseCard({
  programExercise: pe,
  exercise,
  recommendation: rec,
  loggedToday: initialLogged,
  assignmentId,
  index,
  onLogged,
  hideNotes,
}: ExerciseWithRecommendation & {
  assignmentId: string
  index: number
  onLogged?: () => void
  hideNotes?: boolean
}) {
  const router = useRouter()
  const { unit, displayWeight, formatWeightCompact, toKg, unitLabel } = useWeightUnit()
  const [expanded, setExpanded] = useState(false)
  const [loggedToday, setLoggedToday] = useState(initialLogged)
  const [submitting, setSubmitting] = useState(false)
  const [showCoachDjp, setShowCoachDjp] = useState(false)
  const [showVideo, setShowVideo] = useState(false)
  const [showExtra, setShowExtra] = useState(false)
  const [showSwap, setShowSwap] = useState(false)
  const [swappedExercise, setSwappedExercise] = useState<Exercise | null>(null)

  // Use swapped exercise for display, but keep original programExercise for sets/reps
  const displayExercise = swappedExercise ?? exercise

  const hasVideo = Boolean(
    displayExercise.video_url && extractYouTubeId(displayExercise.video_url)
  )
  const [celebrations, setCelebrations] = useState<
    Array<{
      achievement_type: string
      title: string
      description: string | null
      icon: string
    }>
  >([])

  // Parse prescribed reps for default (use lower end of range like "8" from "8-12")
  const prescribedReps = pe.reps?.match(/(\d+)/)?.[1] ?? ""
  const displayedRec = displayWeight(rec.recommended_kg)
  const defaultWeight = displayedRec != null ? String(displayedRec) : ""
  const weightPlaceholder = displayedRec != null ? String(displayedRec) : "0"
  const numSets = pe.sets ?? 3

  // Multi-set state
  const [setRows, setSetRows] = useState<SetRow[]>(() =>
    createInitialSetRows(numSets, defaultWeight, prescribedReps)
  )
  const [duration, setDuration] = useState<string>("")
  const [notes, setNotes] = useState<string>("")
  const [aiSuggestedWeight, setAiSuggestedWeight] = useState<number | null>(null)

  function updateSetRow(idx: number, field: keyof SetRow, value: string | number | null) {
    setSetRows((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row))
    )
  }

  function addSet() {
    if (setRows.length >= 20) return
    const lastRow = setRows[setRows.length - 1]
    setSetRows((prev) => [
      ...prev,
      {
        weight: lastRow?.weight ?? "",
        reps: lastRow?.reps ?? "",
        rpe: null,
      },
    ])
  }

  function removeSet(idx: number) {
    if (setRows.length <= 1) return
    setSetRows((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleApplyWeight(kg: number) {
    const display = displayWeight(kg)
    setSetRows((prev) =>
      prev.map((row) => ({ ...row, weight: display != null ? String(display) : "" }))
    )
  }

  function handleAiApplyWeight(kg: number) {
    setAiSuggestedWeight(kg)
    const display = displayWeight(kg)
    // Only apply to sets that haven't been completed yet (no reps entered)
    setSetRows((prev) =>
      prev.map((row) => {
        const hasReps = parseInt(row.reps, 10) > 0
        return hasReps ? row : { ...row, weight: display != null ? String(display) : "" }
      })
    )
  }

  function handleUseRecommended() {
    const weight = aiSuggestedWeight ?? rec.recommended_kg
    if (weight != null) {
      handleApplyWeight(weight)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return

    // Build set_details array — convert display values back to kg
    const setDetails = setRows.map((row, i) => ({
      set_number: i + 1,
      weight_kg: row.weight ? toKg(parseFloat(row.weight)) : null,
      reps: parseInt(row.reps, 10) || 0,
      rpe: row.rpe,
    }))

    // Compute aggregates for backward-compatible flat fields
    const maxWeight = Math.max(...setDetails.map((s) => s.weight_kg ?? 0), 0)
    const totalReps = setDetails.map((s) => s.reps)
    const avgReps = totalReps.length > 0
      ? Math.round(totalReps.reduce((a, b) => a + b, 0) / totalReps.length)
      : 0
    const lastSetRpe = setDetails[setDetails.length - 1]?.rpe ?? null

    setSubmitting(true)
    try {
      const res = await fetch("/api/client/workouts/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exercise_id: swappedExercise ? swappedExercise.id : pe.exercise_id,
          assignment_id: assignmentId,
          sets_completed: setDetails.length,
          reps_completed: String(avgReps),
          weight_kg: maxWeight > 0 ? maxWeight : null,
          rpe: lastSetRpe,
          duration_seconds: duration ? parseInt(duration, 10) : null,
          notes: notes || null,
          set_details: setDetails,
          ai_next_weight_kg: aiSuggestedWeight,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to log workout")
      }

      toast.success(`${displayExercise.name} logged!`)
      setLoggedToday(true)
      setExpanded(false)
      onLogged?.()

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

  // Check if at least one set has reps entered
  const hasValidSets = setRows.some((row) => parseInt(row.reps, 10) > 0)

  // Auto-show duration & notes when all sets are filled
  const allSetsFilled = setRows.length > 0 && setRows.every((row) => parseInt(row.reps, 10) > 0)
  const autoShowTriggeredRef = useRef(false)

  useEffect(() => {
    if (allSetsFilled && !autoShowTriggeredRef.current) {
      autoShowTriggeredRef.current = true
      setShowExtra(true)
    }
  }, [allSetsFilled])

  // Nudge coach button when concerning patterns detected
  const coachNudge = shouldNudgeCoach(setRows)
  const nudgeOpenedRef = useRef(false)

  // Auto-open coach when concerning pattern first detected
  useEffect(() => {
    if (coachNudge && !nudgeOpenedRef.current && !showCoachDjp) {
      nudgeOpenedRef.current = true
      setShowCoachDjp(true)
    }
    if (!coachNudge) {
      nudgeOpenedRef.current = false
    }
  }, [coachNudge, showCoachDjp])

  return (
    <>
      <div
        className={cn(
          "px-4 py-3 transition-colors",
          loggedToday && "bg-success/5 border-l-[3px] border-l-success"
        )}
      >
        {/* Collapsed row */}
        <div className="flex items-start gap-3">
          {/* Numbered circle */}
          <div
            className={cn(
              "size-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold transition-colors mt-0.5",
              loggedToday
                ? "bg-success text-white"
                : "bg-primary/10 text-primary"
            )}
          >
            {loggedToday ? (
              <Check className="size-4" strokeWidth={2.5} />
            ) : (
              index + 1
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Name row with action buttons */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "font-medium text-sm",
                    loggedToday ? "text-muted-foreground" : "text-foreground"
                  )}
                >
                  {displayExercise.name}
                  {swappedExercise && (
                    <span className="ml-1.5 text-[10px] font-normal text-accent">
                      (swapped)
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {!loggedToday && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-muted-foreground hover:text-primary"
                    onClick={() => setShowSwap(true)}
                    aria-label={`Swap ${displayExercise.name}`}
                  >
                    <ArrowLeftRight className="size-3" />
                    Swap
                  </Button>
                )}
                {hasVideo && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-muted-foreground hover:text-primary"
                    onClick={() => setShowVideo(true)}
                    aria-label={`Watch ${displayExercise.name} video`}
                  >
                    <Play className="size-3" />
                    Watch
                  </Button>
                )}
                {!loggedToday && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => setExpanded(!expanded)}
                  >
                    Log
                    <ChevronDown
                      className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </Button>
                )}
              </div>
            </div>

            {/* Tags row */}
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {displayExercise.muscle_group && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize leading-none",
                    getMuscleGroupColor(displayExercise.muscle_group)
                  )}
                >
                  {displayExercise.muscle_group}
                </span>
              )}
              {rec.recommended_kg != null && (
                <Badge
                  variant="outline"
                  className="gap-1 text-[10px] border-primary/20 text-primary"
                >
                  <TrendIcon trend={rec.trend} />
                  {formatWeightCompact(rec.recommended_kg)}
                </Badge>
              )}
            </div>

            {/* Details row */}
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
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
              {displayExercise.equipment && (
                <span className="flex items-center gap-1">
                  <Weight className="size-3" strokeWidth={1.5} />
                  {displayExercise.equipment}
                </span>
              )}
              {pe.tempo && (
                <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded leading-none">
                  {formatTempo(pe.tempo)}
                </span>
              )}
              {pe.rest_seconds && (
                <span className="text-muted-foreground/60">
                  Rest: {formatRestTime(pe.rest_seconds)}
                </span>
              )}
            </div>

            {/* Coach notes (hidden if shared across all exercises) */}
            {!hideNotes && pe.notes && (
              <div className="flex items-start gap-2 mt-2 rounded-md bg-amber-50 px-2.5 py-1.5">
                <Lightbulb
                  className="size-3.5 shrink-0 text-amber-500 mt-0.5"
                  strokeWidth={2}
                />
                <p className="text-xs italic text-foreground/70 line-clamp-2 leading-relaxed">
                  {pe.notes}
                </p>
              </div>
            )}
          </div>
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
                {(rec.reasoning || aiSuggestedWeight != null) && (
                  <div className={cn(
                    "rounded-lg p-3 space-y-2",
                    aiSuggestedWeight != null
                      ? "bg-accent/10 border border-accent/20"
                      : "bg-primary/5 border border-primary/10"
                  )}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-primary leading-relaxed">
                        {aiSuggestedWeight != null
                          ? `Coach DJP recommends ${formatWeightCompact(aiSuggestedWeight)} for this exercise.`
                          : rec.reasoning}
                      </p>
                      {aiSuggestedWeight != null ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px] border-accent/30 text-accent"
                        >
                          <Brain className="size-3 mr-0.5" />
                          AI
                        </Badge>
                      ) : rec.confidence !== "none" ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px] capitalize"
                        >
                          {rec.confidence}
                        </Badge>
                      ) : null}
                    </div>
                    {(aiSuggestedWeight ?? rec.recommended_kg) != null && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-xs gap-1 h-7"
                        onClick={handleUseRecommended}
                      >
                        Use Recommended ({formatWeightCompact(aiSuggestedWeight ?? rec.recommended_kg)})
                      </Button>
                    )}
                  </div>
                )}

                {/* Set-by-set table */}
                <div>
                  <Label className="text-xs font-medium">Sets</Label>
                  <table className="w-full mt-1.5" style={{ borderCollapse: "separate", borderSpacing: "0 4px" }}>
                    <thead>
                      <tr className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                        <th style={{ width: 28 }} className="text-left font-medium">#</th>
                        <th className="text-left font-medium">{unitLabel()}</th>
                        <th className="text-left font-medium">Reps</th>
                        <th style={{ width: 56 }} className="text-left font-medium">RPE</th>
                        <th style={{ width: 28 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {setRows.map((row, idx) => (
                        <tr key={idx}>
                          <td className="text-xs font-semibold text-muted-foreground text-center align-middle">
                            {idx + 1}
                          </td>
                          <td className="pr-1 align-middle">
                            <input
                              type="number"
                              step={unit === "lbs" ? "1" : "0.5"}
                              min="0"
                              placeholder={weightPlaceholder}
                              value={row.weight}
                              onChange={(e) => updateSetRow(idx, "weight", e.target.value)}
                              className="w-full h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                            />
                          </td>
                          <td className="pr-1 align-middle">
                            <input
                              type="number"
                              min="0"
                              max="999"
                              placeholder={prescribedReps || "0"}
                              value={row.reps}
                              onChange={(e) => updateSetRow(idx, "reps", e.target.value)}
                              className="w-full h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                            />
                          </td>
                          <td className="pr-1 align-middle">
                            <Select
                              value={row.rpe != null ? String(row.rpe) : ""}
                              onValueChange={(v) =>
                                updateSetRow(idx, "rpe", v ? parseInt(v, 10) : null)
                              }
                            >
                              <SelectTrigger className="h-8 text-xs px-1.5 [&_svg]:size-3" style={{ width: "100%" }}>
                                <SelectValue placeholder="-" />
                              </SelectTrigger>
                              <SelectContent>
                                {Array.from({ length: 10 }, (_, i) => i + 1).map(
                                  (v) => (
                                    <SelectItem key={v} value={String(v)}>
                                      {v}
                                    </SelectItem>
                                  )
                                )}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="align-middle">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground hover:text-destructive"
                              onClick={() => removeSet(idx)}
                              disabled={setRows.length <= 1}
                              aria-label={`Remove set ${idx + 1}`}
                            >
                              <X className="size-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Add set button */}
                  {setRows.length < 20 && (
                    <button
                      type="button"
                      className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full py-1.5 rounded-md hover:bg-muted/50"
                      onClick={addSet}
                    >
                      <Plus className="size-3" />
                      Add Set
                    </button>
                  )}
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
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={submitting || !hasValidSets}
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
                    variant={coachNudge ? "default" : "outline"}
                    className={cn(
                      "gap-1 relative",
                      coachNudge && "animate-pulse bg-accent text-accent-foreground hover:bg-accent/90"
                    )}
                    onClick={() => setShowCoachDjp(true)}
                  >
                    <Brain className="size-3" />
                    Coach DJP
                    {coachNudge && (
                      <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-error ring-2 ring-white" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
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

      <CoachDjpPanel
        open={showCoachDjp}
        onOpenChange={setShowCoachDjp}
        exerciseId={displayExercise.id}
        exerciseName={displayExercise.name}
        exerciseEquipment={displayExercise.equipment}
        onApplyWeight={(kg) => handleAiApplyWeight(kg)}
        totalSets={numSets}
        currentSets={setRows.map((row, i) => ({
          set_number: i + 1,
          weight_kg: row.weight ? toKg(parseFloat(row.weight)) : null,
          reps: parseInt(row.reps, 10) || 0,
          rpe: row.rpe,
        }))}
      />

      <ExerciseSwapSheet
        open={showSwap}
        onOpenChange={setShowSwap}
        exerciseId={exercise.id}
        exerciseName={exercise.name}
        muscleGroup={exercise.muscle_group}
        onSwap={(newExercise) => setSwappedExercise(newExercise)}
      />

      {hasVideo && displayExercise.video_url && (
        <ExerciseVideoSheet
          open={showVideo}
          onOpenChange={setShowVideo}
          videoUrl={displayExercise.video_url}
          exerciseName={displayExercise.name}
        />
      )}

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
  onExerciseLogged,
}: WorkoutDayProps) {
  const [sessionLoggedIds, setSessionLoggedIds] = useState<Set<string>>(
    new Set()
  )

  function handleExerciseLogged(exerciseId: string) {
    setSessionLoggedIds((prev) => new Set(prev).add(exerciseId))
    onExerciseLogged?.(exerciseId)
  }

  const loggedCount = exercises.filter(
    (e) => e.loggedToday || sessionLoggedIds.has(e.exercise.id)
  ).length
  const allComplete = loggedCount === exercises.length && exercises.length > 0
  const totalSets = exercises.reduce(
    (sum, e) => sum + (e.programExercise.sets ?? 0),
    0
  )

  const groups = groupExercisesByTag(exercises)
  let exerciseIndex = 0

  // Detect shared note — if all non-null notes are identical, show once in header
  const allNotes = exercises.map((e) => e.programExercise.notes).filter(Boolean)
  const uniqueNotes = new Set(allNotes)
  const sharedNote = uniqueNotes.size === 1 ? allNotes[0] : null

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="bg-surface px-4 py-3 border-b border-border">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-primary">
          {sharedNote ? (
            <>
              <Lightbulb className="size-3.5 shrink-0 text-amber-500" strokeWidth={2} />
              {sharedNote}
            </>
          ) : (
            dayLabel ?? `Day ${day}`
          )}
        </h3>
      </div>

      <div className="divide-y divide-border">
        {groups.map((group) => {
          // Superset / grouped exercises (2+ with same group_tag)
          if (group.tag && group.exercises.length > 1) {
            const startIdx = exerciseIndex
            const items = group.exercises.map((item) => {
              const idx = exerciseIndex++
              return (
                <motion.div
                  key={item.programExercise.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: idx * 0.05 }}
                >
                  <ExerciseCard
                    index={idx}
                    {...item}
                    assignmentId={assignmentId}
                    onLogged={() => handleExerciseLogged(item.exercise.id)}
                    hideNotes={!!sharedNote}
                  />
                </motion.div>
              )
            })

            return (
              <div
                key={`group-${group.tag}-${startIdx}`}
                className="border-l-[3px] border-l-accent"
              >
                <div className="px-4 py-1.5 bg-accent/5 border-b border-border">
                  <Badge
                    variant="outline"
                    className="text-[10px] border-accent/30 text-accent font-semibold"
                  >
                    {getGroupLabel(group.technique)}
                  </Badge>
                </div>
                <div className="divide-y divide-border">{items}</div>
              </div>
            )
          }

          // Ungrouped (standalone) exercises
          return group.exercises.map((item) => {
            const idx = exerciseIndex++
            return (
              <motion.div
                key={item.programExercise.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: idx * 0.05 }}
              >
                <ExerciseCard
                  index={idx}
                  {...item}
                  assignmentId={assignmentId}
                  onLogged={() => handleExerciseLogged(item.exercise.id)}
                />
              </motion.div>
            )
          })
        })}
      </div>

      {/* Day Complete celebration */}
      <AnimatePresence>
        {allComplete && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="border-t border-border p-6 text-center bg-success/5"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{
                type: "spring",
                damping: 12,
                stiffness: 200,
                delay: 0.1,
              }}
              className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-success/20"
            >
              <CheckCircle2 className="size-7 text-success" />
            </motion.div>
            <h4 className="text-base font-semibold text-foreground">
              Day Complete!
            </h4>
            <p className="text-sm text-muted-foreground mt-1">
              {exercises.length} exercises &middot; {totalSets} total sets
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
