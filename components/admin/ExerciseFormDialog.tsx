"use client"

import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { motion, AnimatePresence } from "framer-motion"
import {
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Loader2,
  RefreshCw,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  exerciseFormSchema,
  EXERCISE_CATEGORIES,
  EXERCISE_DIFFICULTIES,
  TRAINING_INTENTS,
  MOVEMENT_PATTERNS,
  FORCE_TYPES,
  LATERALITY_OPTIONS,
  MUSCLE_OPTIONS,
  EQUIPMENT_OPTIONS,
  PLANES_OF_MOTION,
  JOINT_NAMES,
  JOINT_LOAD_LEVELS,
  SPORT_TAG_OPTIONS,
  type ExerciseFormData,
} from "@/lib/validators/exercise"
import { extractYouTubeId, getYouTubeEmbedUrl } from "@/lib/youtube"
import { ExerciseRelationships } from "@/components/admin/ExerciseRelationships"
import { useFormTour } from "@/hooks/use-form-tour"
import { FormTour } from "@/components/admin/FormTour"
import { TourButton } from "@/components/admin/TourButton"
import { getExerciseTourSteps } from "@/lib/tour-steps"
import type { Exercise, JointLoading } from "@/types/database"

// ─── Constants ──────────────────────────────────────────────────────────────

interface ExerciseFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  exercise?: Exercise | null
}

const STEPS = [
  { label: "Basics", number: 1 },
  { label: "Details", number: 2 },
  { label: "AI Metadata", number: 3 },
  { label: "Relationships", number: 4 },
] as const

const stepVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
}

const CATEGORY_LABELS: Record<string, string> = {
  strength: "Strength",
  speed: "Speed",
  power: "Power",
  plyometric: "Plyometric",
  flexibility: "Flexibility",
  mobility: "Mobility",
  motor_control: "Motor Control",
  strength_endurance: "Strength Endurance",
  relative_strength: "Relative Strength",
}

const TRAINING_INTENT_LABELS: Record<string, string> = {
  build: "Build",
  shape: "Shape",
  express: "Express",
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

const PLANE_LABELS: Record<string, string> = {
  sagittal: "Sagittal",
  frontal: "Frontal",
  transverse: "Transverse",
}

const JOINT_LABELS: Record<string, string> = {
  ankle: "Ankle",
  knee: "Knee",
  hip: "Hip",
  lumbar_spine: "Lumbar Spine",
  thoracic_spine: "Thoracic Spine",
  shoulder: "Shoulder",
  elbow: "Elbow",
  wrist: "Wrist",
}

const JOINT_LOAD_LABELS: Record<string, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
}

