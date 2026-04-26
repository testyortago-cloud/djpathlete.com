"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useAdminWeightUnit } from "@/hooks/use-admin-weight-unit"
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
import { useFormTour } from "@/hooks/use-form-tour"
import { FormTour } from "@/components/admin/FormTour"
import { TourButton } from "@/components/admin/TourButton"
import { EDIT_EXERCISE_TOUR_STEPS } from "@/lib/tour-steps"
import type { Exercise, ExerciseCategory, ProgramExercise } from "@/types/database"
import { getCategoryFields } from "@/lib/exercise-fields"
import {
  TRAINING_TECHNIQUE_OPTIONS,
  GROUPED_TECHNIQUES,
  type TrainingTechniqueOption,
} from "@/lib/validators/program-exercise"
import { ExerciseLinker } from "@/components/admin/ExerciseLinker"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { humanizeFieldError, summarizeApiError, type FieldErrors } from "@/lib/errors/humanize"

/** Find the next available group letter (A, B, C...) for the given day's exercises */
function getNextGroupLetter(dayExercises: (ProgramExercise & { exercises: Exercise })[]) {
  const usedLetters = new Set<string>()
  for (const pe of dayExercises) {
    if (pe.group_tag) {
      usedLetters.add(pe.group_tag.charAt(0).toUpperCase())
    }
  }
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code)
    if (!usedLetters.has(letter)) return letter
  }
  return "A"
}

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

const TECHNIQUE_CONFIG: Record<TrainingTechniqueOption, { label: string; description: string }> = {
  straight_set: { label: "Straight Sets", description: "Standard sets with rest between" },
  superset: { label: "Superset", description: "Two exercises back-to-back, no rest" },
  dropset: { label: "Drop Set", description: "Reduce weight, continue to failure" },
  giant_set: { label: "Giant Set", description: "3+ exercises back-to-back" },
  circuit: { label: "Circuit", description: "4+ exercises with minimal rest" },
  rest_pause: { label: "Rest-Pause", description: "Set to failure, rest 10-15s, continue" },
  amrap: { label: "AMRAP", description: "As many reps as possible" },
  cluster_set: { label: "Cluster Set", description: "Short intra-set rest between rep clusters" },
  complex: { label: "Complex", description: "Multiple movements flow together in one set" },
  emom: { label: "EMOM", description: "Every minute on the minute" },
  wave_loading: { label: "Wave Loading", description: "Ascending/descending sets (e.g., 3/2/1)" },
}

interface EditExerciseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  programId: string
  programExercise: (ProgramExercise & { exercises: Exercise }) | null
  /** All exercises on the same day, used for group tag helper */
  dayExercises?: (ProgramExercise & { exercises: Exercise })[]
}

