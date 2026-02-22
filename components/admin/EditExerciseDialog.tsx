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
import type { Exercise, ExerciseCategory, ProgramExercise } from "@/types/database"
import { getCategoryFields } from "@/lib/exercise-fields"

const FIELD_LABELS: Record<string, string> = {
  sets: "Sets",
  reps: "Reps",
  rest_seconds: "Rest",
  duration_seconds: "Duration",
  rpe_target: "RPE Target",
  intensity_pct: "Intensity",
  tempo: "Tempo",
  group_tag: "Superset Group",
  notes: "Notes",
}

interface EditExerciseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  programId: string
  programExercise: (ProgramExercise & { exercises: Exercise }) | null
}

export function EditExerciseDialog({
  open,
  onOpenChange,
  programId,
  programExercise,
}: EditExerciseDialogProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!programExercise) return null

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!programExercise) return
    setIsSubmitting(true)

    const formData = new FormData(e.currentTarget)
    const raw: Record<string, unknown> = {
      sets: formData.get("sets") || null,
      reps: formData.get("reps") || null,
      rest_seconds: formData.get("rest_seconds") || null,
      duration_seconds: formData.get("duration_seconds") || null,
      notes: formData.get("notes") || null,
      rpe_target: formData.get("rpe_target") || null,
      intensity_pct: formData.get("intensity_pct") || null,
      tempo: formData.get("tempo") || null,
      group_tag: formData.get("group_tag") || null,
    }
    // Only send fields that have a value — omit nulls so existing DB values aren't overwritten
    const body = Object.fromEntries(
      Object.entries(raw).filter(([, v]) => v !== null)
    )

    try {
      const response = await fetch(
        `/api/admin/programs/${programId}/exercises/${programExercise.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        if (data.details) {
          const errorMessages = Object.entries(data.details)
            .filter(([, v]) => Array.isArray(v) && (v as string[]).length > 0)
            .map(([field, msgs]) => `${FIELD_LABELS[field] ?? field}: ${(msgs as string[])[0]}`)
          if (errorMessages.length > 0) {
            toast.error(errorMessages.join(". "))
            return
          }
        }
        throw new Error(data.error || "Failed to update")
      }

      toast.success("Exercise updated")
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update exercise")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Exercise Parameters</DialogTitle>
          <DialogDescription>
            Update parameters for {programExercise.exercises.name}.
          </DialogDescription>
        </DialogHeader>

        {(() => {
          const catFields = getCategoryFields(programExercise.exercises.category as ExerciseCategory[])
          return (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-sets">Sets *</Label>
                  <Input
                    id="edit-sets"
                    name="sets"
                    type="number"
                    min={1}
                    defaultValue={programExercise.sets ?? ""}
                    placeholder="e.g. 3"
                  />
                </div>
                {catFields.showReps && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-reps">Reps *</Label>
                    <Input
                      id="edit-reps"
                      name="reps"
                      defaultValue={programExercise.reps ?? ""}
                      placeholder="e.g. 8-12"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {catFields.showRest && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-rest">Rest (seconds)</Label>
                    <Input
                      id="edit-rest"
                      name="rest_seconds"
                      type="number"
                      min={0}
                      defaultValue={programExercise.rest_seconds ?? ""}
                      placeholder="e.g. 60"
                    />
                  </div>
                )}
                {catFields.showDuration && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-duration">
                      Duration (seconds){catFields.showDuration === "prominent" ? " *" : ""}
                    </Label>
                    <Input
                      id="edit-duration"
                      name="duration_seconds"
                      type="number"
                      min={0}
                      defaultValue={programExercise.duration_seconds ?? ""}
                      placeholder="e.g. 30"
                    />
                  </div>
                )}
              </div>

              {/* Intensity fields — only for categories that use them */}
              {(catFields.showRpe || catFields.showIntensity) && (
                <div className="grid grid-cols-2 gap-4">
                  {catFields.showRpe && (
                    <div className="space-y-2">
                      <Label htmlFor="edit-rpe">RPE Target</Label>
                      <Input
                        id="edit-rpe"
                        name="rpe_target"
                        type="number"
                        min={1}
                        max={10}
                        step={0.5}
                        defaultValue={programExercise.rpe_target ?? ""}
                        placeholder="e.g. 7"
                      />
                    </div>
                  )}
                  {catFields.showIntensity && (
                    <div className="space-y-2">
                      <Label htmlFor="edit-intensity">Intensity (%1RM)</Label>
                      <Input
                        id="edit-intensity"
                        name="intensity_pct"
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={programExercise.intensity_pct ?? ""}
                        placeholder="e.g. 75"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {catFields.showTempo && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-tempo">Tempo</Label>
                    <Input
                      id="edit-tempo"
                      name="tempo"
                      defaultValue={programExercise.tempo ?? ""}
                      placeholder="e.g. 3-1-2-0"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="edit-group-tag">Superset Group</Label>
                  <Input
                    id="edit-group-tag"
                    name="group_tag"
                    defaultValue={programExercise.group_tag ?? ""}
                    placeholder="e.g. A1"
                  />
                  <p className="text-xs text-muted-foreground">Same letter = done together (A1 + A2 = superset, B1 + B2 + B3 = tri-set). Leave blank for straight sets.</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-notes">Notes</Label>
                <textarea
                  id="edit-notes"
                  name="notes"
                  rows={2}
                  defaultValue={programExercise.notes ?? ""}
                  placeholder="Any specific instructions..."
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          )
        })()}
      </DialogContent>
    </Dialog>
  )
}
