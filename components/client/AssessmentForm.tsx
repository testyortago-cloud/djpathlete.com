"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import { toast } from "sonner"
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Loader2,
  Activity,
  Target,
  Settings2,
  Heart,
  ArrowDown,
  ArrowUp,
  RotateCcw,
  Grip,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import type { AssessmentQuestion, AssessmentSection, AbilityLevel, ComputedLevels } from "@/types/database"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { summarizeApiError, type FieldErrors } from "@/lib/errors/humanize"

/* ─── Constants ──────────────────────────────────────────────────── */

const SECTIONS: { key: AssessmentSection; label: string; description: string; icon: typeof Activity }[] = [
  {
    key: "background",
    label: "Background",
    description: "Tell us about your training history and goals.",
    icon: Target,
  },
  {
    key: "movement_screen",
    label: "Movement Screen",
    description: "Answer questions about your movement capabilities for each pattern.",
    icon: Activity,
  },
  {
    key: "context",
    label: "Training Context",
    description: "Help us understand your schedule and any limitations.",
    icon: Settings2,
  },
  {
    key: "preferences",
    label: "Preferences",
    description: "Share your training likes, dislikes, and any additional notes.",
    icon: Heart,
  },
]

const MOVEMENT_PATTERN_LABELS: Record<string, string> = {
  squat: "Squat",
  push: "Push",
  pull: "Pull",
  hinge: "Hinge",
}

const MOVEMENT_PATTERN_ICONS: Record<string, typeof ArrowDown> = {
  squat: ArrowDown,
  push: ArrowUp,
  pull: RotateCcw,
  hinge: Grip,
}

const LEVEL_COLORS: Record<AbilityLevel, string> = {
  beginner: "bg-warning/10 text-warning border-warning/20",
  intermediate: "bg-primary/10 text-primary border-primary/20",
  advanced: "bg-success/10 text-success border-success/20",
  elite: "bg-purple-100 text-purple-700 border-purple-200",
}

const LEVEL_LABELS: Record<AbilityLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  elite: "Elite",
}

/* ─── Animation Variants ─────────────────────────────────────────── */

const stepVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
}

/* ─── Component ──────────────────────────────────────────────────── */

