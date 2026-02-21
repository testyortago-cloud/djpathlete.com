"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import { toast } from "sonner"
import {
  Target,
  Activity,
  History,
  AlertTriangle,
  Dumbbell,
  CalendarDays,
  ThumbsUp,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  Check,
  Loader2,
  Plus,
  X,
  User,
  Heart,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  FITNESS_GOALS,
  EXPERIENCE_LEVELS,
  SESSION_DURATIONS,
  DAY_NAMES,
  TIME_EFFICIENCY_OPTIONS,
  TIME_EFFICIENCY_LABELS,
  TRAINING_TECHNIQUES,
  TECHNIQUE_LABELS,
  TECHNIQUE_DESCRIPTIONS,
  GOAL_LABELS,
  LEVEL_LABELS,
  EQUIPMENT_LABELS,
  EQUIPMENT_PRESETS,
  SLEEP_OPTIONS,
  SLEEP_LABELS,
  STRESS_LEVELS,
  STRESS_LABELS,
  OCCUPATION_LEVELS,
  OCCUPATION_LABELS,
  MOVEMENT_CONFIDENCE_LEVELS,
  MOVEMENT_CONFIDENCE_LABELS,
  MOVEMENT_CONFIDENCE_DESCRIPTIONS,
  GENDER_OPTIONS,
  GENDER_LABELS,
} from "@/lib/validators/questionnaire"
import { EQUIPMENT_OPTIONS } from "@/lib/validators/exercise"
import type { ClientProfile, InjuryDetail } from "@/types/database"

const TOTAL_STEPS = 10

const STEP_INFO = [
  { label: "Fitness Goals", icon: Target },
  { label: "About You", icon: User },
  { label: "Fitness Level", icon: Activity },
  { label: "Recovery & Lifestyle", icon: Heart },
  { label: "Training History", icon: History },
  { label: "Injuries", icon: AlertTriangle },
  { label: "Equipment", icon: Dumbbell },
  { label: "Schedule", icon: CalendarDays },
  { label: "Preferences", icon: ThumbsUp },
  { label: "Review", icon: ClipboardCheck },
] as const

interface FormData {
  goals: string[]
  sport: string
  date_of_birth: string
  gender: string | null
  experience_level: string
  movement_confidence: string | null
  sleep_hours: string | null
  stress_level: string | null
  occupation_activity_level: string | null
  training_years: number | null
  training_background: string
  injuries_text: string
  injury_details: InjuryDetail[]
  available_equipment: string[]
  preferred_day_names: number[]
  preferred_session_minutes: number
  time_efficiency_preference: string | null
  preferred_techniques: string[]
  exercise_likes: string
  exercise_dislikes: string
  additional_notes: string
}

/** Backward-compat: parse goals from old pipe-delimited format */
function parseGoalsFromProfile(goalsString: string | null): string[] {
  if (!goalsString) return []
  // New format: plain comma-separated goals (no "Goals:" prefix)
  // Old format: "Goals: weight_loss, muscle_gain | Training background: ..."
  const goalsMatch = goalsString.match(/^Goals:\s*(.+?)(?:\s*\||$)/)
  if (goalsMatch) {
    return goalsMatch[1]
      .split(",")
      .map((g) => g.trim())
      .filter((g) => (FITNESS_GOALS as readonly string[]).includes(g))
  }
  // New format: just comma-separated
  return goalsString
    .split(",")
    .map((g) => g.trim())
    .filter((g) => (FITNESS_GOALS as readonly string[]).includes(g))
}

/** Backward-compat: parse a field from old pipe-delimited goals string */
function parseFieldFromProfile(
  goalsString: string | null,
  prefix: string
): string {
  if (!goalsString) return ""
  const regex = new RegExp(`${prefix}:\\s*(.+?)(?:\\s*\\||$)`)
  const match = goalsString.match(regex)
  return match ? match[1].trim() : ""
}

