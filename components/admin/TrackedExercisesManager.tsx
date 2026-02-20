"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Loader2, Target, Weight, Timer, Hash } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"

interface TrackedExercise {
  id: string
  exercise_id: string
  target_metric: string
  exercises?: { name: string } | null
}

interface TrackedExercisesManagerProps {
  assignmentId: string
  programExercises: Array<{
    exercise_id: string
    exercise_name: string
  }>
  initialTracked: TrackedExercise[]
}

const METRIC_OPTIONS = [
  { value: "weight", label: "Weight", icon: Weight },
  { value: "reps", label: "Reps", icon: Hash },
  { value: "time", label: "Time", icon: Timer },
] as const

export function TrackedExercisesManager({
  assignmentId,
  programExercises,
  initialTracked,
}: TrackedExercisesManagerProps) {
  const [tracked, setTracked] = useState<TrackedExercise[]>(initialTracked)
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()

  // Deduplicate exercises by exercise_id (a program may have the same exercise
  // on multiple days/weeks — we only show each exercise once for tracking)
  const uniqueExercises = Array.from(
    new Map(
      programExercises.map((e) => [e.exercise_id, e])
    ).values()
  )

  function getTrackedEntry(exerciseId: string): TrackedExercise | undefined {
    return tracked.find((t) => t.exercise_id === exerciseId)
  }

  function isTracked(exerciseId: string): boolean {
    return !!getTrackedEntry(exerciseId)
  }

  async function handleToggle(exerciseId: string, exerciseName: string) {
    const existing = getTrackedEntry(exerciseId)
    setLoadingIds((prev) => new Set(prev).add(exerciseId))

    try {
      if (existing) {
        // Remove tracking
        const response = await fetch(
          `/api/admin/tracked-exercises/${existing.id}`,
          { method: "DELETE" }
        )
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || "Failed to remove tracking")
        }

        startTransition(() => {
          setTracked((prev) => prev.filter((t) => t.id !== existing.id))
        })
        toast.success(`Stopped tracking "${exerciseName}"`)
      } else {
        // Add tracking
        const response = await fetch("/api/admin/tracked-exercises", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assignment_id: assignmentId,
            exercise_id: exerciseId,
            target_metric: "weight",
          }),
        })
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || "Failed to track exercise")
        }

        const newTracked = await response.json()
        startTransition(() => {
          setTracked((prev) => [...prev, newTracked])
        })
        toast.success(`Now tracking "${exerciseName}"`)
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update tracking"
      )
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev)
        next.delete(exerciseId)
        return next
      })
    }
  }

  async function handleMetricChange(
    trackedId: string,
    exerciseId: string,
    newMetric: string
  ) {
    setLoadingIds((prev) => new Set(prev).add(exerciseId))

    try {
      // Delete old tracking entry and create new one with updated metric
      const deleteRes = await fetch(
        `/api/admin/tracked-exercises/${trackedId}`,
        { method: "DELETE" }
      )
      if (!deleteRes.ok) throw new Error("Failed to update metric")

      const createRes = await fetch("/api/admin/tracked-exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: assignmentId,
          exercise_id: exerciseId,
          target_metric: newMetric,
        }),
      })
      if (!createRes.ok) throw new Error("Failed to update metric")

      const updated = await createRes.json()
      startTransition(() => {
        setTracked((prev) =>
          prev.map((t) => (t.id === trackedId ? updated : t))
        )
      })
      toast.success("Target metric updated")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update metric"
      )
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev)
        next.delete(exerciseId)
        return next
      })
    }
  }

  if (uniqueExercises.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <Target className="size-5 text-primary" />
          <h2 className="text-lg font-semibold text-primary">
            Tracked Exercises
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          No exercises in this program yet. Add exercises to the program first,
          then you can select which ones to track for this client.
        </p>
      </div>
    )
  }

  const trackedCount = tracked.length

  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="size-5 text-primary" />
          <h2 className="text-lg font-semibold text-primary">
            Tracked Exercises
          </h2>
        </div>
        <span className="text-xs text-muted-foreground">
          {trackedCount} of {uniqueExercises.length} tracked
        </span>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Select which exercises to track for key lift progress and PR
        celebrations.
      </p>

      <div className="divide-y divide-border">
        {uniqueExercises.map((exercise) => {
          const entry = getTrackedEntry(exercise.exercise_id)
          const checked = !!entry
          const loading = loadingIds.has(exercise.exercise_id)

          return (
            <div
              key={exercise.exercise_id}
              className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
            >
              {/* Checkbox / Loading */}
              <div className="flex items-center shrink-0">
                {loading ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() =>
                      handleToggle(
                        exercise.exercise_id,
                        exercise.exercise_name
                      )
                    }
                    aria-label={`Track ${exercise.exercise_name}`}
                  />
                )}
              </div>

              {/* Exercise name */}
              <div className="flex-1 min-w-0">
                <Label
                  className={`text-sm cursor-pointer ${
                    checked
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                  }`}
                  onClick={() => {
                    if (!loading) {
                      handleToggle(
                        exercise.exercise_id,
                        exercise.exercise_name
                      )
                    }
                  }}
                >
                  {exercise.exercise_name}
                </Label>
              </div>

              {/* Target metric selector (only when tracked) */}
              {checked && entry && (
                <div className="shrink-0">
                  <Select
                    value={entry.target_metric}
                    onValueChange={(value) =>
                      handleMetricChange(entry.id, exercise.exercise_id, value)
                    }
                    disabled={loading}
                  >
                    <SelectTrigger className="h-8 w-[110px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METRIC_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex items-center gap-1.5">
                            <opt.icon className="size-3 text-muted-foreground" />
                            {opt.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