export function AssessmentForm() {
  const router = useRouter()

  // Data state
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [answers, setAnswers] = useState<Record<string, string | string[] | number>>({})

  // Navigation state
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [computedLevels, setComputedLevels] = useState<ComputedLevels | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitFieldErrors, setSubmitFieldErrors] = useState<FieldErrors>({})

  // Fetch questions
  useEffect(() => {
    async function fetchQuestions() {
      try {
        const res = await fetch("/api/assessment/questions")
        if (!res.ok) throw new Error("Failed to load questions")
        const data = await res.json()
        setQuestions(data.questions ?? data)
      } catch {
        toast.error("Failed to load assessment questions")
      } finally {
        setLoading(false)
      }
    }
    fetchQuestions()
  }, [])

  // Group questions by section
  const questionsBySection = useMemo(() => {
    const grouped: Record<AssessmentSection, AssessmentQuestion[]> = {
      background: [],
      movement_screen: [],
      context: [],
      preferences: [],
    }
    for (const q of questions) {
      if (grouped[q.section]) {
        grouped[q.section].push(q)
      }
    }
    // Sort each section by order_index
    for (const key of Object.keys(grouped) as AssessmentSection[]) {
      grouped[key].sort((a, b) => a.order_index - b.order_index)
    }
    return grouped
  }, [questions])

  // Get movement patterns for movement screen section
  const movementPatterns = useMemo(() => {
    const patterns = new Set<string>()
    for (const q of questionsBySection.movement_screen) {
      if (q.movement_pattern) patterns.add(q.movement_pattern)
    }
    return Array.from(patterns)
  }, [questionsBySection])

  // Determine visible questions for current section (handling conditional branching)
  const getVisibleQuestions = useCallback(
    (section: AssessmentSection): AssessmentQuestion[] => {
      const sectionQuestions = questionsBySection[section]
      if (section !== "movement_screen") {
        return sectionQuestions.filter((q) => !q.parent_question_id)
      }

      // For movement screen, show root questions and conditionally show children
      const visible: AssessmentQuestion[] = []
      for (const q of sectionQuestions) {
        if (!q.parent_question_id) {
          visible.push(q)
        } else {
          // Show child question if parent was answered with the expected answer
          const parentAnswer = answers[q.parent_question_id]
          if (parentAnswer !== undefined && String(parentAnswer) === q.parent_answer) {
            visible.push(q)
          }
        }
      }
      return visible
    },
    [questionsBySection, answers],
  )

  // Total visible questions for progress calculation
  const totalVisibleQuestions = useMemo(() => {
    let total = 0
    for (const section of SECTIONS) {
      total += getVisibleQuestions(section.key).length
    }
    return total
  }, [getVisibleQuestions])

  // Answered count
  const answeredCount = useMemo(() => {
    let count = 0
    for (const section of SECTIONS) {
      const visible = getVisibleQuestions(section.key)
      for (const q of visible) {
        if (answers[q.id] !== undefined && answers[q.id] !== "") {
          count++
        }
      }
    }
    return count
  }, [getVisibleQuestions, answers])

  const progressValue = totalVisibleQuestions > 0 ? (answeredCount / totalVisibleQuestions) * 100 : 0

  const currentSection = SECTIONS[currentSectionIndex]
  const isLastSection = currentSectionIndex === SECTIONS.length - 1

  // Answer handlers
  const setAnswer = useCallback((questionId: string, value: string | string[] | number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
  }, [])

  const toggleMultiSelect = useCallback((questionId: string, value: string) => {
    setAnswers((prev) => {
      const current = (prev[questionId] as string[]) ?? []
      if (current.includes(value)) {
        return { ...prev, [questionId]: current.filter((v) => v !== value) }
      }
      return { ...prev, [questionId]: [...current, value] }
    })
  }, [])

  // Navigation
  const handleNext = () => {
    if (isLastSection) {
      // Calculate results and show summary
      computeAndShowResults()
      return
    }
    setDirection(1)
    setCurrentSectionIndex((prev) => prev + 1)
  }

  const handleBack = () => {
    if (showResults) {
      setShowResults(false)
      return
    }
    setDirection(-1)
    setCurrentSectionIndex((prev) => Math.max(prev - 1, 0))
  }

  // Compute ability levels from answers
  const computeAndShowResults = () => {
    const patternScores: Record<string, number[]> = {
      squat: [],
      push: [],
      pull: [],
      hinge: [],
    }

    // Gather scores from movement screen questions
    for (const q of questionsBySection.movement_screen) {
      if (!q.movement_pattern || !q.level_impact) continue
      const answer = answers[q.id]
      if (answer === undefined) continue

      const answerStr = String(answer)
      const impact = q.level_impact[answerStr]
      if (typeof impact === "number") {
        if (!patternScores[q.movement_pattern]) {
          patternScores[q.movement_pattern] = []
        }
        patternScores[q.movement_pattern].push(impact)
      }
    }

    function scoreToLevel(score: number): AbilityLevel {
      if (score >= 3.5) return "elite"
      if (score >= 2.5) return "advanced"
      if (score >= 1.5) return "intermediate"
      return "beginner"
    }

    function averageScore(scores: number[]): number {
      if (scores.length === 0) return 0
      return scores.reduce((a, b) => a + b, 0) / scores.length
    }

    const squat = averageScore(patternScores.squat)
    const push = averageScore(patternScores.push)
    const pull = averageScore(patternScores.pull)
    const hinge = averageScore(patternScores.hinge)
    const allScores = [...patternScores.squat, ...patternScores.push, ...patternScores.pull, ...patternScores.hinge]
    const overall = averageScore(allScores)

    const levels: ComputedLevels = {
      overall: scoreToLevel(overall),
      squat: scoreToLevel(squat),
      push: scoreToLevel(push),
      pull: scoreToLevel(pull),
      hinge: scoreToLevel(hinge),
    }

    setComputedLevels(levels)
    setShowResults(true)
  }

  // Submit
  const handleSubmit = async () => {
    if (!computedLevels) return
    setIsSubmitting(true)
    setSubmitError(null)
    setSubmitFieldErrors({})

    try {
      const res = await fetch("/api/assessment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          computed_levels: computedLevels,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const { message, fieldErrors: fe } = summarizeApiError(
          res,
          data,
          "We couldn't submit your assessment. Please try again.",
        )
        setSubmitError(message)
        setSubmitFieldErrors(fe)
        toast.error(message)
        setIsSubmitting(false)
        return
      }

      toast.success("Assessment submitted successfully!")
      setIsGenerating(true)

      // Wait a moment then redirect
      setTimeout(() => {
        router.push("/client/workouts")
      }, 3000)
    } catch {
      const message = "We couldn't reach the server. Please check your connection and try again."
      setSubmitError(message)
      toast.error(message)
      setIsSubmitting(false)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading assessment...</p>
      </div>
    )
  }

  // Generating state
  if (isGenerating) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center py-20 gap-6"
      >
        <div className="relative">
          <div className="size-20 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2 className="size-10 animate-spin text-primary" />
          </div>
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold text-primary font-heading">Generating your program...</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            We are analyzing your assessment results and building a personalized training program. You will be
            redirected shortly.
          </p>
        </div>
      </motion.div>
    )
  }

  // Questions not loaded
  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Activity className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No assessment questions available yet. Please check back later.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Progress header */}
      <div className="bg-white rounded-xl border border-border p-4 sm:p-6">
        <div className="flex items-center justify-between mb-2.5 sm:mb-3">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground">
            {showResults ? "Review Results" : `Section ${currentSectionIndex + 1} of ${SECTIONS.length}`}
          </p>
          <div className="flex items-center gap-1.5">
            {showResults ? (
              <span className="text-xs sm:text-sm font-medium text-primary">Assessment Complete</span>
            ) : (
              <>
                {(() => {
                  const SectionIcon = currentSection.icon
                  return <SectionIcon className="size-3.5 sm:size-4 text-primary" />
                })()}
                <span className="text-xs sm:text-sm font-medium text-primary">{currentSection.label}</span>
              </>
            )}
          </div>
        </div>
        <Progress value={showResults ? 100 : progressValue} className="h-1.5 sm:h-2" />

        {/* Section dots */}
        <div className="flex items-center justify-between mt-3 sm:mt-4 gap-1">
          {SECTIONS.map((section, index) => {
            const isComplete = index < currentSectionIndex || showResults
            const isCurrent = index === currentSectionIndex && !showResults
            return (
              <button
                key={section.key}
                onClick={() => {
                  if (!showResults) {
                    setDirection(index > currentSectionIndex ? 1 : -1)
                    setCurrentSectionIndex(index)
                  }
                }}
                className={`flex items-center justify-center size-8 sm:size-10 rounded-full text-xs font-medium transition-all ${
                  isCurrent
                    ? "bg-primary text-primary-foreground"
                    : isComplete
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                }`}
                title={section.label}
              >
                {isComplete ? <Check className="size-3.5" /> : index + 1}
              </button>
            )
          })}
        </div>
      </div>

      {/* Form content */}
      <div className="bg-white rounded-xl border border-border p-4 sm:p-6 min-h-[400px] relative overflow-hidden">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={showResults ? "results" : currentSection.key}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
            {showResults && computedLevels ? (
              <ResultsSummary levels={computedLevels} />
            ) : currentSection.key === "movement_screen" ? (
              <MovementScreenSection
                questions={getVisibleQuestions("movement_screen")}
                patterns={movementPatterns}
                answers={answers}
                onAnswer={setAnswer}
                sectionInfo={currentSection}
              />
            ) : (
              <GenericSection
                questions={getVisibleQuestions(currentSection.key)}
                answers={answers}
                onAnswer={setAnswer}
                onToggleMulti={toggleMultiSelect}
                sectionInfo={currentSection}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {(submitError || Object.keys(submitFieldErrors).length > 0) && (
        <FormErrorBanner message={submitError} fieldErrors={submitFieldErrors} />
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={currentSectionIndex === 0 && !showResults}
          className="gap-1.5 px-4 sm:px-6"
        >
          <ChevronLeft className="size-4" />
          Back
        </Button>

        {showResults ? (
          <Button onClick={handleSubmit} disabled={isSubmitting} className="gap-1.5 px-4 sm:px-6">
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Check className="size-4" />
                Submit Assessment
              </>
            )}
          </Button>
        ) : (
          <Button onClick={handleNext} className="gap-1.5 px-4 sm:px-6">
            {isLastSection ? "View Results" : "Next"}
            <ChevronRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

/* ─── Section Header ─────────────────────────────────────────────── */

function SectionHeader({
  label,
  description,
  icon: Icon,
}: {
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="size-5 text-primary" />
        <h2 className="text-lg font-semibold text-primary font-heading">{label}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

/* ─── Generic Section (background, context, preferences) ─────────── */

function GenericSection({
  questions,
  answers,
  onAnswer,
  onToggleMulti,
  sectionInfo,
}: {
  questions: AssessmentQuestion[]
  answers: Record<string, string | string[] | number>
  onAnswer: (id: string, value: string | string[] | number) => void
  onToggleMulti: (id: string, value: string) => void
  sectionInfo: { label: string; description: string; icon: React.ComponentType<{ className?: string }> }
}) {
  return (
    <div>
      <SectionHeader label={sectionInfo.label} description={sectionInfo.description} icon={sectionInfo.icon} />
      <div className="space-y-6">
        {questions.map((q) => (
          <QuestionCard
            key={q.id}
            question={q}
            answer={answers[q.id]}
            onAnswer={onAnswer}
            onToggleMulti={onToggleMulti}
          />
        ))}
        {questions.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">No questions in this section yet.</p>
        )}
      </div>
    </div>
  )
}

/* ─── Movement Screen Section ────────────────────────────────────── */

function MovementScreenSection({
  questions,
  patterns,
  answers,
  onAnswer,
  sectionInfo,
}: {
  questions: AssessmentQuestion[]
  patterns: string[]
  answers: Record<string, string | string[] | number>
  onAnswer: (id: string, value: string | string[] | number) => void
  sectionInfo: { label: string; description: string; icon: React.ComponentType<{ className?: string }> }
}) {
  return (
    <div>
      <SectionHeader label={sectionInfo.label} description={sectionInfo.description} icon={sectionInfo.icon} />
      <div className="space-y-8">
        {patterns.map((pattern) => {
          const patternQuestions = questions.filter((q) => q.movement_pattern === pattern)
          if (patternQuestions.length === 0) return null

          const PatternIcon = MOVEMENT_PATTERN_ICONS[pattern] ?? Activity
          const patternLabel = MOVEMENT_PATTERN_LABELS[pattern] ?? pattern

          return (
            <div key={pattern}>
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-border">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
                  <PatternIcon className="size-4 text-primary" />
                </div>
                <h3 className="text-base font-semibold text-foreground font-heading">{patternLabel}</h3>
              </div>
              <div className="space-y-4 pl-2">
                {patternQuestions.map((q) => (
                  <motion.div
                    key={q.id}
                    initial={q.parent_question_id ? { opacity: 0, height: 0 } : false}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className={q.parent_question_id ? "ml-4 border-l-2 border-primary/20 pl-4" : ""}
                  >
                    <QuestionCard
                      question={q}
                      answer={answers[q.id]}
                      onAnswer={onAnswer}
                      onToggleMulti={() => {}}
                      isMovementScreen
                    />
                  </motion.div>
                ))}
              </div>
            </div>
          )
        })}
        {patterns.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">No movement screen questions available yet.</p>
        )}
      </div>
    </div>
  )
}

/* ─── Question Card ──────────────────────────────────────────────── */

function QuestionCard({
  question,
  answer,
  onAnswer,
  onToggleMulti,
  isMovementScreen = false,
}: {
  question: AssessmentQuestion
  answer: string | string[] | number | undefined
  onAnswer: (id: string, value: string | string[] | number) => void
  onToggleMulti: (id: string, value: string) => void
  isMovementScreen?: boolean
}) {
  const { id, question_text, question_type, options } = question

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium text-foreground">{question_text}</Label>

      {question_type === "yes_no" && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onAnswer(id, "yes")}
            className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-all border ${
              answer === "yes"
                ? "bg-success/10 border-success text-success ring-1 ring-success"
                : "border-border hover:border-primary/40 hover:bg-surface/50 text-foreground"
            }`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => onAnswer(id, "no")}
            className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-all border ${
              answer === "no"
                ? "bg-muted border-border text-foreground ring-1 ring-border"
                : "border-border hover:border-primary/40 hover:bg-surface/50 text-foreground"
            }`}
          >
            No
          </button>
        </div>
      )}

      {question_type === "single_select" && options && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onAnswer(id, opt.value)}
              className={`py-2.5 px-4 rounded-lg text-sm font-medium transition-all border text-left ${
                answer === opt.value
                  ? "border-primary bg-primary/5 ring-1 ring-primary text-primary"
                  : "border-border hover:border-primary/40 hover:bg-surface/50 text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {question_type === "multi_select" && options && (
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => {
            const selected = Array.isArray(answer) && answer.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onToggleMulti(id, opt.value)}
                className={`py-1.5 px-3 rounded-full text-sm font-medium transition-all border ${
                  selected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-primary/40 text-foreground"
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      )}

      {question_type === "number" && (
        <Input
          type="number"
          value={answer !== undefined ? String(answer) : ""}
          onChange={(e) => onAnswer(id, e.target.value ? Number(e.target.value) : "")}
          className="max-w-xs"
          placeholder="Enter a number"
        />
      )}

      {question_type === "text" && (
        <Textarea
          value={answer !== undefined ? String(answer) : ""}
          onChange={(e) => onAnswer(id, e.target.value)}
          placeholder="Type your answer..."
          rows={3}
        />
      )}
    </div>
  )
}