function buildInitialData(profile: ClientProfile | null): FormData {
  if (!profile) {
    return {
      goals: [],
      sport: "",
      date_of_birth: "",
      gender: null,
      experience_level: "",
      movement_confidence: null,
      sleep_hours: null,
      stress_level: null,
      occupation_activity_level: null,
      training_years: null,
      training_background: "",
      injuries_text: "",
      injury_details: [],
      available_equipment: [],
      preferred_day_names: [1, 3, 5],
      preferred_session_minutes: 60,
      time_efficiency_preference: null,
      preferred_techniques: [],
      exercise_likes: "",
      exercise_dislikes: "",
      additional_notes: "",
    }
  }

  // Determine if profile uses old pipe-delimited format
  const isOldFormat = profile.goals?.includes("|") ?? false

  return {
    goals: parseGoalsFromProfile(profile.goals),
    sport: profile.sport ?? "",
    date_of_birth: profile.date_of_birth ? profile.date_of_birth.slice(0, 4) : "",
    gender: profile.gender ?? null,
    experience_level: profile.experience_level ?? "",
    movement_confidence: profile.movement_confidence ?? null,
    sleep_hours: profile.sleep_hours ?? null,
    stress_level: profile.stress_level ?? null,
    occupation_activity_level: profile.occupation_activity_level ?? null,
    training_years: profile.training_years,
    training_background: isOldFormat
      ? parseFieldFromProfile(profile.goals, "Training background")
      : (profile.training_background ?? ""),
    injuries_text: profile.injuries ?? "",
    injury_details: profile.injury_details ?? [],
    available_equipment: profile.available_equipment ?? [],
    preferred_day_names:
      profile.preferred_day_names?.length > 0
        ? profile.preferred_day_names
        : [1, 3, 5],
    preferred_session_minutes: profile.preferred_session_minutes ?? 60,
    time_efficiency_preference: profile.time_efficiency_preference ?? null,
    preferred_techniques: profile.preferred_techniques ?? [],
    exercise_likes: isOldFormat
      ? parseFieldFromProfile(profile.goals, "Likes")
      : (profile.exercise_likes ?? ""),
    exercise_dislikes: isOldFormat
      ? parseFieldFromProfile(profile.goals, "Dislikes")
      : (profile.exercise_dislikes ?? ""),
    additional_notes: isOldFormat
      ? parseFieldFromProfile(profile.goals, "Notes")
      : (profile.additional_notes ?? ""),
  }
}

