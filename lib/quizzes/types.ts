// lib/quizzes/types.ts — the shapes every other quiz module speaks.
//
// THIS FILE IMPORTS NOTHING, AND THAT IS LOAD-BEARING. `score.ts`, `gate.ts`
// and `public-definition.ts` are pure modules whose tests run with zero mocks
// — the same contract as lib/lead-engine/pipeline-move.ts. If `QuizDefinition`
// lived in `lib/db/quizzes.ts`, importing it would drag `@/lib/supabase` into
// their module graph and that property would quietly stop being true.
//
// Precedent: pipeline-move.ts declares StageKind / MoveTrigger locally rather
// than in types/database.ts for exactly this reason.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §1

export type QuizStatus = "draft" | "active" | "archived"
export type QuizAttemptStatus = "in_progress" | "completed"
export type QuizAlertStatus = "not_needed" | "sent" | "failed"

export interface QuizOption {
  id: string
  questionId: string
  position: number
  label: string
  /**
   * Contributes to the score. ALL-ZERO ACROSS A QUESTION marks it
   * segmentation-only: it adds nothing to the raw total and nothing to the
   * maximum, so it cannot move the percentage. "Where are you based?" is not
   * a preparedness question.
   */
  weight: number
  /** Only meaningful on a question whose `branchId` is null — the router. */
  routesToBranchId: string | null
  /** A vote. Most votes wins; ties break by profile position. */
  profileId: string | null
}

export interface QuizQuestion {
  id: string
  quizId: string
  /** null means asked of everyone — the router and the shared questions. */
  branchId: string | null
  /** GLOBAL across the quiz, not per branch. See the migration's header. */
  position: number
  prompt: string
  helpText: string | null
  isActive: boolean
  options: QuizOption[]
}

export interface QuizBranch {
  id: string
  quizId: string
  /** A CONTRACT: sequences filter on this value. Renaming it stops enrolment. */
  key: string
  name: string
  description: string | null
  position: number
}

export interface QuizTier {
  id: string
  quizId: string
  key: string
  position: number
  /** Inclusive at both ends, against the NORMALISED 0..100 score. */
  minScore: number
  maxScore: number
  headline: string
  body: string
  ctaLabel: string | null
  ctaHref: string | null
}

export interface QuizProfile {
  id: string
  quizId: string
  key: string
  name: string
  description: string
  /** Position 0 is the no-vote fallback. */
  position: number
}

/** Everything needed to render, walk, gate and score a quiz. */
export interface QuizDefinition {
  id: string
  key: string
  name: string
  status: QuizStatus
  introHeadline: string
  introBody: string
  gateHeadline: string
  gateBody: string
  resultHeadline: string
  /** Present while the quiz still carries reconstructed, unverified numbers. */
  seedMarker: string | null
  branches: QuizBranch[]
  questions: QuizQuestion[]
  tiers: QuizTier[]
  profiles: QuizProfile[]
}

export interface QuizAnswer {
  questionId: string
  optionId: string
}
