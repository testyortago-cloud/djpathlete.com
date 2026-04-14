"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight, Check, Loader2, Frown, Smile, Meh, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import type { AssessmentResult, AssessmentQuestion, AbilityLevel } from "@/types/database"

interface ReassessmentFormProps {
  previousResult: AssessmentResult
  programExercises: { id: string; name: string }[]
  assessmentQuestions: AssessmentQuestion[]
}

type OverallFeeling = "too_easy" | "just_right" | "too_hard"

const TOTAL_SECTIONS = 2

const FEELING_OPTIONS: {
  value: OverallFeeling
  label: string
  icon: typeof Smile
  color: string
}[] = [
  {
    value: "too_easy",
    label: "Too Easy",
    icon: Frown,
    color:
      "border-success/40 bg-success/5 text-success hover:bg-success/10 data-[selected=true]:border-success data-[selected=true]:bg-success/15",
  },
  {
    value: "just_right",
    label: "Just Right",
    icon: Smile,
    color:
      "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 data-[selected=true]:border-primary data-[selected=true]:bg-primary/15",
  },
  {
    value: "too_hard",
    label: "Too Hard",
    icon: Meh,
    color:
      "border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10 data-[selected=true]:border-destructive data-[selected=true]:bg-destructive/15",
  },
]

