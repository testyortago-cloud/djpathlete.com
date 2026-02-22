"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
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

  async function handleMoveUp(pe: ProgramExerciseWithExercise) {
    const dayExercises = getExercisesForDay(pe.day_of_week)
    const index = dayExercises.findIndex((e) => e.id === pe.id)
    if (index <= 0) return

    const above = dayExercises[index - 1]
    try {
      await Promise.all([
        fetch(`/api/admin/programs/${programId}/exercises/${pe.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_index: above.order_index }),
        }),
        fetch(`/api/admin/programs/${programId}/exercises/${above.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_index: pe.order_index }),
        }),
      ])
      router.refresh()
    } catch {
      toast.error("Failed to reorder exercise")
    }
  }

  async function handleMoveDown(pe: ProgramExerciseWithExercise) {
    const dayExercises = getExercisesForDay(pe.day_of_week)
    const index = dayExercises.findIndex((e) => e.id === pe.id)
    if (index >= dayExercises.length - 1) return

    const below = dayExercises[index + 1]
    try {
      await Promise.all([
        fetch(`/api/admin/programs/${programId}/exercises/${pe.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_index: below.order_index }),
        }),
        fetch(`/api/admin/programs/${programId}/exercises/${below.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_index: pe.order_index }),
        }),
      ])
      router.refresh()
    } catch {
      toast.error("Failed to reorder exercise")
    }
  }

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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[1, 2, 3, 4, 5, 6, 7].map((day) => (
          <DayColumn
            key={day}
            dayOfWeek={day}
            exercises={getExercisesForDay(day)}
            onAddExercise={handleAddExercise}
            onEditExercise={setEditTarget}
            onRemoveExercise={setDeleteTarget}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            onDuplicateExercise={handleDuplicateInPlace}
          />
        ))}
      </div>

      {/* Add Exercise Dialog */}
      <AddExerciseDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        programId={programId}
        weekNumber={selectedWeek}
        dayOfWeek={addDialogDay}
        exercises={exercises}
        existingCount={getExercisesForDay(addDialogDay).length}
      />

      {/* Edit Exercise Dialog */}
      <EditExerciseDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        programId={programId}
        programExercise={editTarget}
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