/* ─── Results Summary ────────────────────────────────────────────── */

function ResultsSummary({ levels }: { levels: ComputedLevels }) {
  const patterns = [
    { key: "squat" as const, label: "Squat" },
    { key: "push" as const, label: "Push" },
    { key: "pull" as const, label: "Pull" },
    { key: "hinge" as const, label: "Hinge" },
  ]

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-primary font-heading mb-2">Assessment Results</h2>
        <p className="text-sm text-muted-foreground">
          Here is a summary of your computed ability levels. Review them before submitting.
        </p>
      </div>

      {/* Overall level */}
      <div className="mb-8 p-4 rounded-xl bg-surface border border-border text-center">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Overall Level</p>
        <Badge className={`text-base px-4 py-1.5 ${LEVEL_COLORS[levels.overall]}`} variant="outline">
          {LEVEL_LABELS[levels.overall]}
        </Badge>
      </div>

      {/* Pattern breakdown */}
      <div className="grid grid-cols-2 gap-4">
        {patterns.map(({ key, label }) => {
          const level = levels[key]
          const PatternIcon = MOVEMENT_PATTERN_ICONS[key] ?? Activity
          return (
            <div key={key} className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <PatternIcon className="size-5 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">{label}</p>
              <Badge className={`text-xs ${LEVEL_COLORS[level]}`} variant="outline">
                {LEVEL_LABELS[level]}
              </Badge>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground mt-6 text-center">
        Click &quot;Submit Assessment&quot; to save your results and generate a personalized program.
      </p>
    </div>
  )
}
