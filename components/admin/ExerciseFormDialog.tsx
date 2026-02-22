"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronDown } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  exerciseFormSchema,
  EXERCISE_CATEGORIES,
  EXERCISE_DIFFICULTIES,
  MOVEMENT_PATTERNS,
  FORCE_TYPES,
  LATERALITY_OPTIONS,
  MUSCLE_OPTIONS,
  EQUIPMENT_OPTIONS,
  type ExerciseFormData,
} from "@/lib/validators/exercise"
import { extractYouTubeId, getYouTubeEmbedUrl } from "@/lib/youtube"
import { ExerciseRelationships } from "@/components/admin/ExerciseRelationships"
import { useFormTour } from "@/hooks/use-form-tour"
import { FormTour } from "@/components/admin/FormTour"
import { TourButton } from "@/components/admin/TourButton"
import { getExerciseTourSteps } from "@/lib/tour-steps"
import type { Exercise } from "@/types/database"

interface ExerciseFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  exercise?: Exercise | null
}

const CATEGORY_LABELS: Record<string, string> = {
  strength: "Strength",
  cardio: "Cardio",
  flexibility: "Flexibility",
  plyometric: "Plyometric",
  sport_specific: "Sport Specific",
  recovery: "Recovery",
}

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
}

const MOVEMENT_PATTERN_LABELS: Record<string, string> = {
  push: "Push",
  pull: "Pull",
  squat: "Squat",
  hinge: "Hinge",
  lunge: "Lunge",
  carry: "Carry",
  rotation: "Rotation",
  isometric: "Isometric",
  locomotion: "Locomotion",
}

const FORCE_TYPE_LABELS: Record<string, string> = {
  push: "Push",
  pull: "Pull",
  static: "Static",
  dynamic: "Dynamic",
}

const LATERALITY_LABELS: Record<string, string> = {
  bilateral: "Bilateral",
  unilateral: "Unilateral",
  alternating: "Alternating",
}

const MUSCLE_LABELS: Record<string, string> = {
  chest: "Chest",
  upper_back: "Upper Back",
  lats: "Lats",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  core: "Core",
  obliques: "Obliques",
  lower_back: "Lower Back",
  glutes: "Glutes",
  quadriceps: "Quadriceps",
  hamstrings: "Hamstrings",
  calves: "Calves",
  hip_flexors: "Hip Flexors",
  adductors: "Adductors",
  abductors: "Abductors",
  traps: "Traps",
  neck: "Neck",
}

