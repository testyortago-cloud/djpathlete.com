"use client"

import { useState, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Layers, DollarSign } from "lucide-react"
import { WeekSelector } from "@/components/admin/WeekSelector"
import { DayColumn } from "@/components/admin/DayColumn"
import { AddExerciseDialog } from "@/components/admin/AddExerciseDialog"
import { EditExerciseDialog } from "@/components/admin/EditExerciseDialog"
import { ExerciseCard } from "@/components/admin/ExerciseCard"
import { ExercisePool } from "@/components/admin/ExercisePool"
import { ExercisePoolCard } from "@/components/admin/ExercisePoolCard"
import { GenerationDialog } from "@/components/admin/GenerationDialog"
import type { Exercise, ProgramExercise } from "@/types/database"

type ProgramExerciseWithExercise = ProgramExercise & { exercises: Exercise }

interface AssignmentInfo {
  assignmentId: string
  clientId: string
}

interface ProgramBuilderProps {
  programId: string
  totalWeeks: number
  programExercises: ProgramExerciseWithExercise[]
  exercises: Exercise[]
  assignmentInfo?: AssignmentInfo | null
}

export function ProgramBuilder({
  programId,
  totalWeeks,
  programExercises,
  exercises,
  assignmentInfo,
}: ProgramBuilderProps) {
  const router = useRouter()
  const [selectedWeek, setSelectedWeek] = useState(1)
  const [localTotalWeeks, setLocalTotalWeeks] = useState(totalWeeks)

  // Optimistic local state — mirrors server props but updates instantly on drag
  const [localExercises, setLocalExercises] = useState(programExercises)
  useEffect(() => {
    setLocalExercises(programExercises)
  }, [programExercises])
  useEffect(() => {
    setLocalTotalWeeks(totalWeeks)
  }, [totalWeeks])

  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addDialogDay, setAddDialogDay] = useState(1)
  const [editTarget, setEditTarget] = useState<ProgramExerciseWithExercise | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProgramExerciseWithExercise | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Duplicate week dialog
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)

  // AI Generate week dialog
  const [generateWeekOpen, setGenerateWeekOpen] = useState(false)

  // AI Generate day dialog
  const [generateDayOpen, setGenerateDayOpen] = useState(false)
  const [generateDayTarget, setGenerateDayTarget] = useState(1)

  // Add blank week
  const [isAddingWeek, setIsAddingWeek] = useState(false)
  const [addWeekDialogOpen, setAddWeekDialogOpen] = useState(false)
  const [addWeekAccessType, setAddWeekAccessType] = useState<"included" | "paid">("included")
  const [addWeekPrice, setAddWeekPrice] = useState("")

  // Delete week
  const [deleteWeekOpen, setDeleteWeekOpen] = useState(false)
  const [isDeletingWeek, setIsDeletingWeek] = useState(false)

  // Clear day
  const [clearDayTarget, setClearDayTarget] = useState<number | null>(null)
  const [isClearingDay, setIsClearingDay] = useState(false)

  function openAddWeekDialog() {
    setAddWeekAccessType("included")
    setAddWeekPrice("")
    setAddWeekDialogOpen(true)
  }

  async function handleAddWeek() {
    if (isAddingWeek) return
    setIsAddingWeek(true)
    try {
      const body: Record<string, unknown> = {}
      if (addWeekAccessType === "paid" && addWeekPrice) {
        body.access_type = "paid"
        body.price_cents = Math.round(parseFloat(addWeekPrice) * 100)
      }

      const response = await fetch(`/api/admin/programs/${programId}/add-week`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to add week")
      }
      const data = await response.json()
      const newWeek = data.new_week_number as number
      setLocalTotalWeeks(newWeek)
      setSelectedWeek(newWeek)
      const clientCount = data.assignments_updated ?? 0
      if (addWeekAccessType === "paid") {
        toast.success(
          `Week ${newWeek} added — $${addWeekPrice} charge set for ${clientCount} client${clientCount !== 1 ? "s" : ""}`,
        )
      } else {
        toast.success(`Week ${newWeek} added (free)`)
      }
      setAddWeekDialogOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add week")
    } finally {
      setIsAddingWeek(false)
    }
  }

  async function handleDeleteWeek() {
    if (isDeletingWeek) return
    setIsDeletingWeek(true)
    try {
      const response = await fetch(`/api/admin/programs/${programId}/delete-week`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekNumber: selectedWeek }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to delete week")
      }
      const data = await response.json()
      const newTotal = data.new_total_weeks as number
      setLocalTotalWeeks(newTotal)
      // Move to the previous week if we deleted the last one
      if (selectedWeek > newTotal) {
        setSelectedWeek(newTotal)
      }
      toast.success(`Week ${selectedWeek} removed`)
      setDeleteWeekOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete week")
    } finally {
      setIsDeletingWeek(false)
    }
  }

  const DAY_NAMES_TOP = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

  async function handleClearDay() {
    if (!clearDayTarget || isClearingDay) return
    setIsClearingDay(true)
    try {
      const response = await fetch(`/api/admin/programs/${programId}/clear-day`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekNumber: selectedWeek, dayOfWeek: clearDayTarget }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to clear day")
      }
      toast.success(`${DAY_NAMES_TOP[clearDayTarget - 1]} cleared`)
      setClearDayTarget(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear day")
    } finally {
      setIsClearingDay(false)
    }
  }

  // Exercise Pool state — persist IDs in sessionStorage so pool survives router.refresh()
  const poolStorageKey = `exercise-pool-${programId}`

  const [poolExercises, setPoolExercisesRaw] = useState<Exercise[]>(() => {
    if (typeof window === "undefined") return []
    try {
      const stored = sessionStorage.getItem(poolStorageKey)
      if (!stored) return []
      const ids: string[] = JSON.parse(stored)
      const idSet = new Set(ids)
      return exercises.filter((e) => idSet.has(e.id))
    } catch {
      return []
    }
  })

  const setPoolExercises = useCallback(
    (update: Exercise[] | ((prev: Exercise[]) => Exercise[])) => {
      setPoolExercisesRaw((prev) => {
        const next = typeof update === "function" ? update(prev) : update
        try {
          if (next.length > 0) {
            sessionStorage.setItem(poolStorageKey, JSON.stringify(next.map((e) => e.id)))
          } else {
            sessionStorage.removeItem(poolStorageKey)
          }
        } catch {
          /* quota exceeded — ignore */
        }
        return next
      })
    },
    [poolStorageKey],
  )

  const [poolOpen, setPoolOpen] = useState(() => {
    if (typeof window === "undefined") return false
    try {
      const stored = sessionStorage.getItem(poolStorageKey)
      if (!stored) return false
      const ids: string[] = JSON.parse(stored)
      return ids.length > 0
    } catch {
      return false
    }
  })
  const [activePoolExercise, setActivePoolExercise] = useState<Exercise | null>(null)

  // Active drag item (for overlay)
  const [activeExercise, setActiveExercise] = useState<ProgramExerciseWithExercise | null>(null)

  // Duplicate exercise dialog
  const [duplicateExTarget, setDuplicateExTarget] = useState<ProgramExerciseWithExercise | null>(null)
  const [isDuplicatingEx, setIsDuplicatingEx] = useState(false)
  const [isDuplicatingInPlace, setIsDuplicatingInPlace] = useState(false)

  // Compute which weeks are blank (no exercises)
  const blankWeeks = new Set<number>()
  for (let w = 1; w <= localTotalWeeks; w++) {
    if (!localExercises.some((pe) => pe.week_number === w)) {
      blankWeeks.add(w)
    }
  }
  const selectedWeekIsBlank = blankWeeks.has(selectedWeek)

  // Group exercises for the selected week by day
  const weekExercises = localExercises.filter((pe) => pe.week_number === selectedWeek)

  function getExercisesForDay(day: number) {
    return weekExercises.filter((pe) => pe.day_of_week === day).sort((a, b) => a.order_index - b.order_index)
  }

  function handleAddExercise(day: number) {
    setAddDialogDay(day)
    setAddDialogOpen(true)
  }

  function handleGenerateDay(day: number) {
    setGenerateDayTarget(day)
    setGenerateDayOpen(true)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const idStr = String(event.active.id)
      if (idStr.startsWith("pool-")) {
        const exerciseId = idStr.replace("pool-", "")
        const exercise = poolExercises.find((e) => e.id === exerciseId)
        setActivePoolExercise(exercise ?? null)
        setActiveExercise(null)
      } else {
        const exercise = weekExercises.find((pe) => pe.id === event.active.id)
        setActiveExercise(exercise ?? null)
        setActivePoolExercise(null)
      }
    },
    [weekExercises, poolExercises],
  )

  /** Determine which day a droppable/sortable ID belongs to */
  function getDayFromId(id: string | number): number | null {
    const idStr = String(id)
    // Droppable container IDs: "day-1" through "day-7"
    if (idStr.startsWith("day-")) return Number(idStr.split("-")[1])
    // Exercise IDs: find the exercise and return its day
    const exercise = weekExercises.find((pe) => pe.id === idStr)
    return exercise ? exercise.day_of_week : null
  }

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveExercise(null)
      setActivePoolExercise(null)
      const { active, over } = event
      if (!over) return

      const activeIdStr = String(active.id)

      // Handle pool exercise dropped onto a day
      if (activeIdStr.startsWith("pool-")) {
        const targetDay = getDayFromId(over.id)
        if (!targetDay) return

        const exerciseId = activeIdStr.replace("pool-", "")
        const exercise = poolExercises.find((e) => e.id === exerciseId)
        if (!exercise) return

        const targetDayExercises = getExercisesForDay(targetDay)
        const orderIndex = targetDayExercises.length

        try {
          const response = await fetch(`/api/admin/programs/${programId}/exercises`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              exercise_id: exerciseId,
              week_number: selectedWeek,
              day_of_week: targetDay,
              order_index: orderIndex,
              sets: 3,
              reps: "8-12",
              technique: "straight_set",
            }),
          })
          if (!response.ok) {
            const data = await response.json()
            throw new Error(data.error || "Failed to add exercise")
          }

          const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
          toast.success(`Added "${exercise.name}" to ${DAY_NAMES[targetDay - 1]}`)
          // Remove from pool after successful drop
          setPoolExercises((prev) => prev.filter((e) => e.id !== exerciseId))
          router.refresh()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed to add exercise from pool")
        }
        return
      }

      if (active.id === over.id) return

      const draggedExercise = weekExercises.find((pe) => pe.id === active.id)
      if (!draggedExercise) return

      const sourceDay = draggedExercise.day_of_week
      const targetDay = getDayFromId(over.id)
      if (!targetDay) return

      // Save snapshot for rollback on error
      const snapshot = localExercises

      if (sourceDay === targetDay) {
        // Same-day reorder
        const dayExercises = getExercisesForDay(sourceDay)
        const oldIndex = dayExercises.findIndex((pe) => pe.id === active.id)
        const newIndex = dayExercises.findIndex((pe) => pe.id === over.id)

        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return

        const reordered = arrayMove(dayExercises, oldIndex, newIndex)

        // Optimistic update — apply new order immediately
        setLocalExercises((prev) =>
          prev.map((pe) => {
            const idx = reordered.findIndex((r) => r.id === pe.id)
            return idx !== -1 ? { ...pe, order_index: idx } : pe
          }),
        )

        try {
          await Promise.all(
            reordered.map((pe, i) =>
              fetch(`/api/admin/programs/${programId}/exercises/${pe.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order_index: i }),
              }),
            ),
          )
          router.refresh()
        } catch {
          setLocalExercises(snapshot)
          toast.error("Failed to reorder exercises")
        }
      } else {
        // Cross-day move
        const targetDayExercises = getExercisesForDay(targetDay)
        const overExercise = targetDayExercises.find((pe) => pe.id === over.id)
        const insertIndex = overExercise ? targetDayExercises.indexOf(overExercise) : targetDayExercises.length

        // Optimistic update — move exercise to target day instantly
        setLocalExercises((prev) => {
          const sourceDayItems = prev
            .filter(
              (pe) => pe.week_number === selectedWeek && pe.day_of_week === sourceDay && pe.id !== draggedExercise.id,
            )
            .sort((a, b) => a.order_index - b.order_index)

          const targetDayItems = prev
            .filter(
              (pe) => pe.week_number === selectedWeek && pe.day_of_week === targetDay && pe.id !== draggedExercise.id,
            )
            .sort((a, b) => a.order_index - b.order_index)

          // Insert dragged exercise at the target position
          const movedExercise = { ...draggedExercise, day_of_week: targetDay, order_index: insertIndex }
          targetDayItems.splice(insertIndex, 0, movedExercise)

          // Build a map of id -> updated exercise for quick lookup
          const updates = new Map<string, Partial<ProgramExerciseWithExercise>>()

          // Re-index source day
          sourceDayItems.forEach((pe, i) => updates.set(pe.id, { order_index: i }))
          // Re-index target day
          targetDayItems.forEach((pe, i) => updates.set(pe.id, { day_of_week: targetDay, order_index: i }))

          return prev.map((pe) => {
            const update = updates.get(pe.id)
            return update ? { ...pe, ...update } : pe
          })
        })

        const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        toast.success(`Moved to ${DAY_NAMES[targetDay - 1]}`)

        try {
          // 1. Move the dragged exercise to the target day
          await fetch(`/api/admin/programs/${programId}/exercises/${draggedExercise.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              day_of_week: targetDay,
              order_index: insertIndex,
            }),
          })

          // 2. Re-index remaining exercises in target day
          const reindexTarget = targetDayExercises
            .filter((pe) => pe.id !== draggedExercise.id)
            .map((pe, _i) => {
              const currentIdx = targetDayExercises.indexOf(pe)
              const newIdx = currentIdx >= insertIndex ? currentIdx + 1 : currentIdx
              return { id: pe.id, order_index: newIdx }
            })

          // 3. Re-index source day (close the gap)
          const sourceDayExercises = getExercisesForDay(sourceDay).filter((pe) => pe.id !== draggedExercise.id)

          const updates = [
            ...reindexTarget.map((u) =>
              fetch(`/api/admin/programs/${programId}/exercises/${u.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order_index: u.order_index }),
              }),
            ),
            ...sourceDayExercises.map((pe, i) =>
              fetch(`/api/admin/programs/${programId}/exercises/${pe.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order_index: i }),
              }),
            ),
          ]

          await Promise.all(updates)
          router.refresh()
        } catch {
          setLocalExercises(snapshot)
          toast.error("Failed to move exercise")
        }
      }
    },
    [weekExercises, localExercises, selectedWeek, programId, router, poolExercises],
  )

  async function handleDuplicateInPlace(pe: ProgramExerciseWithExercise) {
    if (isDuplicatingInPlace) return
    setIsDuplicatingInPlace(true)

    const dayExercises = getExercisesForDay(pe.day_of_week)
    const index = dayExercises.findIndex((e) => e.id === pe.id)
    const newOrderIndex = pe.order_index + 1

    try {
      const exercisesAfter = dayExercises.slice(index + 1)
      if (exercisesAfter.length > 0) {
        await Promise.all(
          exercisesAfter.map((ex) =>
            fetch(`/api/admin/programs/${programId}/exercises/${ex.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ order_index: ex.order_index + 1 }),
            }),
          ),
        )
      }

      const response = await fetch(`/api/admin/programs/${programId}/exercises`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exercise_id: pe.exercise_id,
          week_number: pe.week_number,
          day_of_week: pe.day_of_week,
          order_index: newOrderIndex,
          sets: pe.sets,
          reps: pe.reps,
          rest_seconds: pe.rest_seconds,
          duration_seconds: pe.duration_seconds,
          notes: pe.notes,
          rpe_target: pe.rpe_target,
          intensity_pct: pe.intensity_pct,
          tempo: pe.tempo,
          group_tag: pe.group_tag,
          technique: pe.technique,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to duplicate exercise")
      }

      toast.success(`Duplicated "${pe.exercises.name}"`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to duplicate exercise")
    } finally {
      setIsDuplicatingInPlace(false)
    }
  }

  async function handleDuplicateGroupInPlace(groupExercises: ProgramExerciseWithExercise[]) {
    if (isDuplicatingInPlace || groupExercises.length === 0) return
    setIsDuplicatingInPlace(true)

    // Find the last exercise in the group to insert after it
    const lastInGroup = groupExercises[groupExercises.length - 1]
    const dayExercises = getExercisesForDay(lastInGroup.day_of_week)
    const lastIndex = dayExercises.findIndex((e) => e.id === lastInGroup.id)
    const insertAt = lastInGroup.order_index + 1

    // Pick a new group_tag letter that isn't already used on this day
    const usedTags = new Set(dayExercises.map((e) => e.group_tag?.charAt(0).toUpperCase()).filter(Boolean))
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    const newTag = alphabet.split("").find((l) => !usedTags.has(l)) ?? "Z"

    try {
      // Shift exercises after the group down
      const exercisesAfter = dayExercises.slice(lastIndex + 1)
      if (exercisesAfter.length > 0) {
        await Promise.all(
          exercisesAfter.map((ex) =>
            fetch(`/api/admin/programs/${programId}/exercises/${ex.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ order_index: ex.order_index + groupExercises.length }),
            }),
          ),
        )
      }

      // Create duplicates for each exercise in the group
      for (let i = 0; i < groupExercises.length; i++) {
        const pe = groupExercises[i]
        const response = await fetch(`/api/admin/programs/${programId}/exercises`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            exercise_id: pe.exercise_id,
            week_number: pe.week_number,
            day_of_week: pe.day_of_week,
            order_index: insertAt + i,
            sets: pe.sets,
            reps: pe.reps,
            rest_seconds: pe.rest_seconds,
            duration_seconds: pe.duration_seconds,
            notes: pe.notes,
            rpe_target: pe.rpe_target,
            intensity_pct: pe.intensity_pct,
            tempo: pe.tempo,
            group_tag: newTag,
            technique: pe.technique,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || "Failed to duplicate group")
        }
      }

      toast.success(`Duplicated group "${newTag}" (${groupExercises.length} exercises)`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to duplicate group")
    } finally {
      setIsDuplicatingInPlace(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)

    try {
      const response = await fetch(`/api/admin/programs/${programId}/exercises/${deleteTarget.id}`, {
        method: "DELETE",
      })

      if (!response.ok) throw new Error("Failed to delete")

      toast.success("Exercise removed")
      setDeleteTarget(null)
      router.refresh()
    } catch {
      toast.error("Failed to remove exercise")
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleDuplicateWeek(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsDuplicating(true)

    const formData = new FormData(e.currentTarget)
    const targetWeek = Number(formData.get("targetWeek"))

    try {
      const response = await fetch(`/api/admin/programs/${programId}/duplicate-week`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceWeek: selectedWeek, targetWeek }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to duplicate week")
      }

      toast.success(`Week ${selectedWeek} duplicated to Week ${targetWeek}`)
      setDuplicateOpen(false)
      setSelectedWeek(targetWeek)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to duplicate week")
    } finally {
      setIsDuplicating(false)
    }
  }

  async function handleDuplicateExercise(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!duplicateExTarget) return
    setIsDuplicatingEx(true)

    const formData = new FormData(e.currentTarget)
    const targetWeek = Number(formData.get("targetWeek"))
    const targetDay = Number(formData.get("targetDay"))

    // Count existing exercises in the target day to set order_index
    const targetDayExercises = programExercises.filter(
      (pe) => pe.week_number === targetWeek && pe.day_of_week === targetDay,
    )

    const body = {
      exercise_id: duplicateExTarget.exercise_id,
      week_number: targetWeek,
      day_of_week: targetDay,
      order_index: targetDayExercises.length,
      sets: duplicateExTarget.sets,
      reps: duplicateExTarget.reps,
      rest_seconds: duplicateExTarget.rest_seconds,
      duration_seconds: duplicateExTarget.duration_seconds,
      notes: duplicateExTarget.notes,
      rpe_target: duplicateExTarget.rpe_target,
      intensity_pct: duplicateExTarget.intensity_pct,
      tempo: duplicateExTarget.tempo,
      group_tag: duplicateExTarget.group_tag,
      technique: duplicateExTarget.technique,
    }

    try {
      const response = await fetch(`/api/admin/programs/${programId}/exercises`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to duplicate exercise")
      }

      const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
      toast.success(`Duplicated to Week ${targetWeek}, ${DAY_NAMES[targetDay - 1]}`)
      setDuplicateExTarget(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to duplicate exercise")
    } finally {
      setIsDuplicatingEx(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Week selector + Pool toggle */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <WeekSelector
            totalWeeks={localTotalWeeks}
            selectedWeek={selectedWeek}
            onSelectWeek={setSelectedWeek}
            onDuplicateWeek={() => setDuplicateOpen(true)}
            onAddWeek={openAddWeekDialog}
            isAddingWeek={isAddingWeek}
            onDeleteWeek={() => setDeleteWeekOpen(true)}
            isDeletingWeek={isDeletingWeek}
            onGenerateWeek={() => setGenerateWeekOpen(true)}
            canGenerateWeek={true}
            blankWeeks={blankWeeks}
          />
        </div>
        <Button
          variant={poolOpen ? "default" : "outline"}
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => setPoolOpen(!poolOpen)}
        >
          <Layers className="size-3.5" />
          Exercise Pool
          {poolExercises.length > 0 && (
            <span
              className={`ml-0.5 text-[10px] font-bold rounded-full px-1.5 py-0.5 ${poolOpen ? "bg-white/25 text-white" : "bg-primary/10 text-primary"}`}
            >
              {poolExercises.length}
            </span>
          )}
        </Button>
      </div>

      {/* Day grid + Pool panel */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4">
          <div className="flex-1 min-w-0">
            <div
              className={`grid grid-cols-1 md:grid-cols-2 ${poolOpen ? "lg:grid-cols-2 xl:grid-cols-3" : "lg:grid-cols-3 xl:grid-cols-4"} gap-4`}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <DayColumn
                  key={day}
                  dayOfWeek={day}
                  exercises={getExercisesForDay(day)}
                  onAddExercise={handleAddExercise}
                  onEditExercise={setEditTarget}
                  onRemoveExercise={setDeleteTarget}
                  onDuplicateExercise={handleDuplicateInPlace}
                  onDuplicateGroup={handleDuplicateGroupInPlace}
                  onGenerateDay={handleGenerateDay}
                  onClearDay={setClearDayTarget}
                />
              ))}
            </div>
          </div>
          {poolOpen && (
            <ExercisePool
              allExercises={exercises}
              poolExercises={poolExercises}
              onPoolChange={setPoolExercises}
              onClose={() => setPoolOpen(false)}
            />
          )}
        </div>
        <DragOverlay>
          {activeExercise ? (
            <ExerciseCard programExercise={activeExercise} onEdit={() => {}} onRemove={() => {}} isOverlay />
          ) : activePoolExercise ? (
            <ExercisePoolCard exercise={activePoolExercise} onRemove={() => {}} isOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Add Exercise Dialog */}
      <AddExerciseDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        programId={programId}
        weekNumber={selectedWeek}
        dayOfWeek={addDialogDay}
        exercises={exercises}
        existingCount={getExercisesForDay(addDialogDay).length}
        dayExercises={getExercisesForDay(addDialogDay)}
      />

      {/* Edit Exercise Dialog */}
      <EditExerciseDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        programId={programId}
        programExercise={editTarget}
        dayExercises={editTarget ? getExercisesForDay(editTarget.day_of_week) : []}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Exercise</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove &ldquo;{deleteTarget?.exercises.name}&rdquo; from this day?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Week Confirmation Dialog */}
      <Dialog open={deleteWeekOpen} onOpenChange={setDeleteWeekOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Week {selectedWeek}</DialogTitle>
            <DialogDescription>
              This will permanently delete Week {selectedWeek} and all its exercises.
              {selectedWeek < localTotalWeeks && " Subsequent weeks will be renumbered."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteWeekOpen(false)} disabled={isDeletingWeek}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteWeek} disabled={isDeletingWeek}>
              {isDeletingWeek ? "Removing..." : "Remove Week"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Week Dialog — paid/free toggle */}
      <Dialog open={addWeekDialogOpen} onOpenChange={setAddWeekDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add New Week</DialogTitle>
            <DialogDescription>Choose how assigned clients access this new week.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex gap-2">
              <Button
                variant={addWeekAccessType === "included" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setAddWeekAccessType("included")}
              >
                Include Free
              </Button>
              <Button
                variant={addWeekAccessType === "paid" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setAddWeekAccessType("paid")}
              >
                <DollarSign className="size-3.5 mr-1" />
                Charge
              </Button>
            </div>
            {addWeekAccessType === "paid" && (
              <div className="space-y-2">
                <Label htmlFor="weekPrice">Price (USD) *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    id="weekPrice"
                    type="number"
                    min="0.50"
                    step="0.01"
                    placeholder="25.00"
                    value={addWeekPrice}
                    onChange={(e) => setAddWeekPrice(e.target.value)}
                    className="pl-7"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Clients will need to pay before accessing this week.</p>
              </div>
            )}
            {addWeekAccessType === "included" && (
              <p className="text-xs text-muted-foreground">
                All assigned clients will have immediate access to this week.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddWeekDialogOpen(false)} disabled={isAddingWeek}>
              Cancel
            </Button>
            <Button onClick={handleAddWeek} disabled={isAddingWeek || (addWeekAccessType === "paid" && !addWeekPrice)}>
              {isAddingWeek ? "Adding..." : "Add Week"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear Day Confirmation Dialog */}
      <Dialog open={!!clearDayTarget} onOpenChange={(open) => !open && setClearDayTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear {clearDayTarget ? DAY_NAMES_TOP[clearDayTarget - 1] : ""}</DialogTitle>
            <DialogDescription>
              This will remove all {clearDayTarget ? getExercisesForDay(clearDayTarget).length : 0} exercises from{" "}
              {clearDayTarget ? DAY_NAMES_TOP[clearDayTarget - 1] : ""} in Week {selectedWeek}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearDayTarget(null)} disabled={isClearingDay}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleClearDay} disabled={isClearingDay}>
              {isClearingDay ? "Clearing..." : "Clear Day"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate Week Dialog */}
      <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Duplicate Week {selectedWeek}</DialogTitle>
            <DialogDescription>
              Copy all exercises from Week {selectedWeek} to another week. Existing exercises in the target week will be
              kept.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleDuplicateWeek} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="targetWeek">Target Week *</Label>
              <Input
                id="targetWeek"
                name="targetWeek"
                type="number"
                min={1}
                max={localTotalWeeks}
                required
                defaultValue={selectedWeek < localTotalWeeks ? selectedWeek + 1 : 1}
                disabled={isDuplicating}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDuplicateOpen(false)} disabled={isDuplicating}>
                Cancel
              </Button>
              <Button type="submit" disabled={isDuplicating}>
                {isDuplicating ? "Duplicating..." : "Duplicate"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Duplicate Exercise Dialog */}
      <Dialog open={!!duplicateExTarget} onOpenChange={(open) => !open && setDuplicateExTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Duplicate Exercise</DialogTitle>
            <DialogDescription>
              Copy &ldquo;{duplicateExTarget?.exercises.name}&rdquo; with the same parameters to another week and day.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleDuplicateExercise} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dupExWeek">Target Week *</Label>
                <Input
                  id="dupExWeek"
                  name="targetWeek"
                  type="number"
                  min={1}
                  max={localTotalWeeks}
                  required
                  defaultValue={selectedWeek}
                  disabled={isDuplicatingEx}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dupExDay">Target Day *</Label>
                <select
                  id="dupExDay"
                  name="targetDay"
                  required
                  disabled={isDuplicatingEx}
                  defaultValue={duplicateExTarget?.day_of_week ?? 1}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((name, i) => (
                    <option key={i + 1} value={i + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDuplicateExTarget(null)}
                disabled={isDuplicatingEx}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isDuplicatingEx}>
                {isDuplicatingEx ? "Duplicating..." : "Duplicate"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* AI Generate Week Dialog */}
      <GenerationDialog
        mode="week"
        open={generateWeekOpen}
        onOpenChange={setGenerateWeekOpen}
        programId={programId}
        assignmentId={assignmentInfo?.assignmentId}
        clientId={assignmentInfo?.clientId}
        currentWeekCount={localTotalWeeks}
        targetWeekNumber={selectedWeekIsBlank ? selectedWeek : undefined}
        poolExerciseIds={poolExercises.map((e) => e.id)}
        onGenerated={(newWeekNumber) => {
          if (!selectedWeekIsBlank) {
            setLocalTotalWeeks(newWeekNumber)
          }
          setSelectedWeek(newWeekNumber)
        }}
      />

      {/* AI Generate Day Dialog */}
      <GenerationDialog
        mode="day"
        open={generateDayOpen}
        onOpenChange={setGenerateDayOpen}
        programId={programId}
        assignmentId={assignmentInfo?.assignmentId}
        clientId={assignmentInfo?.clientId}
        weekNumber={selectedWeek}
        dayOfWeek={generateDayTarget}
        poolExerciseIds={poolExercises.map((e) => e.id)}
        onGenerated={() => {
          router.refresh()
        }}
      />
    </div>
  )
}