export function QuestionnaireForm({
  initialProfile,
}: {
  initialProfile: ClientProfile | null
}) {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(1)
  const [formData, setFormData] = useState<FormData>(() =>
    buildInitialData(initialProfile)
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [direction, setDirection] = useState(1)

  const updateField = useCallback(
    <K extends keyof FormData>(field: K, value: FormData[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }))
    },
    []
  )

  const validateCurrentStep = (): string | null => {
    switch (currentStep) {
      case 1:
        if (formData.goals.length === 0)
          return "Please select at least one fitness goal."
        return null
      case 3:
        if (!formData.experience_level)
          return "Please select your fitness level."
        return null
      case 8:
        if (formData.preferred_day_names.length === 0)
          return "Please select at least one training day."
        if (
          !(SESSION_DURATIONS as readonly number[]).includes(
            formData.preferred_session_minutes
          )
        )
          return "Please select a valid session duration."
        return null
      default:
        return null
    }
  }

  const goToStep = (step: number) => {
    setDirection(step > currentStep ? 1 : -1)
    setCurrentStep(step)
  }

  const handleNext = () => {
    const error = validateCurrentStep()
    if (error) {
      toast.error(error)
      return
    }
    setDirection(1)
    setCurrentStep((prev) => Math.min(prev + 1, TOTAL_STEPS))
  }

  const handleBack = () => {
    setDirection(-1)
    setCurrentStep((prev) => Math.max(prev - 1, 1))
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      const response = await fetch("/api/questionnaire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to save questionnaire")
      }

      toast.success("Assessment saved! We'll notify you when a program that suits you is ready.")
      router.push("/client/dashboard")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Something went wrong"
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const progressValue = (currentStep / TOTAL_STEPS) * 100

  const stepVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 40 : -40,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -40 : 40,
      opacity: 0,
    }),
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Progress header */}
      <div className="bg-white rounded-xl border border-border p-4 sm:p-6">
        <div className="flex items-center justify-between mb-2.5 sm:mb-3">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground">
            Step {currentStep} of {TOTAL_STEPS}
          </p>
          <div className="flex items-center gap-1.5">
            {STEP_INFO[currentStep - 1] && (
              <>
                {(() => {
                  const StepIcon = STEP_INFO[currentStep - 1].icon
                  return (
                    <StepIcon className="size-3.5 sm:size-4 text-primary" />
                  )
                })()}
                <span className="text-xs sm:text-sm font-medium text-primary">
                  {STEP_INFO[currentStep - 1].label}
                </span>
              </>
            )}
          </div>
        </div>
        <Progress value={progressValue} className="h-1.5 sm:h-2" />

        {/* Step dots */}
        <div className="flex items-center justify-between mt-3 sm:mt-4 gap-0.5 sm:gap-1">
          {STEP_INFO.map((step, index) => {
            const stepNum = index + 1
            const isComplete = stepNum < currentStep
            const isCurrent = stepNum === currentStep
            return (
              <button
                key={step.label}
                onClick={() => goToStep(stepNum)}
                className={`flex items-center justify-center size-6 sm:size-8 rounded-full text-[10px] sm:text-xs font-medium transition-all ${
                  isCurrent
                    ? "bg-primary text-primary-foreground"
                    : isComplete
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                }`}
                title={step.label}
              >
                {isComplete ? <Check className="size-3" /> : stepNum}
              </button>
            )
          })}
        </div>
      </div>

      {/* Form content */}
      <div className="bg-white rounded-xl border border-border p-4 sm:p-6 min-h-[350px] sm:min-h-[400px] relative overflow-hidden">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentStep}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
            {currentStep === 1 && (
              <Step1Goals formData={formData} updateField={updateField} />
            )}
            {currentStep === 2 && (
              <Step2AboutYou formData={formData} updateField={updateField} />
            )}
            {currentStep === 3 && (
              <Step3Level formData={formData} updateField={updateField} />
            )}
            {currentStep === 4 && (
              <Step4Recovery formData={formData} updateField={updateField} />
            )}
            {currentStep === 5 && (
              <Step5History formData={formData} updateField={updateField} />
            )}
            {currentStep === 6 && (
              <Step6Injuries formData={formData} updateField={updateField} />
            )}
            {currentStep === 7 && (
              <Step7Equipment formData={formData} updateField={updateField} />
            )}
            {currentStep === 8 && (
              <Step8Schedule formData={formData} updateField={updateField} />
            )}
            {currentStep === 9 && (
              <Step9Preferences formData={formData} updateField={updateField} />
            )}
            {currentStep === 10 && (
              <Step10Review formData={formData} onGoToStep={goToStep} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={handleBack}
          disabled={currentStep === 1}
          className="gap-1 text-xs sm:text-sm sm:size-auto"
        >
          <ChevronLeft className="size-3.5 sm:size-4" />
          Back
        </Button>

        {currentStep < TOTAL_STEPS ? (
          <Button size="sm" onClick={handleNext} className="gap-1 text-xs sm:text-sm sm:size-auto">
            Next
            <ChevronRight className="size-3.5 sm:size-4" />
          </Button>
        ) : (
          <Button size="sm" onClick={handleSubmit} disabled={isSubmitting} className="gap-1 text-xs sm:text-sm sm:size-auto">
            {isSubmitting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="size-3.5 sm:size-4" />
                Submit
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}

/* ─── Step Components ──────────────────────────────────────────────── */

interface StepProps {
  formData: FormData
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void
}

/* ─── Step 1: Fitness Goals ──────────────────────────────────────── */

function Step1Goals({ formData, updateField }: StepProps) {
  const toggleGoal = (goal: string) => {
    const current = formData.goals
    if (current.includes(goal)) {
      updateField(
        "goals",
        current.filter((g) => g !== goal)
      )
      if (goal === "sport_specific") {
        updateField("sport", "")
      }
    } else {
      updateField("goals", [...current, goal])
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-primary mb-2">
        What are your fitness goals?
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        Select all that apply. This helps us tailor your training program.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FITNESS_GOALS.map((goal) => {
          const selected = formData.goals.includes(goal)
          return (
            <button
              key={goal}
              type="button"
              onClick={() => toggleGoal(goal)}
              className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-all ${
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-primary/40 hover:bg-surface/50"
              }`}
            >
              <div
                className={`flex items-center justify-center size-5 rounded border transition-colors ${
                  selected
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-muted-foreground/40"
                }`}
              >
                {selected && <Check className="size-3" />}
              </div>
              <span className="text-sm font-medium text-foreground">
                {GOAL_LABELS[goal] ?? goal}
              </span>
            </button>
          )
        })}
      </div>

      {/* Conditional sport input */}
      {formData.goals.includes("sport_specific") && (
        <div className="mt-6">
          <Label htmlFor="sport-input">Which sport?</Label>
          <Input
            id="sport-input"
            placeholder="e.g. Rugby, Basketball, Tennis..."
            value={formData.sport}
            onChange={(e) => updateField("sport", e.target.value)}
            className="mt-1.5 max-w-sm"
          />
        </div>
      )}
    </div>
  )
}

/* ─── Step 2: About You ──────────────────────────────────────────── */

function Step2AboutYou({ formData, updateField }: StepProps) {
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 80 }, (_, i) => currentYear - 16 - i)

  return (
    <div>
      <h2 className="text-lg font-semibold text-primary mb-2">
        A bit about you
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        This helps us fine-tune recovery expectations and program design. Both
        fields are optional.
      </p>
      <div className="space-y-8">
        {/* Birth year */}
        <div>
          <Label>Birth year</Label>
          <Select
            value={formData.date_of_birth}
            onValueChange={(v) => updateField("date_of_birth", v)}
          >
            <SelectTrigger className="mt-1.5 max-w-[200px]">
              <SelectValue placeholder="Select year" />
            </SelectTrigger>
            <SelectContent>
              {years.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Used to estimate age-based recovery adjustments.
          </p>
        </div>

        {/* Gender */}
        <div>
          <Label>Gender</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {GENDER_OPTIONS.map((option) => {
              const selected = formData.gender === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() =>
                    updateField("gender", selected ? null : option)
                  }
                  className={`rounded-lg border py-3 px-2 text-center transition-all ${
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary text-primary font-semibold"
                      : "border-border hover:border-primary/40 text-foreground"
                  }`}
                >
                  <span className="text-sm font-medium">
                    {GENDER_LABELS[option]}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Step 3: Fitness Level + Movement Confidence ────────────────── */

function Step3Level({ formData, updateField }: StepProps) {
  const LEVEL_DESCRIPTIONS: Record<string, string> = {
    beginner:
      "New to structured training, less than 6 months of consistent exercise.",
    intermediate:
      "Regular training for 6 months to 2 years with good form on basic exercises.",
    advanced:
      "2+ years of consistent, structured training with strong exercise proficiency.",
    elite:
      "Competitive athlete or 5+ years of dedicated training at a high level.",
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-primary mb-2">
        What is your current fitness level?
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        Be honest — this helps us set the right starting point for your program.
      </p>
      <div className="space-y-3">
        {EXPERIENCE_LEVELS.map((level) => {
          const selected = formData.experience_level === level
          return (
            <button
              key={level}
              type="button"
              onClick={() => updateField("experience_level", level)}
              className={`flex flex-col w-full rounded-lg border p-4 text-left transition-all ${
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-primary/40 hover:bg-surface/50"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex items-center justify-center size-5 rounded-full border-2 transition-colors ${
                    selected
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/40"
                  }`}
                >
                  {selected && (
                    <div className="size-2 rounded-full bg-white" />
                  )}
                </div>
                <span className="text-sm font-medium text-foreground">
                  {LEVEL_LABELS[level] ?? level}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 ml-8">
                {LEVEL_DESCRIPTIONS[level]}
              </p>
            </button>
          )
        })}
      </div>

      {/* Movement confidence */}
      <div className="mt-8">
        <Label>How confident are you with exercise movements?</Label>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">
          This determines exercise complexity in your program.
        </p>
        <div className="space-y-2">
          {MOVEMENT_CONFIDENCE_LEVELS.map((level) => {
            const selected = formData.movement_confidence === level
            return (
              <button
                key={level}
                type="button"
                onClick={() =>
                  updateField(
                    "movement_confidence",
                    selected ? null : level
                  )
                }
                className={`flex flex-col w-full rounded-lg border p-3 text-left transition-all ${
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/40 hover:bg-surface/50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex items-center justify-center size-5 rounded-full border-2 transition-colors ${
                      selected
                        ? "border-primary bg-primary"
                        : "border-muted-foreground/40"
                    }`}
                  >
                    {selected && (
                      <div className="size-2 rounded-full bg-white" />
                    )}
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    {MOVEMENT_CONFIDENCE_LABELS[level]}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 ml-8">
                  {MOVEMENT_CONFIDENCE_DESCRIPTIONS[level]}
                </p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ─── Step 4: Recovery & Lifestyle ───────────────────────────────── */

function Step4Recovery({ formData, updateField }: StepProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-primary mb-2">
        Recovery & lifestyle
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        These factors directly affect how much training volume your body can
        handle. All fields are optional.
      </p>
      <div className="space-y-8">
        {/* Sleep */}
        <div>
          <Label>How many hours do you typically sleep per night?</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {SLEEP_OPTIONS.map((option) => {
              const selected = formData.sleep_hours === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() =>
                    updateField("sleep_hours", selected ? null : option)
                  }
                  className={`rounded-lg border py-3 px-2 text-center transition-all ${
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary text-primary font-semibold"
                      : "border-border hover:border-primary/40 text-foreground"
                  }`}
                >
                  <span className="text-sm font-medium">
                    {SLEEP_LABELS[option]}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Stress */}
        <div>
          <Label>What is your current overall stress level?</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {STRESS_LEVELS.map((option) => {
              const selected = formData.stress_level === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() =>
                    updateField("stress_level", selected ? null : option)
                  }
                  className={`rounded-lg border py-3 px-2 text-center transition-all ${
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary text-primary font-semibold"
                      : "border-border hover:border-primary/40 text-foreground"
                  }`}
                >
                  <span className="text-sm font-medium">
                    {STRESS_LABELS[option]}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Occupation activity */}
        <div>
          <Label>How physically active is your day job / daily life?</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
            {OCCUPATION_LEVELS.map((option) => {
              const selected = formData.occupation_activity_level === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() =>
                    updateField(
                      "occupation_activity_level",
                      selected ? null : option
                    )
                  }
                  className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div
                    className={`flex items-center justify-center size-5 rounded-full border-2 transition-colors ${
                      selected
                        ? "border-primary bg-primary"
                        : "border-muted-foreground/40"
                    }`}
                  >
                    {selected && (
                      <div className="size-2 rounded-full bg-white" />
                    )}
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    {OCCUPATION_LABELS[option]}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Step 5: Training History ───────────────────────────────────── */

function Step5History({ formData, updateField }: StepProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-primary mb-2">
        Tell us about your training history
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        Understanding your background helps us build on your strengths.
      </p>
      <div className="space-y-6">
        <div>
          <Label htmlFor="training-years">Years of training experience</Label>
          <Input
            id="training-years"
            type="number"
            min={0}
            max={60}
            placeholder="e.g. 3"
            value={formData.training_years ?? ""}
            onChange={(e) =>
              updateField(
                "training_years",
                e.target.value ? Number(e.target.value) : null
              )
            }
            className="mt-1.5 max-w-[200px]"
          />
        </div>
        <div>
          <Label htmlFor="training-background">
            Training background (optional)
          </Label>
          <Textarea
            id="training-background"
            placeholder="Tell us about your training background — sports played, programs followed, certifications, etc."
            value={formData.training_background}
            onChange={(e) => updateField("training_background", e.target.value)}
            className="mt-1.5"
            rows={5}
          />
          <p className="text-xs text-muted-foreground mt-1">
            {formData.training_background.length}/2000 characters
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─── Step 6: Injuries ───────────────────────────────────────────── */

function Step6Injuries({ formData, updateField }: StepProps) {
  const addInjury = () => {
    updateField("injury_details", [
      ...formData.injury_details,
      { area: "", side: "", severity: "", notes: "" },
    ])
  }

  const removeInjury = (index: number) => {
    updateField(
      "injury_details",
      formData.injury_details.filter((_, i) => i !== index)
    )
  }

  const updateInjury = (
    index: number,
    field: keyof InjuryDetail,
    value: string
  ) => {
    const updated = formData.injury_details.map((injury, i) =>
      i === index ? { ...injury, [field]: value } : injury
    )
    updateField("injury_details", updated)
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-primary mb-2">
        Injuries & limitations
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        Let us know about any current or past injuries so we can program safely
        around them.
      </p>
      <div className="space-y-6">
        <div>
          <Label htmlFor="injuries-text">
            General notes about injuries or limitations (optional)
          </Label>
          <Textarea
            id="injuries-text"
            placeholder="e.g. I have a recurring lower back issue that flares up with heavy deadlifts..."
            value={formData.injuries_text}
            onChange={(e) => updateField("injuries_text", e.target.value)}
            className="mt-1.5"
            rows={3}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <Label>Specific injuries</Label>
            <Button type="button" variant="outline" size="sm" onClick={addInjury}>
              <Plus className="size-3.5" />
              Add injury
            </Button>
          </div>

          {formData.injury_details.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
              No specific injuries added. Click &quot;Add injury&quot; if you
              have any to report.
            </p>
          ) : (
            <div className="space-y-4">
              {formData.injury_details.map((injury, index) => (
                <div
                  key={index}
                  className="border border-border rounded-lg p-4 space-y-3 relative"
                >
                  <button
                    type="button"
                    onClick={() => removeInjury(index)}
                    className="absolute top-3 right-3 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="size-4" />
                  </button>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <Label htmlFor={`injury-area-${index}`}>
                        Body area
                      </Label>
                      <Input
                        id={`injury-area-${index}`}
                        placeholder="e.g. Knee"
                        value={injury.area}
                        onChange={(e) =>
                          updateInjury(index, "area", e.target.value)
                        }
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`injury-side-${index}`}>Side</Label>
                      <Select
                        value={injury.side ?? ""}
                        onValueChange={(v) => updateInjury(index, "side", v)}
                      >
                        <SelectTrigger
                          id={`injury-side-${index}`}
                          className="mt-1 w-full"
                        >
                          <SelectValue placeholder="Select side" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="left">Left</SelectItem>
                          <SelectItem value="right">Right</SelectItem>
                          <SelectItem value="both">Both</SelectItem>
                          <SelectItem value="n/a">N/A</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor={`injury-severity-${index}`}>
                        Severity
                      </Label>
                      <Select
                        value={injury.severity ?? ""}
                        onValueChange={(v) =>
                          updateInjury(index, "severity", v)
                        }
                      >
                        <SelectTrigger
                          id={`injury-severity-${index}`}
                          className="mt-1 w-full"
                        >
                          <SelectValue placeholder="Select severity" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mild">Mild</SelectItem>
                          <SelectItem value="moderate">Moderate</SelectItem>
                          <SelectItem value="severe">Severe</SelectItem>
                          <SelectItem value="recovering">Recovering</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor={`injury-notes-${index}`}>Notes</Label>
                    <Input
                      id={`injury-notes-${index}`}
                      placeholder="Additional details..."
                      value={injury.notes ?? ""}
                      onChange={(e) =>
                        updateInjury(index, "notes", e.target.value)
                      }
                      className="mt-1"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Step 7: Equipment ──────────────────────────────────────────── */

function Step7Equipment({ formData, updateField }: StepProps) {
  const toggleEquipment = (equipment: string) => {
    const current = formData.available_equipment
    if (current.includes(equipment)) {
      updateField(
        "available_equipment",
        current.filter((e) => e !== equipment)
      )
    } else {
      updateField("available_equipment", [...current, equipment])
    }
  }

  const applyPreset = (presetItems: readonly string[]) => {
    updateField("available_equipment", [...presetItems])
  }

  const activePreset = Object.entries(EQUIPMENT_PRESETS).find(
    ([, items]) =>
      items.length === formData.available_equipment.length &&
      items.every((item) => formData.available_equipment.includes(item))
  )?.[0]

  return (
    <div>
      <h2 className="text-lg font-semibold text-primary mb-2">
        What equipment do you have access to?
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Pick a preset or select individual items below.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {Object.entries(EQUIPMENT_PRESETS).map(([name, items]) => {
          const isActive = activePreset === name
          return (
            <Button
              key={name}
              type="button"
              variant={isActive ? "default" : "outline"}
              size="sm"
              onClick={() => applyPreset(items)}
            >
              {name}
            </Button>
          )
        })}
        <span className="text-xs text-muted-foreground ml-auto">
          {formData.available_equipment.length} selected
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {EQUIPMENT_OPTIONS.map((eq) => {
          const selected = formData.available_equipment.includes(eq)
          return (
            <label
              key={eq}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-all ${
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <Checkbox
                checked={selected}
                onCheckedChange={() => toggleEquipment(eq)}
              />
              <span className="text-sm text-foreground">
                {EQUIPMENT_LABELS[eq] ?? eq}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Step 8: Schedule ───────────────────────────────────────────── */

function Step8Schedule({ formData, updateField }: StepProps) {
  const toggleDay = (day: number) => {
    const current = formData.preferred_day_names
    if (current.includes(day)) {
      updateField(
        "preferred_day_names",
        current.filter((d) => d !== day)
      )
    } else {
      updateField(
        "preferred_day_names",
        [...current, day].sort((a, b) => a - b)
      )
    }
  }

  const selectedDayLabels = formData.preferred_day_names
    .map((d) => DAY_NAMES[d - 1])
    .join(", ")

  return (
    <div>
      <h2 className="text-lg font-semibold text-primary mb-2">
        Your training schedule
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        Pick the days you can train and how long each session should be.
      </p>
      <div className="space-y-8">
        {/* Day picker */}
        <div>
          <Label>Which days can you train?</Label>
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2 mt-3">
            {DAY_NAMES.map((name, idx) => {
              const dayNum = idx + 1
              const selected = formData.preferred_day_names.includes(dayNum)
              const shortName = name.slice(0, 3)
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleDay(dayNum)}
                  className={`rounded-lg border py-2.5 sm:py-3 text-center transition-all ${
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary text-primary font-semibold"
                      : "border-border hover:border-primary/40 text-foreground"
                  }`}
                >
                  <span className="text-xs sm:text-sm font-medium">{shortName}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Session duration */}
        <div>
          <Label>Session duration</Label>
          <div className="grid grid-cols-5 gap-1.5 sm:gap-2 mt-3">
            {SESSION_DURATIONS.map((duration) => {
              const selected = formData.preferred_session_minutes === duration
              return (
                <button
                  key={duration}
                  type="button"
                  onClick={() =>
                    updateField("preferred_session_minutes", duration)
                  }
                  className={`rounded-lg border py-2.5 sm:py-3 text-center transition-all ${
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary text-primary font-semibold"
                      : "border-border hover:border-primary/40 text-foreground"
                  }`}
                >
                  <span className="text-sm sm:text-lg font-medium">{duration}</span>
                  <span className="block text-[10px] sm:text-xs text-muted-foreground">
                    min
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Time efficiency preference — show when session is 45 min or less */}
        {formData.preferred_session_minutes <= 45 && (
          <div>
            <Label>When short on time, how do you prefer to train?</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
              {TIME_EFFICIENCY_OPTIONS.map((opt) => {
                const selected = formData.time_efficiency_preference === opt
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() =>
                      updateField(
                        "time_efficiency_preference",
                        selected ? null : opt
                      )
                    }
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                      selected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div
                      className={`flex items-center justify-center size-5 rounded-full border-2 transition-colors ${
                        selected
                          ? "border-primary bg-primary"
                          : "border-muted-foreground/40"
                      }`}
                    >
                      {selected && (
                        <div className="size-2 rounded-full bg-white" />
                      )}
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      {TIME_EFFICIENCY_LABELS[opt]}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="bg-surface/50 rounded-lg p-4 border border-border">
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">Summary:</strong> You plan to
            train{" "}
            <strong className="text-primary">
              {selectedDayLabels || "no days selected"}
            </strong>{" "}
            ({formData.preferred_day_names.length} days/week) for{" "}
            <strong className="text-primary">
              {formData.preferred_session_minutes} minutes
            </strong>{" "}
            per session.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─── Step 9: Preferences ────────────────────────────────────────── */

function Step9Preferences({ formData, updateField }: StepProps) {
  const toggleTechnique = (technique: string) => {
    const current = formData.preferred_techniques
    if (current.includes(technique)) {
      updateField(
        "preferred_techniques",
        current.filter((t) => t !== technique)
      )
    } else {
      updateField("preferred_techniques", [...current, technique])
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-primary mb-2">
        Exercise preferences
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        Share what you enjoy and what you would rather avoid. This helps us keep
        you motivated.
      </p>
      <div className="space-y-6">
        {/* Training techniques */}
        <div>
          <Label>Training techniques you enjoy (optional)</Label>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">
            Select any techniques you want included in your program.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {TRAINING_TECHNIQUES.map((tech) => {
              const selected = formData.preferred_techniques.includes(tech)
              return (
                <label
                  key={tech}
                  className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-all ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <Checkbox
                    checked={selected}
                    onCheckedChange={() => toggleTechnique(tech)}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-sm font-medium text-foreground">
                      {TECHNIQUE_LABELS[tech]}
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {TECHNIQUE_DESCRIPTIONS[tech]}
                    </p>
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        <div>
          <Label htmlFor="exercise-likes">
            Exercises or activities you enjoy (optional)
          </Label>
          <Textarea
            id="exercise-likes"
            placeholder="e.g. I love heavy squats, pull-ups, and swimming..."
            value={formData.exercise_likes}
            onChange={(e) => updateField("exercise_likes", e.target.value)}
            className="mt-1.5"
            rows={3}
          />
        </div>
        <div>
          <Label htmlFor="exercise-dislikes">
            Exercises or activities you dislike (optional)
          </Label>
          <Textarea
            id="exercise-dislikes"
            placeholder="e.g. I'm not a fan of long-distance running or burpees..."
            value={formData.exercise_dislikes}
            onChange={(e) => updateField("exercise_dislikes", e.target.value)}
            className="mt-1.5"
            rows={3}
          />
        </div>
        <div>
          <Label htmlFor="additional-notes">
            Any additional notes or preferences (optional)
          </Label>
          <Textarea
            id="additional-notes"
            placeholder="e.g. I prefer morning workouts, I have a time constraint on Wednesdays, etc."
            value={formData.additional_notes}
            onChange={(e) => updateField("additional_notes", e.target.value)}
            className="mt-1.5"
            rows={3}
          />
        </div>
      </div>
    </div>
  )
}

/* ─── Step 10: Review ────────────────────────────────────────────── */

function Step10Review({
  formData,
  onGoToStep,
}: {
  formData: FormData
  onGoToStep: (step: number) => void
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-primary mb-2">
        Review your answers
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        Make sure everything looks good before submitting. Click any section
        header to make changes.
      </p>
      <div className="space-y-4">
        {/* Goals */}
        <ReviewCard title="Fitness Goals" stepNumber={1} onEdit={onGoToStep}>
          {formData.goals.length > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {formData.goals.map((goal) => (
                  <Badge key={goal} variant="secondary">
                    {GOAL_LABELS[goal] ?? goal}
                  </Badge>
                ))}
              </div>
              {formData.sport && (
                <p className="text-sm text-foreground">
                  <span className="text-muted-foreground">Sport:</span>{" "}
                  {formData.sport}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No goals selected</p>
          )}
        </ReviewCard>

        {/* About You */}
        <ReviewCard title="About You" stepNumber={2} onEdit={onGoToStep}>
          <div className="space-y-1">
            {formData.date_of_birth && (
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Birth year:</span>{" "}
                {formData.date_of_birth}
              </p>
            )}
            {formData.gender && (
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Gender:</span>{" "}
                {GENDER_LABELS[formData.gender] ?? formData.gender}
              </p>
            )}
            {!formData.date_of_birth && !formData.gender && (
              <p className="text-sm text-muted-foreground">Not provided</p>
            )}
          </div>
        </ReviewCard>

        {/* Fitness Level */}
        <ReviewCard title="Fitness Level" stepNumber={3} onEdit={onGoToStep}>
          <div className="space-y-1">
            <p className="text-sm text-foreground">
              {formData.experience_level
                ? LEVEL_LABELS[formData.experience_level] ??
                  formData.experience_level
                : "Not selected"}
            </p>
            {formData.movement_confidence && (
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">
                  Movement confidence:
                </span>{" "}
                {MOVEMENT_CONFIDENCE_LABELS[formData.movement_confidence]}
              </p>
            )}
          </div>
        </ReviewCard>

        {/* Recovery & Lifestyle */}
        <ReviewCard
          title="Recovery & Lifestyle"
          stepNumber={4}
          onEdit={onGoToStep}
        >
          <div className="space-y-1">
            {formData.sleep_hours && (
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Sleep:</span>{" "}
                {SLEEP_LABELS[formData.sleep_hours]}
              </p>
            )}
            {formData.stress_level && (
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Stress:</span>{" "}
                {STRESS_LABELS[formData.stress_level]}
              </p>
            )}
            {formData.occupation_activity_level && (
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Occupation:</span>{" "}
                {OCCUPATION_LABELS[formData.occupation_activity_level]}
              </p>
            )}
            {!formData.sleep_hours &&
              !formData.stress_level &&
              !formData.occupation_activity_level && (
                <p className="text-sm text-muted-foreground">Not provided</p>
              )}
          </div>
        </ReviewCard>

        {/* Training History */}
        <ReviewCard
          title="Training History"
          stepNumber={5}
          onEdit={onGoToStep}
        >
          <div className="space-y-1">
            {formData.training_years !== null && (
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Years:</span>{" "}
                {formData.training_years}
              </p>
            )}
            {formData.training_background && (
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Background:</span>{" "}
                {formData.training_background}
              </p>
            )}
            {!formData.training_years && !formData.training_background && (
              <p className="text-sm text-muted-foreground">
                No training history provided
              </p>
            )}
          </div>
        </ReviewCard>

        {/* Injuries */}
        <ReviewCard
          title="Injuries & Limitations"
          stepNumber={6}
          onEdit={onGoToStep}
        >
          <div className="space-y-2">
            {formData.injuries_text && (
              <p className="text-sm text-foreground">{formData.injuries_text}</p>
            )}
            {formData.injury_details.length > 0 && (
              <div className="space-y-1.5">
                {formData.injury_details.map((injury, i) => (
                  <div
                    key={i}
                    className="text-sm text-foreground bg-surface/50 rounded px-3 py-1.5"
                  >
                    <span className="font-medium">{injury.area}</span>
                    {injury.side && (
                      <span className="text-muted-foreground">
                        {" "}
                        ({injury.side})
                      </span>
                    )}
                    {injury.severity && (
                      <span className="text-muted-foreground">
                        {" "}
                        — {injury.severity}
                      </span>
                    )}
                    {injury.notes && (
                      <span className="text-muted-foreground">
                        : {injury.notes}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!formData.injuries_text &&
              formData.injury_details.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No injuries reported
                </p>
              )}
          </div>
        </ReviewCard>

        {/* Equipment */}
        <ReviewCard
          title="Available Equipment"
          stepNumber={7}
          onEdit={onGoToStep}
        >
          {formData.available_equipment.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {formData.available_equipment.map((eq) => (
                <Badge key={eq} variant="outline" className="text-xs">
                  {EQUIPMENT_LABELS[eq] ?? eq}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No equipment selected
            </p>
          )}
        </ReviewCard>

        {/* Schedule */}
        <ReviewCard title="Schedule" stepNumber={8} onEdit={onGoToStep}>
          <div className="space-y-1">
            <p className="text-sm text-foreground">
              <span className="text-muted-foreground">Days:</span>{" "}
              {formData.preferred_day_names
                .map((d) => DAY_NAMES[d - 1])
                .join(", ") || "None selected"}{" "}
              ({formData.preferred_day_names.length} days/week)
            </p>
            <p className="text-sm text-foreground">
              <span className="text-muted-foreground">Duration:</span>{" "}
              {formData.preferred_session_minutes} minutes per session
            </p>
            {formData.time_efficiency_preference && (
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Time strategy:</span>{" "}
                {TIME_EFFICIENCY_LABELS[formData.time_efficiency_preference]}
              </p>
            )}
          </div>
        </ReviewCard>

        {/* Preferences */}
        <ReviewCard
          title="Exercise Preferences"
          stepNumber={9}
          onEdit={onGoToStep}
        >
          <div className="space-y-1">
            {formData.preferred_techniques.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-1">
                {formData.preferred_techniques.map((t) => (
                  <Badge key={t} variant="secondary" className="text-xs">
                    {TECHNIQUE_LABELS[t] ?? t}
                  </Badge>
                ))}
              </div>
            )}
            {formData.exercise_likes && (
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Likes:</span>{" "}
                {formData.exercise_likes}
              </p>
            )}
            {formData.exercise_dislikes && (
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Dislikes:</span>{" "}
                {formData.exercise_dislikes}
              </p>
            )}
            {formData.additional_notes && (
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Notes:</span>{" "}
                {formData.additional_notes}
              </p>
            )}
            {!formData.exercise_likes &&
              !formData.exercise_dislikes &&
              !formData.additional_notes &&
              formData.preferred_techniques.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No preferences provided
                </p>
              )}
          </div>
        </ReviewCard>
      </div>
    </div>
  )
}

function ReviewCard({
  title,
  stepNumber,
  onEdit,
  children,
}: {
  title: string
  stepNumber: number
  onEdit: (step: number) => void
  children: React.ReactNode
}) {
  return (
    <div className="border border-border rounded-lg p-3 sm:p-4">
      <div className="flex items-center justify-between mb-1.5 sm:mb-2">
        <h3 className="text-xs sm:text-sm font-semibold text-primary">{title}</h3>
        <button
          type="button"
          onClick={() => onEdit(stepNumber)}
          className="text-[10px] sm:text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          Edit
        </button>
      </div>
      <div className="text-xs sm:text-sm [&_p]:text-xs sm:[&_p]:text-sm">{children}</div>
    </div>
  )
}