const EQUIPMENT_LABELS: Record<string, string> = {
  barbell: "Barbell",
  dumbbell: "Dumbbell",
  kettlebell: "Kettlebell",
  cable_machine: "Cable Machine",
  smith_machine: "Smith Machine",
  resistance_band: "Resistance Band",
  pull_up_bar: "Pull-up Bar",
  bench: "Bench",
  squat_rack: "Squat Rack",
  leg_press: "Leg Press",
  leg_curl_machine: "Leg Curl Machine",
  lat_pulldown_machine: "Lat Pulldown Machine",
  rowing_machine: "Rowing Machine",
  treadmill: "Treadmill",
  bike: "Bike",
  box: "Box",
  plyo_box: "Plyo Box",
  medicine_ball: "Medicine Ball",
  stability_ball: "Stability Ball",
  foam_roller: "Foam Roller",
  trx: "TRX",
  landmine: "Landmine",
  sled: "Sled",
  battle_ropes: "Battle Ropes",
  agility_ladder: "Agility Ladder",
  cones: "Cones",
  yoga_mat: "Yoga Mat",
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

export function ExerciseFormDialog({
  open,
  onOpenChange,
  exercise: initialExercise,
}: ExerciseFormDialogProps) {
  const router = useRouter()
  const [exercise, setExercise] = useState(initialExercise)
  const isEditing = !!exercise
  const dialogRef = useRef<HTMLDivElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset when the dialog reopens with a different exercise
  useEffect(() => {
    setExercise(initialExercise)
  }, [initialExercise, open])
  const [errors, setErrors] = useState<Partial<Record<keyof ExerciseFormData, string[]>>>({})
  const [videoUrl, setVideoUrl] = useState(exercise?.video_url ?? "")
  const [aiOpen, setAiOpen] = useState(false)

  // Multi-select state
  const [selectedCategories, setSelectedCategories] = useState<string[]>(exercise?.category ?? [])
  const [primaryMuscles, setPrimaryMuscles] = useState<string[]>(exercise?.primary_muscles ?? [])
  const [secondaryMuscles, setSecondaryMuscles] = useState<string[]>(exercise?.secondary_muscles ?? [])
  const [equipmentRequired, setEquipmentRequired] = useState<string[]>(exercise?.equipment_required ?? [])

  const tour = useFormTour({
    steps: getExerciseTourSteps(() => setAiOpen(true)),
    scrollContainerRef: dialogRef,
  })

  const youtubeId = videoUrl ? extractYouTubeId(videoUrl) : null
  const [iframeLoaded, setIframeLoaded] = useState(false)

  const handleIframeLoad = useCallback(() => setIframeLoaded(true), [])

  function toggleItem(arr: string[], item: string, setter: (v: string[]) => void) {
    setter(arr.includes(item) ? arr.filter((i) => i !== item) : [...arr, item])
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})

    const formData = new FormData(e.currentTarget)
    const data = {
      name: formData.get("name") as string,
      description: formData.get("description") as string,
      category: selectedCategories,
      muscle_group: formData.get("muscle_group") as string,
      difficulty: formData.get("difficulty") as string,
      equipment: formData.get("equipment") as string,
      video_url: formData.get("video_url") as string,
      instructions: formData.get("instructions") as string,
      // AI metadata
      movement_pattern: (formData.get("movement_pattern") as string) || null,
      force_type: (formData.get("force_type") as string) || null,
      laterality: (formData.get("laterality") as string) || null,
      primary_muscles: primaryMuscles,
      secondary_muscles: secondaryMuscles,
      equipment_required: equipmentRequired,
      is_bodyweight: formData.get("is_bodyweight") === "on",
      is_compound: formData.get("is_compound") !== "off",
    }

    const result = exerciseFormSchema.safeParse(data)
    if (!result.success) {
      setErrors(result.error.flatten().fieldErrors)
      return
    }

    setIsSubmitting(true)

    try {
      const url = isEditing
        ? `/api/admin/exercises/${exercise.id}`
        : "/api/admin/exercises"
      const method = isEditing ? "PATCH" : "POST"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Request failed")
      }

      const responseData = await response.json()

      if (isEditing) {
        toast.success("Exercise updated successfully")
        onOpenChange(false)
      } else {
        toast.success("Exercise created — add alternative exercises below, or close when done")
        setExercise(responseData)
      }
      router.refresh()
    } catch {
      toast.error(isEditing ? "Failed to update exercise" : "Failed to create exercise")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) tour.close(); onOpenChange(o) }}>
      <DialogContent ref={dialogRef} className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{isEditing ? "Edit Exercise" : "Add Exercise"}</DialogTitle>
            <TourButton onClick={tour.start} />
          </div>
          <DialogDescription>
            {isEditing
              ? "Update the exercise details below."
              : "Fill in the details to create a new exercise."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              name="name"
              defaultValue={exercise?.name ?? ""}
              placeholder="e.g. Barbell Back Squat"
              required
              disabled={isSubmitting}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name[0]}</p>
            )}
          </div>

          {/* Category (multi-select) */}
          <div className="space-y-2">
            <Label>Category *</Label>
            <div id="category" className="flex flex-wrap gap-1.5">
              {EXERCISE_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleItem(selectedCategories, cat, setSelectedCategories)}
                  disabled={isSubmitting}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    selectedCategories.includes(cat)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
            {errors.category && (
              <p className="text-xs text-destructive">{errors.category[0]}</p>
            )}
          </div>

          {/* Difficulty */}
          <div className="space-y-2">
            <Label htmlFor="difficulty">Difficulty *</Label>
            <select
              id="difficulty"
              name="difficulty"
              defaultValue={exercise?.difficulty ?? ""}
              required
              disabled={isSubmitting}
              className={selectClass}
            >
              <option value="" disabled>Select difficulty</option>
              {EXERCISE_DIFFICULTIES.map((diff) => (
                <option key={diff} value={diff}>{DIFFICULTY_LABELS[diff]}</option>
              ))}
            </select>
            {errors.difficulty && (
              <p className="text-xs text-destructive">{errors.difficulty[0]}</p>
            )}
          </div>

          {/* Muscle Group & Equipment */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="muscle_group">Muscle Group</Label>
              <Input
                id="muscle_group"
                name="muscle_group"
                defaultValue={exercise?.muscle_group ?? ""}
                placeholder="e.g. Quadriceps, Glutes"
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">Quick label for cards and lists (e.g. &ldquo;Chest &amp; Triceps&rdquo;). For AI matching, use Primary Muscles below.</p>
              {errors.muscle_group && (
                <p className="text-xs text-destructive">{errors.muscle_group[0]}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipment">Equipment</Label>
              <Input
                id="equipment"
                name="equipment"
                defaultValue={exercise?.equipment ?? ""}
                placeholder="e.g. Barbell, Squat Rack"
                disabled={isSubmitting}
              />
              {errors.equipment && (
                <p className="text-xs text-destructive">{errors.equipment[0]}</p>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={exercise?.description ?? ""}
              placeholder="Brief description of the exercise..."
              disabled={isSubmitting}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
            {errors.description && (
              <p className="text-xs text-destructive">{errors.description[0]}</p>
            )}
          </div>

          {/* Instructions */}
          <div className="space-y-2">
            <Label htmlFor="instructions">Instructions</Label>
            <textarea
              id="instructions"
              name="instructions"
              rows={4}
              defaultValue={exercise?.instructions ?? ""}
              placeholder="Step-by-step instructions..."
              disabled={isSubmitting}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
            {errors.instructions && (
              <p className="text-xs text-destructive">{errors.instructions[0]}</p>
            )}
          </div>

          {/* Video URL */}
          <div className="space-y-2">
            <Label htmlFor="video_url">Video URL</Label>
            <Input
              id="video_url"
              name="video_url"
              type="url"
              value={videoUrl}
              onChange={(e) => {
                setVideoUrl(e.target.value)
                setIframeLoaded(false)
              }}
              placeholder="https://youtube.com/watch?v=..."
              disabled={isSubmitting}
            />
            {errors.video_url && (
              <p className="text-xs text-destructive">{errors.video_url[0]}</p>
            )}
            {youtubeId && (
              <div className="max-w-sm">
                <div className="relative rounded-lg overflow-hidden border border-border aspect-video">
                  {!iframeLoaded && (
                    <Skeleton className="absolute inset-0 rounded-none" />
                  )}
                  <iframe
                    key={youtubeId}
                    src={getYouTubeEmbedUrl(youtubeId)}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title="Video preview"
                    onLoad={handleIframeLoad}
                  />
                </div>
              </div>
            )}
          </div>

          {/* AI Metadata (collapsible) */}
          <div className="border border-border rounded-lg">
            <button
              type="button"
              onClick={() => setAiOpen(!aiOpen)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-surface/50 transition-colors rounded-lg"
            >
              AI Metadata (for smart program generation)
              <ChevronDown className={`size-4 transition-transform ${aiOpen ? "rotate-180" : ""}`} />
            </button>
            {aiOpen && (
              <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
                <p className="text-xs text-muted-foreground">These fields help the AI generate better programs and find suitable alternatives. They don&apos;t appear on exercise cards.</p>
                {/* Movement Pattern & Force Type */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="movement_pattern">Movement Pattern</Label>
                    <select
                      id="movement_pattern"
                      name="movement_pattern"
                      defaultValue={exercise?.movement_pattern ?? ""}
                      disabled={isSubmitting}
                      className={selectClass}
                    >
                      <option value="">None</option>
                      {MOVEMENT_PATTERNS.map((mp) => (
                        <option key={mp} value={mp}>{MOVEMENT_PATTERN_LABELS[mp]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="force_type">Force Type</Label>
                    <select
                      id="force_type"
                      name="force_type"
                      defaultValue={exercise?.force_type ?? ""}
                      disabled={isSubmitting}
                      className={selectClass}
                    >
                      <option value="">None</option>
                      {FORCE_TYPES.map((ft) => (
                        <option key={ft} value={ft}>{FORCE_TYPE_LABELS[ft]}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Laterality */}
                <div className="space-y-2">
                  <Label htmlFor="laterality">Laterality</Label>
                  <select
                    id="laterality"
                    name="laterality"
                    defaultValue={exercise?.laterality ?? ""}
                    disabled={isSubmitting}
                    className={selectClass}
                  >
                    <option value="">None</option>
                    {LATERALITY_OPTIONS.map((lat) => (
                      <option key={lat} value={lat}>{LATERALITY_LABELS[lat]}</option>
                    ))}
                  </select>
                </div>

                {/* Primary Muscles (multi-select via checkboxes) */}
                <div className="space-y-2">
                  <Label>Primary Muscles</Label>
                  <p className="text-xs text-muted-foreground">Used by AI for exercise matching and program balancing</p>
                  <div id="primary_muscles" className="flex flex-wrap gap-1.5">
                    {MUSCLE_OPTIONS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => toggleItem(primaryMuscles, m, setPrimaryMuscles)}
                        disabled={isSubmitting}
                        className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                          primaryMuscles.includes(m)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {MUSCLE_LABELS[m]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Secondary Muscles */}
                <div className="space-y-2">
                  <Label>Secondary Muscles</Label>
                  <p className="text-xs text-muted-foreground">Muscles that assist in the movement</p>
                  <div id="secondary_muscles" className="flex flex-wrap gap-1.5">
                    {MUSCLE_OPTIONS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => toggleItem(secondaryMuscles, m, setSecondaryMuscles)}
                        disabled={isSubmitting}
                        className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                          secondaryMuscles.includes(m)
                            ? "bg-accent text-accent-foreground border-accent"
                            : "bg-background border-border text-muted-foreground hover:border-accent/50"
                        }`}
                      >
                        {MUSCLE_LABELS[m]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Equipment Required */}
                <div className="space-y-2">
                  <Label>Equipment Required</Label>
                  <div id="equipment_required" className="flex flex-wrap gap-1.5">
                    {EQUIPMENT_OPTIONS.map((eq) => (
                      <button
                        key={eq}
                        type="button"
                        onClick={() => toggleItem(equipmentRequired, eq, setEquipmentRequired)}
                        disabled={isSubmitting}
                        className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                          equipmentRequired.includes(eq)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {EQUIPMENT_LABELS[eq]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Bodyweight & Compound checkboxes */}
                <div id="bodyweight_compound" className="flex gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="is_bodyweight"
                      defaultChecked={exercise?.is_bodyweight ?? false}
                      disabled={isSubmitting}
                      className="rounded border-border"
                    />
                    Bodyweight
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="is_compound"
                      defaultChecked={exercise?.is_compound ?? true}
                      disabled={isSubmitting}
                      value="on"
                      className="rounded border-border"
                    />
                    Compound
                  </label>
                  {/* Hidden field to send "off" when unchecked */}
                  <input type="hidden" name="is_compound_default" value="true" />
                </div>
              </div>
            )}
          </div>

          {/* Alternative Exercises */}
          {isEditing && exercise && (
            <div id="exercise-alternatives">
              <ExerciseRelationships
                exerciseId={exercise.id}
                exerciseName={exercise.name}
              />
            </div>
          )}

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
              {isSubmitting
                ? isEditing ? "Saving..." : "Creating..."
                : isEditing ? "Save Changes" : "Create Exercise"}
            </Button>
          </DialogFooter>
        </form>
        <FormTour {...tour} />
      </DialogContent>
    </Dialog>
  )
}