const SPORT_TAG_LABELS: Record<string, string> = {
  tennis: "Tennis",
  golf: "Golf",
  baseball: "Baseball",
  softball: "Softball",
  soccer: "Soccer",
  basketball: "Basketball",
  football: "Football",
  lacrosse: "Lacrosse",
  hockey: "Hockey",
  swimming: "Swimming",
  track_field: "Track & Field",
  volleyball: "Volleyball",
  rugby: "Rugby",
  cricket: "Cricket",
  pickleball: "Pickleball",
  running: "Running",
  cycling: "Cycling",
  martial_arts: "Martial Arts",
  wrestling: "Wrestling",
  rowing: "Rowing",
  general_athletics: "General Athletics",
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

const textareaClass =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"

// ─── Component ──────────────────────────────────────────────────────────────

export function ExerciseFormDialog({
  open,
  onOpenChange,
  exercise: initialExercise,
}: ExerciseFormDialogProps) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [exercise, setExercise] = useState(initialExercise)
  const isEditing = !!exercise

  // Wizard state
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof ExerciseFormData, string[]>>>({})

  // Step 0: Basics
  const [name, setName] = useState(exercise?.name ?? "")
  const [selectedCategories, setSelectedCategories] = useState<string[]>(exercise?.category ?? [])
  const [difficulty, setDifficulty] = useState(exercise?.difficulty ?? "")
  const [muscleGroup, setMuscleGroup] = useState(exercise?.muscle_group ?? "")
  const [equipment, setEquipment] = useState(exercise?.equipment ?? "")

  // Step 1: Details
  const [description, setDescription] = useState(exercise?.description ?? "")
  const [instructions, setInstructions] = useState(exercise?.instructions ?? "")
  const [videoUrl, setVideoUrl] = useState(exercise?.video_url ?? "")
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const youtubeId = videoUrl ? extractYouTubeId(videoUrl) : null

  // Step 2: AI Metadata
  const [movementPattern, setMovementPattern] = useState(exercise?.movement_pattern ?? "")
  const [forceType, setForceType] = useState(exercise?.force_type ?? "")
  const [laterality, setLaterality] = useState(exercise?.laterality ?? "")
  const [primaryMuscles, setPrimaryMuscles] = useState<string[]>(exercise?.primary_muscles ?? [])
  const [secondaryMuscles, setSecondaryMuscles] = useState<string[]>(exercise?.secondary_muscles ?? [])
  const [equipmentRequired, setEquipmentRequired] = useState<string[]>(exercise?.equipment_required ?? [])
  const [isBodyweight, setIsBodyweight] = useState(exercise?.is_bodyweight ?? false)
  const [trainingIntent, setTrainingIntent] = useState<string[]>(exercise?.training_intent ?? ["build"])
  const [difficultyMax, setDifficultyMax] = useState(exercise?.difficulty_max ?? "")
  const [difficultyScore, setDifficultyScore] = useState<number>(exercise?.difficulty_score ?? 5)
  const [progressionOrder, setProgressionOrder] = useState(exercise?.progression_order?.toString() ?? "")
  const [sportTags, setSportTags] = useState<string[]>(exercise?.sport_tags ?? [])
  const [planeOfMotion, setPlaneOfMotion] = useState<string[]>(exercise?.plane_of_motion ?? [])
  const [jointsLoaded, setJointsLoaded] = useState<JointLoading[]>(exercise?.joints_loaded ?? [])
  const [aliases, setAliases] = useState<string[]>(exercise?.aliases ?? [])
  const [isAutoFilling, setIsAutoFilling] = useState(false)
  const [autoFillApplied, setAutoFillApplied] = useState(false)

  // Sync state when exercise prop changes
  useEffect(() => {
    setExercise(initialExercise)
    setName(initialExercise?.name ?? "")
    setSelectedCategories(initialExercise?.category ?? [])
    setDifficulty(initialExercise?.difficulty ?? "")
    setMuscleGroup(initialExercise?.muscle_group ?? "")
    setEquipment(initialExercise?.equipment ?? "")
    setDescription(initialExercise?.description ?? "")
    setInstructions(initialExercise?.instructions ?? "")
    setVideoUrl(initialExercise?.video_url ?? "")
    setMovementPattern(initialExercise?.movement_pattern ?? "")
    setForceType(initialExercise?.force_type ?? "")
    setLaterality(initialExercise?.laterality ?? "")
    setPrimaryMuscles(initialExercise?.primary_muscles ?? [])
    setSecondaryMuscles(initialExercise?.secondary_muscles ?? [])
    setEquipmentRequired(initialExercise?.equipment_required ?? [])
    setIsBodyweight(initialExercise?.is_bodyweight ?? false)
    setTrainingIntent(initialExercise?.training_intent ?? ["build"])
    setDifficultyMax(initialExercise?.difficulty_max ?? "")
    setDifficultyScore(initialExercise?.difficulty_score ?? 5)
    setProgressionOrder(initialExercise?.progression_order?.toString() ?? "")
    setSportTags(initialExercise?.sport_tags ?? [])
    setPlaneOfMotion(initialExercise?.plane_of_motion ?? [])
    setJointsLoaded(initialExercise?.joints_loaded ?? [])
    setAliases(initialExercise?.aliases ?? [])
    setStep(0)
    setDirection(1)
    setAutoFillApplied(false)
    setIframeLoaded(false)
  }, [initialExercise, open])

  // How many steps are visible
  // Relationships step only shown after creating a new exercise (not when editing)
  const hasExercise = !!(exercise as Exercise | null)?.id
  const maxStep = (!isEditing && hasExercise) ? 3 : 2
  const visibleSteps = STEPS.slice(0, maxStep + 1)
  const submitStep = 2 // Submit happens on AI Metadata step

  // ─── Tour ───────────────────────────────────────────────────────────────

  const stepRef = useRef(step)
  stepRef.current = step

  const tourGoToStep = useCallback((target: number) => {
    setDirection(target > stepRef.current ? 1 : -1)
    setStep(target)
  }, [])

  const tourSteps = useMemo(() => getExerciseTourSteps(tourGoToStep), [tourGoToStep])

  const tour = useFormTour({
    steps: tourSteps,
    scrollContainerRef: dialogRef,
  })

  // ─── Navigation ─────────────────────────────────────────────────────────

  function toggleItem(arr: string[], item: string, setter: (v: string[]) => void) {
    setter(arr.includes(item) ? arr.filter((i) => i !== item) : [...arr, item])
  }

  function scrollToTop() {
    dialogRef.current?.scrollTo({ top: 0 })
  }

  function validateStep(s: number): boolean {
    if (s === 0) {
      if (!name.trim()) { toast.error("Name is required"); return false }
      if (selectedCategories.length === 0) { toast.error("Select at least one category"); return false }
      if (!difficulty) { toast.error("Difficulty is required"); return false }
    }
    return true
  }

  function handleNext() {
    if (!validateStep(step)) return
    setDirection(1)
    setStep((s) => Math.min(s + 1, maxStep))
    scrollToTop()
  }

  function handleBack() {
    setDirection(-1)
    setStep((s) => Math.max(s - 1, 0))
    scrollToTop()
  }

  function goToStep(target: number) {
    if (target >= step) return
    setDirection(-1)
    setStep(target)
    scrollToTop()
  }

  function handleDialogClose() {
    if (isSubmitting) return
    tour.close()
    onOpenChange(false)
  }

  // ─── AI Auto-fill ───────────────────────────────────────────────────────

  async function handleAutoFill(force = false) {
    if (!name.trim()) { toast.error("Enter an exercise name first"); return }
    if (selectedCategories.length === 0) { toast.error("Select at least one category first"); return }

    setIsAutoFilling(true)
    try {
      const response = await fetch("/api/admin/exercises/ai-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          category: selectedCategories,
          difficulty: difficulty || undefined,
          description: description.trim() || undefined,
          equipment: equipment.trim() || undefined,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "AI auto-fill failed")
      }

      const p = await response.json()

      if (p.movement_pattern && (force || !movementPattern)) setMovementPattern(p.movement_pattern)
      if (p.force_type && (force || !forceType)) setForceType(p.force_type)
      if (p.laterality && (force || !laterality)) setLaterality(p.laterality)
      if (p.primary_muscles?.length > 0 && (force || primaryMuscles.length === 0)) setPrimaryMuscles(p.primary_muscles)
      if (p.secondary_muscles?.length > 0 && (force || secondaryMuscles.length === 0)) setSecondaryMuscles(p.secondary_muscles)
      if (p.equipment_required?.length > 0 && (force || equipmentRequired.length === 0)) setEquipmentRequired(p.equipment_required)
      if (p.is_bodyweight !== undefined && (force || !autoFillApplied)) setIsBodyweight(p.is_bodyweight)
      if (p.training_intent?.length > 0 && (force || !autoFillApplied)) setTrainingIntent(p.training_intent)
      if (p.difficulty_score && (force || difficultyScore === 5)) setDifficultyScore(p.difficulty_score)
      if (p.sport_tags?.length > 0 && (force || sportTags.length === 0)) setSportTags(p.sport_tags)
      if (p.plane_of_motion?.length > 0 && (force || planeOfMotion.length === 0)) setPlaneOfMotion(p.plane_of_motion)
      if (p.joints_loaded?.length > 0 && (force || jointsLoaded.length === 0)) setJointsLoaded(p.joints_loaded)
      if (p.aliases?.length > 0 && (force || aliases.length === 0)) setAliases(p.aliases)

      setAutoFillApplied(true)
      toast.success("AI metadata applied — review and adjust as needed")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI auto-fill failed")
    } finally {
      setIsAutoFilling(false)
    }
  }

  // ─── Submit ─────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setErrors({})

    const data = {
      name: name.trim(),
      description: description.trim() || null,
      category: selectedCategories,
      muscle_group: muscleGroup.trim() || null,
      difficulty,
      equipment: equipment.trim() || null,
      video_url: videoUrl.trim() || null,
      instructions: instructions.trim() || null,
      movement_pattern: movementPattern || null,
      force_type: forceType || null,
      laterality: laterality || null,
      primary_muscles: primaryMuscles,
      secondary_muscles: secondaryMuscles,
      equipment_required: equipmentRequired,
      is_bodyweight: isBodyweight,
      training_intent: trainingIntent,
      sport_tags: sportTags,
      plane_of_motion: planeOfMotion,
      joints_loaded: jointsLoaded,
      aliases,
      difficulty_max: difficultyMax || null,
      difficulty_score: difficultyScore,
      progression_order: progressionOrder ? parseInt(progressionOrder) : null,
    }

    const result = exerciseFormSchema.safeParse(data)
    if (!result.success) {
      setErrors(result.error.flatten().fieldErrors)
      const fieldErrors = result.error.flatten().fieldErrors
      const firstError = Object.values(fieldErrors).flat()[0]
      if (firstError) toast.error(firstError)
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
        setDirection(1)
        setStep(3)
        scrollToTop()
      }
      router.refresh()
    } catch {
      toast.error(isEditing ? "Failed to update exercise" : "Failed to create exercise")
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleDialogClose(); else onOpenChange(o) }}>
      <DialogContent
        ref={dialogRef}
        className={cn(
          "sm:max-w-lg max-h-[85vh] sm:max-h-[90vh] overflow-y-auto p-4 sm:p-6 gap-3 sm:gap-4",
          tour.isActive && "pb-48"
        )}
      >
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <DialogTitle className="text-base sm:text-lg font-heading font-semibold text-foreground">
              {isEditing ? "Edit Exercise" : "Add Exercise"}
            </DialogTitle>
            <TourButton onClick={tour.start} />
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto scrollbar-none -mx-1 px-1">
            {visibleSteps.map((s, idx) => (
              <button
                key={s.label}
                type="button"
                onClick={() => goToStep(idx)}
                disabled={idx > step}
                className={cn(
                  "flex items-center gap-1 sm:gap-1.5 rounded-full px-2 sm:px-3 py-1.5 text-xs font-medium transition-colors shrink-0",
                  idx === step
                    ? "bg-primary text-primary-foreground"
                    : idx < step
                      ? "bg-primary/10 text-primary cursor-pointer hover:bg-primary/20"
                      : "bg-muted text-muted-foreground cursor-default"
                )}
              >
                <span className={cn(
                  "flex items-center justify-center size-4 rounded-full text-[10px] font-bold",
                  idx === step
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : idx < step
                      ? "bg-primary/20 text-primary"
                      : "bg-muted-foreground/20 text-muted-foreground"
                )}>
                  {idx < step ? "\u2713" : s.number}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
                <span className="sm:hidden">{s.label.split(" ")[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="min-h-0 sm:min-h-[280px]">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: "easeInOut" }}
            >
              {step === 0 && (
                <StepBasics
                  name={name}
                  setName={setName}
                  selectedCategories={selectedCategories}
                  toggleCategory={(cat) => toggleItem(selectedCategories, cat, setSelectedCategories)}
                  difficulty={difficulty}
                  setDifficulty={setDifficulty}
                  muscleGroup={muscleGroup}
                  setMuscleGroup={setMuscleGroup}
                  equipment={equipment}
                  setEquipment={setEquipment}
                  errors={errors}
                  disabled={isSubmitting}
                />
              )}
              {step === 1 && (
                <StepDetails
                  description={description}
                  setDescription={setDescription}
                  instructions={instructions}
                  setInstructions={setInstructions}
                  videoUrl={videoUrl}
                  setVideoUrl={(url) => { setVideoUrl(url); setIframeLoaded(false) }}
                  youtubeId={youtubeId}
                  iframeLoaded={iframeLoaded}
                  onIframeLoad={() => setIframeLoaded(true)}
                  errors={errors}
                  disabled={isSubmitting}
                />
              )}
              {step === 2 && (
                <StepAiMetadata
                  movementPattern={movementPattern}
                  setMovementPattern={setMovementPattern}
                  forceType={forceType}
                  setForceType={setForceType}
                  laterality={laterality}
                  setLaterality={setLaterality}
                  primaryMuscles={primaryMuscles}
                  togglePrimary={(m) => toggleItem(primaryMuscles, m, setPrimaryMuscles)}
                  secondaryMuscles={secondaryMuscles}
                  toggleSecondary={(m) => toggleItem(secondaryMuscles, m, setSecondaryMuscles)}
                  equipmentRequired={equipmentRequired}
                  toggleEquipment={(eq) => toggleItem(equipmentRequired, eq, setEquipmentRequired)}
                  isBodyweight={isBodyweight}
                  setIsBodyweight={setIsBodyweight}
                  trainingIntent={trainingIntent}
                  toggleTrainingIntent={(intent) => toggleItem(trainingIntent, intent, setTrainingIntent)}
                  difficultyMax={difficultyMax}
                  setDifficultyMax={setDifficultyMax}
                  difficultyScore={difficultyScore}
                  setDifficultyScore={setDifficultyScore}
                  progressionOrder={progressionOrder}
                  setProgressionOrder={setProgressionOrder}
                  sportTags={sportTags}
                  toggleSportTag={(tag) => toggleItem(sportTags, tag, setSportTags)}
                  planeOfMotion={planeOfMotion}
                  togglePlane={(plane) => toggleItem(planeOfMotion, plane, setPlaneOfMotion)}
                  jointsLoaded={jointsLoaded}
                  setJointsLoaded={setJointsLoaded}
                  aliases={aliases}
                  setAliases={setAliases}
                  isAutoFilling={isAutoFilling}
                  autoFillApplied={autoFillApplied}
                  onAutoFill={handleAutoFill}
                  disabled={isSubmitting}
                />
              )}
              {step === 3 && exercise?.id && (
                <StepRelationships
                  exerciseId={exercise.id}
                  exerciseName={exercise.name}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <FormTour {...tour} />

        {/* Footer */}
        <DialogFooter className="flex-row gap-2 sm:gap-2">
          {step > 0 ? (
            <Button type="button" variant="outline" onClick={handleBack} disabled={isSubmitting} className="flex-1 sm:flex-none">
              <ChevronLeft className="size-4" />
              Back
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={handleDialogClose} disabled={isSubmitting} className="flex-1 sm:flex-none">
              Cancel
            </Button>
          )}

          {step < submitStep ? (
            <Button type="button" onClick={handleNext} disabled={isSubmitting} className="flex-1 sm:flex-none">
              Next
              <ChevronRight className="size-4" />
            </Button>
          ) : step === submitStep ? (
            <Button type="button" onClick={handleSubmit} disabled={isSubmitting} className="flex-1 sm:flex-none">
              {isSubmitting
                ? isEditing ? "Saving..." : "Creating..."
                : isEditing ? "Save" : "Create"}
            </Button>
          ) : (
            <Button type="button" onClick={handleDialogClose} className="flex-1 sm:flex-none">
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Step 0: Basics ─────────────────────────────────────────────────────────

function StepBasics({
  name, setName,
  selectedCategories, toggleCategory,
  difficulty, setDifficulty,
  muscleGroup, setMuscleGroup,
  equipment, setEquipment,
  errors, disabled,
}: {
  name: string; setName: (v: string) => void
  selectedCategories: string[]; toggleCategory: (cat: string) => void
  difficulty: string; setDifficulty: (v: string) => void
  muscleGroup: string; setMuscleGroup: (v: string) => void
  equipment: string; setEquipment: (v: string) => void
  errors: Partial<Record<string, string[]>>
  disabled: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name *</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Barbell Back Squat"
          disabled={disabled}
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name[0]}</p>}
      </div>

      <div className="space-y-2">
        <Label>Category *</Label>
        <div id="category" className="flex flex-wrap gap-1.5">
          {EXERCISE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => toggleCategory(cat)}
              disabled={disabled}
              className={cn(
                "px-2.5 py-1 text-xs rounded-full border transition-colors",
                selectedCategories.includes(cat)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:border-primary/50"
              )}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
        {errors.category && <p className="text-xs text-destructive">{errors.category[0]}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="difficulty">Difficulty *</Label>
        <select
          id="difficulty"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
          disabled={disabled}
          className={selectClass}
        >
          <option value="" disabled>Select difficulty</option>
          {EXERCISE_DIFFICULTIES.map((diff) => (
            <option key={diff} value={diff}>{DIFFICULTY_LABELS[diff]}</option>
          ))}
        </select>
        {errors.difficulty && <p className="text-xs text-destructive">{errors.difficulty[0]}</p>}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="muscle_group">Muscle Group</Label>
          <Input
            id="muscle_group"
            value={muscleGroup}
            onChange={(e) => setMuscleGroup(e.target.value)}
            placeholder="e.g. Quadriceps, Glutes"
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">Quick label for cards and lists</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="equipment">Equipment</Label>
          <Input
            id="equipment"
            value={equipment}
            onChange={(e) => setEquipment(e.target.value)}
            placeholder="e.g. Barbell, Squat Rack"
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Step 1: Details ────────────────────────────────────────────────────────

function StepDetails({
  description, setDescription,
  instructions, setInstructions,
  videoUrl, setVideoUrl,
  youtubeId, iframeLoaded, onIframeLoad,
  errors, disabled,
}: {
  description: string; setDescription: (v: string) => void
  instructions: string; setInstructions: (v: string) => void
  videoUrl: string; setVideoUrl: (v: string) => void
  youtubeId: string | null; iframeLoaded: boolean; onIframeLoad: () => void
  errors: Partial<Record<string, string[]>>
  disabled: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Brief description of the exercise..."
          disabled={disabled}
          className={textareaClass}
        />
        {errors.description && <p className="text-xs text-destructive">{errors.description[0]}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="instructions">Instructions</Label>
        <textarea
          id="instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          placeholder="Step-by-step instructions..."
          disabled={disabled}
          className={textareaClass}
        />
        {errors.instructions && <p className="text-xs text-destructive">{errors.instructions[0]}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="video_url">Video URL</Label>
        <Input
          id="video_url"
          type="url"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="https://youtube.com/watch?v=..."
          disabled={disabled}
        />
        {errors.video_url && <p className="text-xs text-destructive">{errors.video_url[0]}</p>}
        {youtubeId && (
          <div className="sm:max-w-sm">
            <div className="relative rounded-lg overflow-hidden border border-border aspect-video">
              {!iframeLoaded && <Skeleton className="absolute inset-0 rounded-none" />}
              <iframe
                key={youtubeId}
                src={getYouTubeEmbedUrl(youtubeId)}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title="Video preview"
                onLoad={onIframeLoad}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Step 2: AI Metadata ────────────────────────────────────────────────────

function StepAiMetadata({
  movementPattern, setMovementPattern,
  forceType, setForceType,
  laterality, setLaterality,
  primaryMuscles, togglePrimary,
  secondaryMuscles, toggleSecondary,
  equipmentRequired, toggleEquipment,
  isBodyweight, setIsBodyweight,
  trainingIntent, toggleTrainingIntent,
  sportTags, toggleSportTag,
  planeOfMotion, togglePlane,
  jointsLoaded, setJointsLoaded,
  aliases, setAliases,
  difficultyMax, setDifficultyMax,
  difficultyScore, setDifficultyScore,
  progressionOrder, setProgressionOrder,
  isAutoFilling, autoFillApplied, onAutoFill,
  disabled,
}: {
  movementPattern: string; setMovementPattern: (v: string) => void
  forceType: string; setForceType: (v: string) => void
  laterality: string; setLaterality: (v: string) => void
  primaryMuscles: string[]; togglePrimary: (m: string) => void
  secondaryMuscles: string[]; toggleSecondary: (m: string) => void
  equipmentRequired: string[]; toggleEquipment: (eq: string) => void
  isBodyweight: boolean; setIsBodyweight: (v: boolean) => void
  trainingIntent: string[]; toggleTrainingIntent: (intent: string) => void
  sportTags: string[]; toggleSportTag: (tag: string) => void
  planeOfMotion: string[]; togglePlane: (plane: string) => void
  jointsLoaded: JointLoading[]; setJointsLoaded: (v: JointLoading[]) => void
  aliases: string[]; setAliases: (v: string[]) => void
  difficultyMax: string; setDifficultyMax: (v: string) => void
  difficultyScore: number; setDifficultyScore: (v: number) => void
  progressionOrder: string; setProgressionOrder: (v: string) => void
  isAutoFilling: boolean; autoFillApplied: boolean; onAutoFill: (force?: boolean) => void
  disabled: boolean
}) {
  return (
    <div className="space-y-4">
      {/* AI Auto-fill banner */}
      <div id="ai-autofill-btn" className="rounded-lg border border-primary/20 bg-primary/5 p-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="size-4 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">AI Auto-fill</p>
              <p className="text-xs text-muted-foreground hidden sm:block">Predict metadata from exercise name and category</p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onAutoFill(autoFillApplied)}
            disabled={disabled || isAutoFilling}
            className="shrink-0 w-full sm:w-auto"
          >
            {isAutoFilling ? (
              <><Loader2 className="size-3.5 animate-spin" /> Predicting...</>
            ) : autoFillApplied ? (
              <><RefreshCw className="size-3.5" /> Re-fill</>
            ) : (
              <><Sparkles className="size-3.5" /> Auto-fill</>
            )}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">These fields help the AI generate better programs and find suitable alternatives.</p>

      {/* Movement Pattern & Force Type */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="movement_pattern">Movement Pattern</Label>
          <select
            id="movement_pattern"
            value={movementPattern}
            onChange={(e) => setMovementPattern(e.target.value)}
            disabled={disabled}
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
            value={forceType}
            onChange={(e) => setForceType(e.target.value)}
            disabled={disabled}
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
          value={laterality}
          onChange={(e) => setLaterality(e.target.value)}
          disabled={disabled}
          className={selectClass}
        >
          <option value="">None</option>
          {LATERALITY_OPTIONS.map((lat) => (
            <option key={lat} value={lat}>{LATERALITY_LABELS[lat]}</option>
          ))}
        </select>
      </div>

      {/* Primary Muscles */}
      <div className="space-y-2">
        <Label>Primary Muscles</Label>
        <p className="text-xs text-muted-foreground">Used by AI for exercise matching and program balancing</p>
        <div id="primary_muscles" className="flex flex-wrap gap-1.5">
          {MUSCLE_OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => togglePrimary(m)}
              disabled={disabled}
              className={cn(
                "px-2 py-1 text-xs rounded-full border transition-colors",
                primaryMuscles.includes(m)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:border-primary/50"
              )}
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
              onClick={() => toggleSecondary(m)}
              disabled={disabled}
              className={cn(
                "px-2 py-1 text-xs rounded-full border transition-colors",
                secondaryMuscles.includes(m)
                  ? "bg-accent text-accent-foreground border-accent"
                  : "bg-background border-border text-muted-foreground hover:border-accent/50"
              )}
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
              onClick={() => toggleEquipment(eq)}
              disabled={disabled}
              className={cn(
                "px-2 py-1 text-xs rounded-full border transition-colors",
                equipmentRequired.includes(eq)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:border-primary/50"
              )}
            >
              {EQUIPMENT_LABELS[eq]}
            </button>
          ))}
        </div>
      </div>

      {/* Bodyweight */}
      <div id="bodyweight_compound" className="flex gap-6">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={isBodyweight}
            onChange={(e) => setIsBodyweight(e.target.checked)}
            disabled={disabled}
            className="rounded border-border"
          />
          Bodyweight
        </label>
      </div>

      {/* Training Intent */}
      <div className="space-y-2">
        <Label>Training Intent *</Label>
        <p className="text-xs text-muted-foreground">How this exercise is used in programming (select one or more)</p>
        <div className="flex flex-wrap gap-1.5">
          {TRAINING_INTENTS.map((intent) => (
            <button
              key={intent}
              type="button"
              onClick={() => toggleTrainingIntent(intent)}
              disabled={disabled}
              className={cn(
                "px-2.5 py-1 text-xs rounded-full border transition-colors",
                trainingIntent.includes(intent)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:border-primary/50"
              )}
            >
              {TRAINING_INTENT_LABELS[intent]}
            </button>
          ))}
        </div>
      </div>

      {/* Sport Tags */}
      <div className="space-y-2">
        <Label>Sport Tags</Label>
        <p className="text-xs text-muted-foreground">Sports this exercise has high biomechanical transfer to</p>
        <div className="flex flex-wrap gap-1.5">
          {SPORT_TAG_OPTIONS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleSportTag(tag)}
              disabled={disabled}
              className={cn(
                "px-2 py-1 text-xs rounded-full border transition-colors",
                sportTags.includes(tag)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:border-primary/50"
              )}
            >
              {SPORT_TAG_LABELS[tag]}
            </button>
          ))}
        </div>
      </div>

      {/* Plane of Motion */}
      <div className="space-y-2">
        <Label>Plane of Motion</Label>
        <p className="text-xs text-muted-foreground">Movement planes used (sagittal = forward/back, frontal = side to side, transverse = rotation)</p>
        <div className="flex flex-wrap gap-1.5">
          {PLANES_OF_MOTION.map((plane) => (
            <button
              key={plane}
              type="button"
              onClick={() => togglePlane(plane)}
              disabled={disabled}
              className={cn(
                "px-2.5 py-1 text-xs rounded-full border transition-colors",
                planeOfMotion.includes(plane)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:border-primary/50"
              )}
            >
              {PLANE_LABELS[plane]}
            </button>
          ))}
        </div>
      </div>

      {/* Joints Loaded */}
      <div className="space-y-2">
        <Label>Joints Loaded</Label>
        <p className="text-xs text-muted-foreground">Which joints this exercise stresses and how heavily (used for injury-aware programming)</p>
        <div className="space-y-2">
          {jointsLoaded.map((jl, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                value={jl.joint}
                onChange={(e) => {
                  const updated = [...jointsLoaded]
                  updated[idx] = { ...jl, joint: e.target.value as JointLoading["joint"] }
                  setJointsLoaded(updated)
                }}
                disabled={disabled}
                className={cn(selectClass, "flex-1")}
              >
                {JOINT_NAMES.map((j) => (
                  <option key={j} value={j}>{JOINT_LABELS[j]}</option>
                ))}
              </select>
              <select
                value={jl.load}
                onChange={(e) => {
                  const updated = [...jointsLoaded]
                  updated[idx] = { ...jl, load: e.target.value as JointLoading["load"] }
                  setJointsLoaded(updated)
                }}
                disabled={disabled}
                className={cn(selectClass, "w-28")}
              >
                {JOINT_LOAD_LEVELS.map((l) => (
                  <option key={l} value={l}>{JOINT_LOAD_LABELS[l]}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setJointsLoaded(jointsLoaded.filter((_, i) => i !== idx))}
                disabled={disabled}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors px-1"
              >
                &times;
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setJointsLoaded([...jointsLoaded, { joint: "knee", load: "moderate" }])}
            disabled={disabled}
            className="text-xs"
          >
            + Add Joint
          </Button>
        </div>
      </div>

      {/* Aliases */}
      <div className="space-y-2">
        <Label>Aliases</Label>
        <p className="text-xs text-muted-foreground">Alternative names for this exercise (e.g. RDL, Flat Bench)</p>
        <div className="flex flex-wrap gap-1.5 min-h-[28px]">
          {aliases.map((alias, idx) => (
            <span key={idx} className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-muted border border-border">
              {alias}
              <button
                type="button"
                onClick={() => setAliases(aliases.filter((_, i) => i !== idx))}
                disabled={disabled}
                className="text-muted-foreground hover:text-destructive transition-colors"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        <Input
          placeholder="Type an alias and press Enter"
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              const val = (e.target as HTMLInputElement).value.trim()
              if (val && !aliases.includes(val)) {
                setAliases([...aliases, val]);
                (e.target as HTMLInputElement).value = ""
              }
            }
          }}
        />
      </div>

      {/* Difficulty Max */}
      <div className="space-y-2">
        <Label htmlFor="difficulty_max">Difficulty Ceiling</Label>
        <select
          id="difficulty_max"
          value={difficultyMax}
          onChange={(e) => setDifficultyMax(e.target.value)}
          disabled={disabled}
          className={selectClass}
        >
          <option value="">None (same as difficulty)</option>
          {EXERCISE_DIFFICULTIES.map((diff) => (
            <option key={diff} value={diff}>{DIFFICULTY_LABELS[diff]}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Optional upper bound — useful for exercises that span a difficulty range</p>
      </div>

      {/* Difficulty Score */}
      <div className="space-y-2">
        <Label htmlFor="difficulty_score">Difficulty Score (1-10)</Label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            id="difficulty_score"
            min={1}
            max={10}
            value={difficultyScore}
            onChange={(e) => setDifficultyScore(Number(e.target.value))}
            disabled={disabled}
            className="flex-1 accent-primary"
          />
          <span className="text-sm font-medium w-6 text-center">{difficultyScore}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          1-2: Foundational &middot; 3-4: Beginner &middot; 5-6: Intermediate &middot; 7-8: Advanced &middot; 9-10: Elite
        </p>
      </div>

      {/* Progression Order */}
      <div className="space-y-2">
        <Label htmlFor="progression_order">Progression Order</Label>
        <Input
          id="progression_order"
          type="number"
          min={1}
          value={progressionOrder}
          onChange={(e) => setProgressionOrder(e.target.value)}
          placeholder="e.g. 1, 2, 3 within same movement pattern"
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">Order within the same movement pattern (lower = easier progression)</p>
      </div>
    </div>
  )
}

// ─── Step 3: Relationships ──────────────────────────────────────────────────

function StepRelationships({
  exerciseId,
  exerciseName,
}: {
  exerciseId: string
  exerciseName: string
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Link alternative exercises that clients can swap to during workouts. You can also define progression and regression relationships.
      </p>
      <div id="exercise-alternatives">
        <ExerciseRelationships
          exerciseId={exerciseId}
          exerciseName={exerciseName}
        />
      </div>
    </div>
  )
}