export function EditExerciseDialog({
  open,
  onOpenChange,
  programId,
  programExercise,
  dayExercises = [],
}: EditExerciseDialogProps) {
  const router = useRouter()
  const { unit, displayWeight, toKg, unitLabel } = useAdminWeightUnit()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [technique, setTechnique] = useState<TrainingTechniqueOption>("straight_set")
  const [linkedExerciseIds, setLinkedExerciseIds] = useState<string[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const tour = useFormTour({ steps: EDIT_EXERCISE_TOUR_STEPS, scrollContainerRef: dialogRef })

  const needsGrouping = GROUPED_TECHNIQUES.includes(technique)

  // Sync state when dialog opens with a new exercise
  useEffect(() => {
    if (programExercise) {
      setTechnique((programExercise.technique as TrainingTechniqueOption) || "straight_set")
      // Pre-select exercises that share the same group_tag letter
      if (programExercise.group_tag) {
        const letter = programExercise.group_tag.charAt(0).toUpperCase()
        const peers = dayExercises
          .filter(
            (pe) => pe.id !== programExercise.id && pe.group_tag && pe.group_tag.charAt(0).toUpperCase() === letter,
          )
          .map((pe) => pe.id)
        setLinkedExerciseIds(peers)
      } else {
        setLinkedExerciseIds([])
      }
    }
  }, [programExercise, dayExercises])

  if (!programExercise) return null

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!programExercise) return
    setIsSubmitting(true)
    setFormError(null)
    setFieldErrors({})

    const formData = new FormData(e.currentTarget)

    // Compute group_tag
    let groupTag: string | null = null
    const oldLetter = programExercise.group_tag ? programExercise.group_tag.charAt(0).toUpperCase() : null

    if (needsGrouping && linkedExerciseIds.length > 0) {
      // Reuse existing letter if this exercise already had one, otherwise pick next available
      const letter = oldLetter || getNextGroupLetter(dayExercises)
      // This exercise gets number 1 in the group
      const linkedCount = linkedExerciseIds.length
      groupTag = `${letter}${linkedCount + 1}`
    }

    const body: Record<string, unknown> = {
      technique,
      sets: formData.get("sets") || null,
      reps: formData.get("reps") || null,
      rest_seconds: formData.get("rest_seconds") || null,
      duration_seconds: formData.get("duration_seconds") || null,
      notes: formData.get("notes") || null,
      rpe_target: formData.get("rpe_target") || null,
      intensity_pct: formData.get("intensity_pct") || null,
      suggested_weight_kg: formData.get("suggested_weight_kg")
        ? toKg(Number(formData.get("suggested_weight_kg")))
        : null,
      tempo: formData.get("tempo") || null,
      group_tag: groupTag,
    }

    try {
      const response = await fetch(`/api/admin/programs/${programId}/exercises/${programExercise.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const { message, fieldErrors: fe } = summarizeApiError(response, data, "Failed to update exercise")
        setFormError(message)
        setFieldErrors(fe)
        const firstEntry = Object.entries(fe).find(([, v]) => v && v.length > 0)
        if (firstEntry) {
          toast.error(humanizeFieldError(firstEntry[0], firstEntry[1]?.[0], FIELD_LABELS))
        } else {
          toast.error(message)
        }
        return
      }

      // Sync linked exercises' group_tag + technique
      if (needsGrouping && groupTag) {
        const letter = groupTag.charAt(0)
        // PATCH each linked exercise with matching group_tag
        await Promise.all(
          linkedExerciseIds.map(async (peId, idx) => {
            await fetch(`/api/admin/programs/${programId}/exercises/${peId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                group_tag: `${letter}${idx + 1}`,
                technique,
              }),
            })
          }),
        )
      }

      // Clear group_tag from exercises that were previously in this group but are now unlinked
      if (oldLetter) {
        const previouslyLinked = dayExercises.filter(
          (pe) => pe.id !== programExercise.id && pe.group_tag && pe.group_tag.charAt(0).toUpperCase() === oldLetter,
        )
        const unlinked = previouslyLinked.filter((pe) => !linkedExerciseIds.includes(pe.id))
        if (unlinked.length > 0) {
          await Promise.all(
            unlinked.map(async (pe) => {
              await fetch(`/api/admin/programs/${programId}/exercises/${pe.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  group_tag: null,
                  technique: "straight_set",
                }),
              })
            }),
          )
        }
      }

      toast.success("Exercise updated")
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : "We couldn't reach the server. Please try again."
      setFormError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) tour.close()
        onOpenChange(o)
      }}
    >
      <DialogContent ref={dialogRef} className="sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Edit Exercise Parameters</DialogTitle>
            <TourButton onClick={tour.start} />
          </div>
          <DialogDescription>Update parameters for {programExercise.exercises.name}.</DialogDescription>
        </DialogHeader>

        {(() => {
          const catFields = getCategoryFields(programExercise.exercises.category as ExerciseCategory[])
          return (
            <form id="edit-exercise-form" onSubmit={handleSubmit} className="space-y-4 overflow-y-auto min-h-0 pr-1">
              <FormErrorBanner message={formError} fieldErrors={fieldErrors} labels={FIELD_LABELS} />
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
                      Duration per set (sec){catFields.showDuration === "prominent" ? " *" : ""}
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

              {/* Weight & Intensity fields */}
              {(catFields.showWeight || catFields.showRpe || catFields.showIntensity) && (
                <div className="grid grid-cols-2 gap-4">
                  {catFields.showWeight && (
                    <div className="space-y-2">
                      <Label htmlFor="edit-weight">Suggested Weight ({unitLabel()})</Label>
                      <Input
                        id="edit-weight"
                        name="suggested_weight_kg"
                        type="number"
                        min={0}
                        step={0.5}
                        defaultValue={
                          programExercise.suggested_weight_kg != null
                            ? (displayWeight(programExercise.suggested_weight_kg) ?? "")
                            : ""
                        }
                        placeholder={unit === "lbs" ? "e.g. 135" : "e.g. 60"}
                        key={unit}
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

              {catFields.showRpe && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-rpe">RPE Target (1-10)</Label>
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
                </div>
              )}

              {/* Technique picker */}
              <div className="space-y-2">
                <Label>Method</Label>
                <div className="grid grid-cols-2 gap-2">
                  {TRAINING_TECHNIQUE_OPTIONS.map((t) => {
                    const config = TECHNIQUE_CONFIG[t]
                    const isSelected = technique === t
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setTechnique(t)
                          if (!GROUPED_TECHNIQUES.includes(t)) {
                            setLinkedExerciseIds([])
                          }
                        }}
                        className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border hover:bg-surface/50"
                        }`}
                      >
                        <span className="text-sm font-medium">{config.label}</span>
                        <span className="text-[11px] text-muted-foreground leading-tight">{config.description}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Exercise linker — shown for grouped techniques */}
              {needsGrouping && (
                <ExerciseLinker
                  technique={technique as "superset" | "giant_set" | "circuit"}
                  dayExercises={dayExercises}
                  excludeId={programExercise.id}
                  selectedIds={linkedExerciseIds}
                  onSelectionChange={setLinkedExerciseIds}
                />
              )}

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
            </form>
          )
        })()}

        <DialogFooter className="shrink-0 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="edit-exercise-form" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
        <FormTour {...tour} />
      </DialogContent>
    </Dialog>
  )
}
