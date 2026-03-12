"use client"

import { useState, useCallback } from "react"
import { Star, Send, Check, Plus, X, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface ProgramFeedbackFormProps {
  programId: string
  onSuccess?: () => void
  className?: string
}

interface FeedbackIssue {
  category: string
  description: string
  severity: "low" | "medium" | "high"
}

const ISSUE_CATEGORY_LABELS: Record<string, string> = {
  push_pull_imbalance: "Push/Pull Imbalance",
  missing_movement_pattern: "Missing Movement Pattern",
  wrong_difficulty: "Wrong Difficulty",
  bad_exercise_choice: "Bad Exercise Choice",
  too_many_exercises: "Too Many Exercises",
  periodization_issue: "Periodization Issue",
  equipment_mismatch: "Equipment Mismatch",
  other: "Other",
}

const SEVERITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
}

function StarRating({
  value,
  onChange,
  label,
  required,
}: {
  value: number
  onChange: (v: number) => void
  label: string
  required?: boolean
}) {
  const [hover, setHover] = useState(0)

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-40">
        {label}
        {required && <span className="text-error ml-0.5">*</span>}
      </span>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className="p-0.5 transition-colors"
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onChange(star === value ? 0 : star)}
          >
            <Star
              className={cn(
                "h-4 w-4 transition-colors",
                (hover || value) >= star
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/40"
              )}
            />
          </button>
        ))}
      </div>
    </div>
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "text-[10px] font-body",
        severity === "medium" && "bg-warning/10 text-warning",
        severity === "high" && "bg-error/10 text-error"
      )}
    >
      {SEVERITY_LABELS[severity] ?? severity}
    </Badge>
  )
}

export function ProgramFeedbackForm({
  programId,
  onSuccess,
  className,
}: ProgramFeedbackFormProps) {
  const [overallQuality, setOverallQuality] = useState(0)
  const [balanceQuality, setBalanceQuality] = useState(0)
  const [exerciseSelection, setExerciseSelection] = useState(0)
  const [periodization, setPeriodization] = useState(0)
  const [difficultyAppropriateness, setDifficultyAppropriateness] = useState(0)

  const [issues, setIssues] = useState<FeedbackIssue[]>([])
  const [notes, setNotes] = useState("")
  const [showNotes, setShowNotes] = useState(false)

  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const addIssue = useCallback(() => {
    setIssues((prev) => [
      ...prev,
      { category: "", description: "", severity: "medium" },
    ])
  }, [])

  const updateIssue = useCallback(
    (index: number, updates: Partial<FeedbackIssue>) => {
      setIssues((prev) =>
        prev.map((issue, i) => (i === index ? { ...issue, ...updates } : issue))
      )
    },
    []
  )

  const removeIssue = useCallback((index: number) => {
    setIssues((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (submitting || overallQuality === 0) return
    setSubmitting(true)
    try {
      const validIssues = issues.filter(
        (issue) => issue.category && issue.description.trim()
      )

      await fetch(`/api/admin/programs/${programId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overall_quality: overallQuality,
          ...(balanceQuality > 0 ? { balance_quality: balanceQuality } : {}),
          ...(exerciseSelection > 0
            ? { exercise_selection: exerciseSelection }
            : {}),
          ...(periodization > 0 ? { periodization } : {}),
          ...(difficultyAppropriateness > 0
            ? { difficulty_appropriateness: difficultyAppropriateness }
            : {}),
          ...(validIssues.length > 0 ? { issues: validIssues } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      })
      setSubmitted(true)
      onSuccess?.()
    } catch {
      // Silent fail — feedback is non-critical
    } finally {
      setSubmitting(false)
    }
  }, [
    programId,
    overallQuality,
    balanceQuality,
    exerciseSelection,
    periodization,
    difficultyAppropriateness,
    issues,
    notes,
    submitting,
    onSuccess,
  ])

  if (submitted) {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs text-muted-foreground",
          className
        )}
      >
        <Check className="h-3 w-3 text-success" />
        Thanks for your feedback
      </div>
    )
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Star ratings */}
      <div className="space-y-1">
        <h4 className="text-sm font-heading font-semibold text-foreground mb-2">
          Program Ratings
        </h4>
        <StarRating
          value={overallQuality}
          onChange={setOverallQuality}
          label="Overall Quality"
          required
        />
        <StarRating
          value={balanceQuality}
          onChange={setBalanceQuality}
          label="Balance Quality"
        />
        <StarRating
          value={exerciseSelection}
          onChange={setExerciseSelection}
          label="Exercise Selection"
        />
        <StarRating
          value={periodization}
          onChange={setPeriodization}
          label="Periodization"
        />
        <StarRating
          value={difficultyAppropriateness}
          onChange={setDifficultyAppropriateness}
          label="Difficulty Appropriateness"
        />
      </div>

      {/* Specific issues */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-heading font-semibold text-foreground">
            Specific Issues
          </h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={addIssue}
          >
            <Plus className="h-3 w-3" />
            Add Issue
          </Button>
        </div>

        {issues.length > 0 && (
          <div className="space-y-3">
            {issues.map((issue, index) => (
              <div
                key={index}
                className="relative rounded-md border border-border p-3 space-y-2"
              >
                <button
                  type="button"
                  onClick={() => removeIssue(index)}
                  className="absolute top-2 right-2 p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>

                <div className="flex items-center gap-2 pr-6">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Category
                    </Label>
                    <Select
                      value={issue.category}
                      onValueChange={(v) =>
                        updateIssue(index, { category: v })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ISSUE_CATEGORY_LABELS).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              <span className="flex items-center gap-1.5">
                                {value !== "other" && (
                                  <AlertTriangle className="h-3 w-3 text-muted-foreground" />
                                )}
                                {label}
                              </span>
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="w-28">
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Severity
                    </Label>
                    <Select
                      value={issue.severity}
                      onValueChange={(v) =>
                        updateIssue(index, {
                          severity: v as FeedbackIssue["severity"],
                        })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {issue.category && (
                    <Badge variant="outline" className="text-[10px]">
                      {ISSUE_CATEGORY_LABELS[issue.category]}
                    </Badge>
                  )}
                  {issue.severity && (
                    <SeverityBadge severity={issue.severity} />
                  )}
                </div>

                <Textarea
                  value={issue.description}
                  onChange={(e) =>
                    updateIssue(index, { description: e.target.value })
                  }
                  placeholder="Describe the issue..."
                  className="text-xs h-16 resize-none"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      {showNotes ? (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Additional Notes
          </Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes or corrections..."
            className="text-xs h-16 resize-none"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowNotes(true)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          + Add notes
        </button>
      )}

      {/* Submit */}
      {overallQuality > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={handleSubmit}
          disabled={submitting}
        >
          <Send className="h-3 w-3" />
          {submitting ? "Sending..." : "Submit Feedback"}
        </Button>
      )}
    </div>
  )
}
