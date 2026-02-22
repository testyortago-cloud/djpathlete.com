"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Search, ArrowLeft, Repeat2, Loader2 } from "lucide-react"
import Image from "next/image"
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
import { Badge } from "@/components/ui/badge"
import { extractYouTubeId, getYouTubeThumbnailUrl } from "@/lib/youtube"
import { useFormTour } from "@/hooks/use-form-tour"
import { FormTour } from "@/components/admin/FormTour"
import { TourButton } from "@/components/admin/TourButton"
import { ADD_EXERCISE_TOUR_STEPS } from "@/lib/tour-steps"
import type { Exercise, ExerciseCategory } from "@/types/database"
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
  exercise_id: "Exercise",
  week_number: "Week",
  day_of_week: "Day",
  order_index: "Order",
}

interface AddExerciseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  programId: string
  weekNumber: number
  dayOfWeek: number
  exercises: Exercise[]
  existingCount: number
}

const CATEGORY_LABELS: Record<string, string> = {
  strength: "Strength",
  cardio: "Cardio",
  flexibility: "Flexibility",
  plyometric: "Plyometric",
  sport_specific: "Sport Specific",
  recovery: "Recovery",
}

interface AlternativeExercise {
  id: string
  exercises: { name: string }
}

function AlternativeExercisesReadonly({ exerciseId }: { exerciseId: string }) {
  const [alternatives, setAlternatives] = useState<AlternativeExercise[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchAlternatives = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/admin/exercise-relationships?exerciseId=${exerciseId}`
      )
      if (!response.ok) throw new Error("Failed to fetch")
      const data = await response.json()
      setAlternatives(
        data.filter((r: { relationship_type: string }) => r.relationship_type === "alternative")
      )
    } catch {
      // Silently fail — informational only
    } finally {
      setIsLoading(false)
    }
  }, [exerciseId])

  useEffect(() => {
    fetchAlternatives()
  }, [fetchAlternatives])

  if (isLoading) return null
  if (alternatives.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-surface/30 px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Repeat2 className="size-3.5 text-primary" />
        <span className="text-xs font-medium text-muted-foreground">
          Alternatives ({alternatives.length})
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {alternatives.map((alt) => (
          <Badge key={alt.id} variant="secondary" className="text-xs">
            {alt.exercises?.name ?? "Unknown"}
          </Badge>
        ))}
      </div>
    </div>
  )
}

export function AddExerciseDialog({
  open,
  onOpenChange,
  programId,
  weekNumber,
  dayOfWeek,
  exercises,
  existingCount,
}: AddExerciseDialogProps) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const tour = useFormTour({ steps: ADD_EXERCISE_TOUR_STEPS, scrollContainerRef: dialogRef })

  function resetAndClose(openState: boolean) {
    if (!openState) {
      tour.close()
      setStep(1)
      setSelectedExercise(null)
      setSearch("")
      setCategoryFilter("all")
    }
    onOpenChange(openState)
  }

  const filtered = exercises.filter((ex) => {
    const matchesSearch = !search || ex.name.toLowerCase().includes(search.toLowerCase())
    const cats: string[] = Array.isArray(ex.category) ? ex.category : [ex.category]
    const matchesCategory = categoryFilter === "all" || cats.includes(categoryFilter)
    return matchesSearch && matchesCategory
  })

  function handleSelectExercise(exercise: Exercise) {
    setSelectedExercise(exercise)
    setStep(2)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selectedExercise) return

    const formData = new FormData(e.currentTarget)
    const setsVal = formData.get("sets") as string
    const repsVal = formData.get("reps") as string
    const catFields = getCategoryFields(selectedExercise!.category as ExerciseCategory[])

    // Client-side validation for required fields
    if (!setsVal) {
      toast.error("Please enter at least the number of sets")
      return
    }
    if (isNaN(Number(setsVal)) || Number(setsVal) < 1) {
      toast.error("Sets must be at least 1")
      return
    }

    setIsSubmitting(true)

    const body = {
      exercise_id: selectedExercise.id,
      week_number: weekNumber,
      day_of_week: dayOfWeek,
      order_index: existingCount,
      sets: setsVal || null,
      reps: repsVal || null,
      rest_seconds: formData.get("rest_seconds") || null,
      duration_seconds: formData.get("duration_seconds") || null,
      notes: formData.get("notes") || null,
      rpe_target: formData.get("rpe_target") || null,
      intensity_pct: formData.get("intensity_pct") || null,
      tempo: formData.get("tempo") || null,
      group_tag: formData.get("group_tag") || null,
    }

    try {
      const response = await fetch(`/api/admin/programs/${programId}/exercises`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

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
        throw new Error(data.error || "Failed to add exercise")
      }

      toast.success("Exercise added")
      resetAndClose(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add exercise")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent ref={dialogRef} className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>
              {step === 1 ? "Select Exercise" : "Configure Exercise"}
            </DialogTitle>
            {step === 2 && <TourButton onClick={tour.start} />}
          </div>
          <DialogDescription>
            {step === 1
              ? "Search and select an exercise from the library."
              : `Set parameters for ${selectedExercise?.name}.`}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-3 overflow-y-auto min-h-0">
            {/* Search & filter */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search exercises..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground"
              >
                <option value="all">All</option>
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            {/* Exercise list */}
            <div className="max-h-[350px] overflow-y-auto space-y-1">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No exercises found.
                </p>
              ) : (
                filtered.map((ex) => {
                  const ytId = ex.video_url ? extractYouTubeId(ex.video_url) : null
                  const thumb = ytId ? getYouTubeThumbnailUrl(ytId) : null
                  return (
                    <button
                      key={ex.id}
                      type="button"
                      className="w-full flex items-center gap-3 rounded-lg border border-border p-2 text-left hover:bg-surface/50 transition-colors"
                      onClick={() => handleSelectExercise(ex)}
                    >
                      {thumb && (
                        <Image
                          src={thumb}
                          alt={ex.name}
                          width={48}
                          height={36}
                          className="rounded object-cover"
                          unoptimized
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{ex.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {(Array.isArray(ex.category) ? ex.category : [ex.category]).map((c) => CATEGORY_LABELS[c] ?? c).join(", ")}
                          {ex.muscle_group && ` · ${ex.muscle_group}`}
                        </p>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto min-h-0">
            {(() => {
              const catFields = getCategoryFields(selectedExercise!.category as ExerciseCategory[])
              return (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setStep(1)}
                    className="mb-2"
                  >
                    <ArrowLeft className="size-3.5" />
                    Back to selection
                  </Button>

                  <AlternativeExercisesReadonly exerciseId={selectedExercise!.id} />

                  <p className="text-xs text-muted-foreground">Fields marked with * are recommended.</p>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="sets">Sets *</Label>
                      <Input id="sets" name="sets" type="number" min={1} placeholder="e.g. 3" />
                    </div>
                    {catFields.showReps && (
                      <div className="space-y-2">
                        <Label htmlFor="reps">Reps *</Label>
                        <Input id="reps" name="reps" placeholder="e.g. 8-12" />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {catFields.showRest && (
                      <div className="space-y-2">
                        <Label htmlFor="rest_seconds">Rest (seconds)</Label>
                        <Input id="rest_seconds" name="rest_seconds" type="number" min={0} placeholder="e.g. 60" />
                      </div>
                    )}
                    {catFields.showDuration && (
                      <div className="space-y-2">
                        <Label htmlFor="duration_seconds">
                          Duration (seconds){catFields.showDuration === "prominent" ? " *" : ""}
                        </Label>
                        <Input id="duration_seconds" name="duration_seconds" type="number" min={0} placeholder="e.g. 30" />
                      </div>
                    )}
                  </div>

                  {/* Intensity fields — only for categories that use them */}
                  {(catFields.showRpe || catFields.showIntensity) && (
                    <div className="grid grid-cols-2 gap-4">
                      {catFields.showRpe && (
                        <div className="space-y-2">
                          <Label htmlFor="rpe_target">RPE Target (1-10)</Label>
                          <Input id="rpe_target" name="rpe_target" type="number" min={1} max={10} step={0.5} placeholder="e.g. 7" />
                        </div>
                      )}
                      {catFields.showIntensity && (
                        <div className="space-y-2">
                          <Label htmlFor="intensity_pct">Intensity (%1RM)</Label>
                          <Input id="intensity_pct" name="intensity_pct" type="number" min={0} max={100} placeholder="e.g. 75" />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    {catFields.showTempo && (
                      <div className="space-y-2">
                        <Label htmlFor="tempo">Tempo</Label>
                        <Input id="tempo" name="tempo" placeholder="e.g. 3-1-2-0" />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="group_tag">Group Tag (Supersets)</Label>
                      <Input id="group_tag" name="group_tag" placeholder="e.g. A1" />
                      <p className="text-xs text-muted-foreground">Same letter = done together (A1 + A2 = superset, B1 + B2 + B3 = tri-set). Leave blank for straight sets.</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes</Label>
                    <textarea
                      id="notes"
                      name="notes"
                      rows={2}
                      placeholder="Any specific instructions..."
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                    />
                  </div>

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => resetAndClose(false)}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? "Adding..." : "Add Exercise"}
                    </Button>
                  </DialogFooter>
                </>
              )
            })()}
          </form>
        )}
        <FormTour {...tour} />
      </DialogContent>
    </Dialog>
  )
}
