"use client"

import { useState, useCallback } from "react"
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
import { WeekSelector } from "@/components/admin/WeekSelector"
import { DayColumn } from "@/components/admin/DayColumn"
import { AddExerciseDialog } from "@/components/admin/AddExerciseDialog"
import { EditExerciseDialog } from "@/components/admin/EditExerciseDialog"
import { ExerciseCard } from "@/components/admin/ExerciseCard"
import type { Exercise, ProgramExercise } from "@/types/database"

type ProgramExerciseWithExercise = ProgramExercise & { exercises: Exercise }

interface ProgramBuilderProps {
  programId: string
  totalWeeks: number
  programExercises: ProgramExerciseWithExercise[]
  exercises: Exercise[]
}

export function ProgramBuilder({
  programId,
  totalWeeks,
  programExercises,
  exercises,
}: ProgramBuilderProps) {
  const router = useRouter()
  const [selectedWeek, setSelectedWeek] = useState(1)

  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addDialogDay, setAddDialogDay] = useState(1)
  const [editTarget, setEditTarget] = useState<ProgramExerciseWithExercise | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProgramExerciseWithExercise | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Duplicate week dialog
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)

  // Active drag item (for overlay)
  const [activeExercise, setActiveExercise] = useState<ProgramExerciseWithExercise | null>(null)

  // Duplicate exercise dialog
  const [duplicateExTarget, setDuplicateExTarget] = useState<ProgramExerciseWithExercise | null>(null)
  const [isDuplicatingEx, setIsDuplicatingEx] = useState(false)
  const [isDuplicatingInPlace, setIsDuplicatingInPlace] = useState(false)

  // Group exercises for the selected week by day
  const weekExercises = programExercises.filter(
    (pe) => pe.week_number === selectedWeek
  )

  function getExercisesForDay(day: number) {
    return weekExercises
      .filter((pe) => pe.day_of_week === day)
      .sort((a, b) => a.order_index - b.order_index)
  }

  function handleAddExercise(day: number) {
    setAddDialogDay(day)
    setAddDialogOpen(true)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const exercise = weekExercises.find((pe) => pe.id === event.active.id)
    setActiveExercise(exercise ?? null)
  }, [weekExercises])

  /** Determine which day a droppable/sortable ID belongs to */
  function getDayFromId(id: string | number): number | null {
    const idStr = String(id)
    // Droppable container IDs: "day-1" through "day-7"
    if (idStr.startsWith("day-")) return Number(idStr.split("-")[1])
    // Exercise IDs: find the exercise and return its day
    const exercise = weekExercises.find((pe) => pe.id === idStr)
    return exercise ? exercise.day_of_week : null
  }

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveExercise(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const draggedExercise = weekExercises.find((pe) => pe.id === active.id)
    if (!draggedExercise) return

    const sourceDay = draggedExercise.day_of_week
    const targetDay = getDayFromId(over.id)
    if (!targetDay) return

    if (sourceDay === targetDay) {
      // Same-day reorder
      const dayExercises = getExercisesForDay(sourceDay)
      const oldIndex = dayExercises.findIndex((pe) => pe.id === active.id)
      const newIndex = dayExercises.findIndex((pe) => pe.id === over.id)

      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return

      const reordered = arrayMove(dayExercises, oldIndex, newIndex)
      try {
        await Promise.all(
          reordered.map((pe, i) =>
            fetch(`/api/admin/programs/${programId}/exercises/${pe.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ order_index: i }),
            })
          )
        )
        router.refresh()
      } catch {
        toast.error("Failed to reorder exercises")
      }
    } else {
      // Cross-day move
      const targetDayExercises = getExercisesForDay(targetDay)
      const overExercise = targetDayExercises.find((pe) => pe.id === over.id)
      // Insert at the position of the exercise being hovered, or at the end
      const insertIndex = overExercise
        ? targetDayExercises.indexOf(overExercise)
        : targetDayExercises.length

      try {
        // 1. Move the dragged exercise to the target day at the insert position
        await fetch(`/api/admin/programs/${programId}/exercises/${draggedExercise.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            day_of_week: targetDay,
            order_index: insertIndex,
          }),
        })

        // 2. Re-index remaining exercises in target day (shift items at/after insertIndex up by 1)
        const reindexTarget = targetDayExercises
          .filter((pe) => pe.id !== draggedExercise.id)
          .map((pe, _i) => {
            const currentIdx = targetDayExercises.indexOf(pe)
            const newIdx = currentIdx >= insertIndex ? currentIdx + 1 : currentIdx
            return { id: pe.id, order_index: newIdx }
          })

        // 3. Re-index source day (close the gap)
        const sourceDayExercises = getExercisesForDay(sourceDay).filter(
          (pe) => pe.id !== draggedExercise.id
        )

        const updates = [
          ...reindexTarget.map((u) =>
            fetch(`/api/admin/programs/${programId}/exercises/${u.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ order_index: u.order_index }),
            })
          ),
          ...sourceDayExercises.map((pe, i) =>
            fetch(`/api/admin/programs/${programId}/exercises/${pe.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ order_index: i }),
            })
          ),
        ]

        await Promise.all(updates)
        router.refresh()
        const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        toast.success(`Moved to ${DAY_NAMES[targetDay - 1]}`)
      } catch {
        toast.error("Failed to move exercise")
      }
    }
  }, [weekExercises, programId, router])

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
            })
          )
        )
      }

      const response = await fetch(
        `/api/admin/programs/${programId}/exercises`,
        {
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
        }
      )

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

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)

    try {
      const response = await fetch(
        `/api/admin/programs/${programId}/exercises/${deleteTarget.id}`,
        { method: "DELETE" }
      )

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
      const response = await fetch(
        `/api/admin/programs/${programId}/duplicate-week`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceWeek: selectedWeek, targetWeek }),
        }
      )

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
      (pe) => pe.week_number === targetWeek && pe.day_of_week === targetDay
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
      const response = await fetch(
        `/api/admin/programs/${programId}/exercises`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )

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
      {/* Week selector */}
      <WeekSelector
        totalWeeks={totalWeeks}
        selectedWeek={selectedWeek}
        onSelectWeek={setSelectedWeek}
        onDuplicateWeek={() => setDuplicateOpen(true)}
      />

      {/* Day grid */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7].map((day) => (
            <DayColumn
              key={day}
              dayOfWeek={day}
              exercises={getExercisesForDay(day)}
              onAddExercise={handleAddExercise}
              onEditExercise={setEditTarget}
              onRemoveExercise={setDeleteTarget}
              onDuplicateExercise={handleDuplicateInPlace}
            />
          ))}
        </div>
        <DragOverlay>
          {activeExercise ? (
            <ExerciseCard
              programExercise={activeExercise}
              onEdit={() => {}}
              onRemove={() => {}}
              isOverlay
            />
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
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Removing..." : "Remove"}
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
              Copy all exercises from Week {selectedWeek} to another week. Existing exercises in the target week will be kept.
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
                max={totalWeeks}
                required
                defaultValue={selectedWeek < totalWeeks ? selectedWeek + 1 : 1}
                disabled={isDuplicating}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDuplicateOpen(false)}
                disabled={isDuplicating}
              >
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
                  max={totalWeeks}
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
                    <option key={i + 1} value={i + 1}>{name}</option>
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
    </div>
  )
}
