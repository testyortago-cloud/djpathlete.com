import type { AbilityLevel, ComputedLevels, AssessmentQuestion } from "@/types/database"

interface ScoringInput {
  answers: Record<string, string> // question_id -> answer value
  questions: AssessmentQuestion[]
}

interface ScoringResult {
  computed_levels: ComputedLevels
  max_difficulty_score: number
}

/** Compute per-pattern scores from answers */
function computePatternScore(
  pattern: string,
  answers: Record<string, string>,
  questions: AssessmentQuestion[],
): number {
  let score = 0
  const patternQuestions = questions.filter((q) => q.movement_pattern === pattern && q.section === "movement_screen")

  for (const q of patternQuestions) {
    const answer = answers[q.id]
    if (answer && q.level_impact) {
      score += q.level_impact[answer] ?? 0
    }
  }
  return score
}

/** Map numeric score to ability level */
function scoreToLevel(score: number): AbilityLevel {
  if (score >= 9) return "elite"
  if (score >= 6) return "advanced"
  if (score >= 3) return "intermediate"
  return "beginner"
}

/** Map ability level to max exercise difficulty score */
function levelToMaxDifficulty(level: AbilityLevel): number {
  switch (level) {
    case "elite":
      return 10
    case "advanced":
      return 8
    case "intermediate":
      return 6
    case "beginner":
      return 4
  }
}

/** Main scoring function */
export function computeAssessmentScores(input: ScoringInput): ScoringResult {
  const patterns = ["squat", "push", "pull", "hinge"] as const
  const patternScores: Record<string, number> = {}
  const patternLevels: Record<string, AbilityLevel> = {}

  for (const pattern of patterns) {
    const score = computePatternScore(pattern, input.answers, input.questions)
    patternScores[pattern] = score
    patternLevels[pattern] = scoreToLevel(score)
  }

  // Overall level is the average of all pattern scores (rounded)
  const allScores = Object.values(patternScores)
  const avgScore = allScores.reduce((sum, s) => sum + s, 0) / allScores.length
  const overallLevel = scoreToLevel(Math.round(avgScore))

  const computed_levels: ComputedLevels = {
    overall: overallLevel,
    squat: patternLevels.squat,
    push: patternLevels.push,
    pull: patternLevels.pull,
    hinge: patternLevels.hinge,
  }

  return {
    computed_levels,
    max_difficulty_score: levelToMaxDifficulty(overallLevel),
  }
}

/** Compute reassessment adjustment based on 3 signals */
export function computeReassessmentAdjustment(input: {
  feedback: { overall_feeling: "too_easy" | "just_right" | "too_hard" }
  avgRpe: number
  movementImproved: boolean
  previousMaxDifficulty: number
}): number {
  let adjustment = 0

  if (input.feedback.overall_feeling === "too_easy") adjustment += 1
  if (input.avgRpe < 6) adjustment += 1
  if (input.feedback.overall_feeling === "too_hard") adjustment -= 1
  if (input.avgRpe > 9) adjustment -= 1
  if (input.movementImproved) adjustment += 1

  return Math.max(1, Math.min(10, input.previousMaxDifficulty + adjustment))
}