export function ReassessmentForm({ previousResult, programExercises, assessmentQuestions }: ReassessmentFormProps) {
  const router = useRouter()
  const [currentSection, setCurrentSection] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showLoading, setShowLoading] = useState(false)

  // Section 1: Performance Feedback
  const [overallFeeling, setOverallFeeling] = useState<OverallFeeling | null>(null)
  const [exercisesTooEasy, setExercisesTooEasy] = useState<string[]>([])
  const [exercisesTooHard, setExercisesTooHard] = useState<string[]>([])
  const [newInjuries, setNewInjuries] = useState("")

  // Section 2: Movement Re-Screen answers
  const [movementAnswers, setMovementAnswers] = useState<Record<string, string>>({})

  // Filter movement screen questions — only show for patterns where client was beginner or intermediate
  const filteredMovementQuestions = assessmentQuestions.filter((q) => {
    if (q.section !== "movement_screen") return false
    if (!q.movement_pattern) return false

    const previousLevel = previousResult.computed_levels[q.movement_pattern] as AbilityLevel | undefined
    if (!previousLevel) return true // Show if no previous level
    if (previousLevel === "advanced" || previousLevel === "elite") return false

    // Only show root questions (no parent) or child questions whose parent answer matches
    if (q.parent_question_id) {
      const parentAnswer = movementAnswers[q.parent_question_id]
      return parentAnswer === q.parent_answer
    }
    return true
  })

  const hasMovementQuestions = filteredMovementQuestions.length > 0
  const totalSections = hasMovementQuestions ? TOTAL_SECTIONS : 1

  const progressPercent = Math.round(((currentSection + 1) / totalSections) * 100)

  const canProceed = useCallback(() => {
    if (currentSection === 0) {
      return overallFeeling !== null
    }
    return true
  }, [currentSection, overallFeeling])

  const handleNext = useCallback(() => {
    if (currentSection < totalSections - 1) {
      setCurrentSection((s) => s + 1)
    }
  }, [currentSection, totalSections])

  const handleBack = useCallback(() => {
    if (currentSection > 0) {
      setCurrentSection((s) => s - 1)
    }
  }, [currentSection])

  const toggleExerciseTooEasy = (exerciseId: string) => {
    setExercisesTooEasy((prev) =>
      prev.includes(exerciseId) ? prev.filter((id) => id !== exerciseId) : [...prev, exerciseId],
    )
  }

  const toggleExerciseTooHard = (exerciseId: string) => {
    setExercisesTooHard((prev) =>
      prev.includes(exerciseId) ? prev.filter((id) => id !== exerciseId) : [...prev, exerciseId],
    )
  }

  const handleSubmit = async () => {
    if (!overallFeeling) {
      toast.error("Please select how the program felt overall.")
      return
    }

    setIsSubmitting(true)
    setShowLoading(true)

    try {
      const res = await fetch("/api/assessment/reassess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: movementAnswers,
          feedback: {
            overall_feeling: overallFeeling,
            exercises_too_easy: exercisesTooEasy,
            exercises_too_hard: exercisesTooHard,
            new_injuries: newInjuries,
          },
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to submit reassessment")
      }

      toast.success("Reassessment complete! Your program is being updated.")

      // Small delay to show the success message
      await new Promise((resolve) => setTimeout(resolve, 1500))
      router.push("/client/workouts")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.")
      setIsSubmitting(false)
      setShowLoading(false)
    }
  }

  if (showLoading) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center py-20 text-center"
      >
        <div className="flex items-center justify-center size-16 rounded-2xl bg-primary/10 mb-6">
          <RefreshCw className="size-8 text-primary animate-spin" strokeWidth={1.5} />
        </div>
        <h2 className="text-xl font-semibold text-primary mb-2 font-heading">Adjusting your program...</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          We are analyzing your feedback and updating your training plan. This will only take a moment.
        </p>
        <div className="w-48 mt-6">
          <Progress value={75} className="h-1.5" />
        </div>
      </motion.div>
    )
  }

  return (
    <div>
      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
          <span>
            Section {currentSection + 1} of {totalSections}
          </span>
          <span>{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="h-1.5" />
      </div>

      <AnimatePresence mode="wait">
        {currentSection === 0 && (
          <motion.div
            key="feedback"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
          >
            <h2 className="text-lg font-semibold text-primary mb-1 font-heading">Performance Feedback</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Tell us how your program went so we can adjust your next one.
            </p>

            {/* Overall Feeling */}
            <div className="mb-6">
              <Label className="text-sm font-medium text-foreground mb-3 block">
                How did the program feel overall?
              </Label>
              <div className="grid grid-cols-3 gap-3">
                {FEELING_OPTIONS.map((option) => {
                  const Icon = option.icon
                  const isSelected = overallFeeling === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      data-selected={isSelected}
                      onClick={() => setOverallFeeling(option.value)}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all",
                        option.color,
                      )}
                    >
                      <Icon className="size-7" strokeWidth={1.5} />
                      <span className="text-xs sm:text-sm font-medium">{option.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Exercises Too Easy */}
            {programExercises.length > 0 && (
              <div className="mb-6">
                <Label className="text-sm font-medium text-foreground mb-3 block">Which exercises felt too easy?</Label>
                <div className="space-y-2 max-h-48 overflow-y-auto rounded-lg border border-border p-3">
                  {programExercises.map((exercise) => (
                    <label
                      key={`easy-${exercise.id}`}
                      className="flex items-center gap-3 py-1.5 px-1 rounded hover:bg-surface/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={exercisesTooEasy.includes(exercise.id)}
                        onCheckedChange={() => toggleExerciseTooEasy(exercise.id)}
                      />
                      <span className="text-sm text-foreground">{exercise.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Exercises Too Hard */}
            {programExercises.length > 0 && (
              <div className="mb-6">
                <Label className="text-sm font-medium text-foreground mb-3 block">Which exercises felt too hard?</Label>
                <div className="space-y-2 max-h-48 overflow-y-auto rounded-lg border border-border p-3">
                  {programExercises.map((exercise) => (
                    <label
                      key={`hard-${exercise.id}`}
                      className="flex items-center gap-3 py-1.5 px-1 rounded hover:bg-surface/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={exercisesTooHard.includes(exercise.id)}
                        onCheckedChange={() => toggleExerciseTooHard(exercise.id)}
                      />
                      <span className="text-sm text-foreground">{exercise.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* New Injuries */}
            <div className="mb-6">
              <Label className="text-sm font-medium text-foreground mb-2 block">Any new injuries or limitations?</Label>
              <Textarea
                value={newInjuries}
                onChange={(e) => setNewInjuries(e.target.value)}
                placeholder="Describe any new pain, discomfort, or limitations you've noticed..."
                rows={3}
                className="resize-none"
              />
            </div>
          </motion.div>
        )}

        {currentSection === 1 && hasMovementQuestions && (
          <motion.div
            key="movement"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
          >
            <h2 className="text-lg font-semibold text-primary mb-1 font-heading">Movement Re-Screen</h2>
            <p className="text-sm text-muted-foreground mb-6">Let us check your progress on key movements.</p>

            <div className="space-y-4">
              {filteredMovementQuestions.map((question) => (
                <div
                  key={question.id}
                  className={cn(
                    "rounded-xl border border-border p-4",
                    question.parent_question_id && "ml-4 border-l-2 border-l-primary/30",
                  )}
                >
                  <p className="text-sm font-medium text-foreground mb-3">{question.question_text}</p>
                  {question.movement_pattern && (
                    <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium capitalize mb-3">
                      {question.movement_pattern}
                    </span>
                  )}
                  {question.question_type === "yes_no" && (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setMovementAnswers((prev) => ({
                            ...prev,
                            [question.id]: "yes",
                          }))
                        }
                        className={cn(
                          "flex-1 rounded-lg border-2 py-2.5 text-sm font-medium transition-all",
                          movementAnswers[question.id] === "yes"
                            ? "border-success bg-success/10 text-success"
                            : "border-border text-muted-foreground hover:border-success/40 hover:text-success",
                        )}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setMovementAnswers((prev) => ({
                            ...prev,
                            [question.id]: "no",
                          }))
                        }
                        className={cn(
                          "flex-1 rounded-lg border-2 py-2.5 text-sm font-medium transition-all",
                          movementAnswers[question.id] === "no"
                            ? "border-destructive bg-destructive/10 text-destructive"
                            : "border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive",
                        )}
                      >
                        No
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {filteredMovementQuestions.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">
                    No movement patterns need re-screening. You are already performing at an advanced level across all
                    patterns.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-8 pt-4 border-t border-border">
        <Button variant="outline" onClick={handleBack} disabled={currentSection === 0} className="gap-1.5">
          <ChevronLeft className="size-4" />
          Back
        </Button>

        {currentSection < totalSections - 1 ? (
          <Button onClick={handleNext} disabled={!canProceed()} className="gap-1.5">
            Next
            <ChevronRight className="size-4" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={isSubmitting || !canProceed()} className="gap-1.5">
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Check className="size-4" />
                Complete Reassessment
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
