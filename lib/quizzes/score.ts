// lib/quizzes/score.ts — the pure decision core of the quiz.
//
// THIS MODULE MUST IMPORT NOTHING BUT TYPES — no `@/lib/supabase`, no DAL, no
// I/O. That purity is what lets its tests run with zero mocks, the same
// contract as lib/lead-engine/pipeline-move.ts. The impure caller
// (app/api/quiz/submit/route.ts) reads the definition and persists what this
// function decided.
//
// IT IS ALSO THE REASON A RESULT CANNOT BE FORGED. The browser posts answers;
// this runs on the server against the definition the server read. A `score` in
// the request body is never consulted, because there is nowhere here to put it.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §4.4

import type { QuizAnswer, QuizDefinition, QuizOption, QuizQuestion } from "@/lib/quizzes/types"

export interface QuizScoreResult {
  branchKey: string | null
  branchId: string | null
  rawScore: number
  maxScore: number
  /** 0..100, rounded. See `normalise` below for why it is not a raw total. */
  score: number
  tierKey: string | null
  profileKey: string | null
  /** Question ids the walk asked and got no usable answer for. */
  unanswered: string[]
}

/**
 * The questions this visitor is asked, in order.
 *
 * `branchId === null` on a QUESTION means "asked of everyone" — the router and
 * the shared segmentation questions. `position` is global across the quiz, so
 * a shared question at 20 genuinely sits between the router at 10 and a
 * branch's own at 50. There is no per-branch ordering column to keep in sync.
 */
export function walkedQuestions(definition: QuizDefinition, branchId: string | null): QuizQuestion[] {
  return definition.questions
    .filter((question) => question.isActive)
    .filter((question) => question.branchId === null || question.branchId === branchId)
    .slice()
    .sort((a, b) => a.position - b.position)
}

/**
 * THE BRANCH IS READ FROM THE ANSWERS, NEVER FROM THE CALLER.
 *
 * The first router option the visitor actually chose decides it. Taking it
 * from a request field would let a visitor pick which archetype sequence they
 * are enrolled into and which questions they are asked — and the branch key is
 * what four sequences filter on.
 */
function branchFromAnswers(definition: QuizDefinition, answers: QuizAnswer[]): string | null {
  const routerQuestions = definition.questions
    .filter((question) => question.branchId === null)
    .slice()
    .sort((a, b) => a.position - b.position)

  for (const question of routerQuestions) {
    for (const answer of answers) {
      if (answer.questionId !== question.id) continue
      const option = question.options.find((candidate) => candidate.id === answer.optionId)
      if (option?.routesToBranchId) return option.routesToBranchId
    }
  }
  return null
}

/**
 * `raw / max`, as a percentage.
 *
 * WHY NOT A RAW TOTAL. Branches do not have equal question counts — the
 * parent/coach path is differently voiced and shorter than the ceiling-breaker
 * one. A raw total would make Red mean one thing for a Rebuilder and something
 * else for a Ceiling Breaker, using one band set for both.
 *
 * `max === 0` is a real state, not a bug: a walk consisting only of
 * segmentation questions (every weight 0) has nothing to be a fraction of.
 * It scores 0 and lands in the lowest band, rather than producing NaN and a
 * result page with no tier on it.
 */
function normalise(raw: number, max: number): number {
  if (max <= 0) return 0
  return Math.round((raw / max) * 100)
}

/**
 * The answers worth STORING: every one whose question is really in this quiz
 * and whose option really belongs to that question, de-duplicated with the
 * last one winning.
 *
 * `scoreQuiz` already ignores a forged answer when it scores, so this is not
 * about the number. It is about what lands in `quiz_attempts.answers` — a row
 * an operator reads, a report counts, and a future re-score would trust. A
 * dropped answer must never be stored just because it could not have moved
 * the total.
 *
 * Pure, so the progress and submit routes share one definition of "valid"
 * rather than each growing their own.
 */
export function sanitiseAnswers(definition: QuizDefinition, answers: QuizAnswer[]): QuizAnswer[] {
  const questions = new Map(definition.questions.filter((q) => q.isActive).map((q) => [q.id, q]))
  const kept = new Map<string, string>()
  for (const answer of answers) {
    const question = questions.get(answer.questionId)
    if (!question) continue
    if (!question.options.some((option) => option.id === answer.optionId)) continue
    kept.set(answer.questionId, answer.optionId)
  }
  return [...kept].map(([questionId, optionId]) => ({ questionId, optionId }))
}

export function scoreQuiz(definition: QuizDefinition, answers: QuizAnswer[]): QuizScoreResult {
  const branchId = branchFromAnswers(definition, answers)
  const walk = walkedQuestions(definition, branchId)

  // Last answer to a question wins. A visitor who goes back and changes their
  // mind sends the question twice, and the later one is the one they meant.
  const chosen = new Map<string, string>()
  for (const answer of answers) chosen.set(answer.questionId, answer.optionId)

  let rawScore = 0
  let maxScore = 0
  const unanswered: string[] = []
  const votes = new Map<string, number>()

  for (const question of walk) {
    // Every walked question contributes its best option to the maximum,
    // answered or not. That is what makes a partial score honest: skipping a
    // question is not the same as it not existing.
    const best = question.options.reduce((top, option) => Math.max(top, option.weight), 0)
    maxScore += best

    const optionId = chosen.get(question.id)
    // An option id is only accepted from the question it actually belongs to.
    // Without this check a visitor could send any option's id for any question
    // and pick up its weight.
    const option: QuizOption | undefined = optionId
      ? question.options.find((candidate) => candidate.id === optionId)
      : undefined

    if (!option) {
      unanswered.push(question.id)
      continue
    }

    rawScore += option.weight
    if (option.profileId) votes.set(option.profileId, (votes.get(option.profileId) ?? 0) + 1)
  }

  const score = normalise(rawScore, maxScore)

  // Bands are inclusive at BOTH ends. An exclusive comparison at either end
  // drops a real score into no band at all, which is a result page with a hole
  // where the tier should be.
  const tier =
    definition.tiers
      .slice()
      .sort((a, b) => a.position - b.position)
      .find((candidate) => score >= candidate.minScore && score <= candidate.maxScore) ?? null

  const profiles = definition.profiles.slice().sort((a, b) => a.position - b.position)
  // Most votes wins; ties break by position, which is why the sort happens
  // before the reduce rather than inside the comparison.
  let winner = profiles.find((profile) => profile.position === 0) ?? profiles[0] ?? null
  let best = 0
  for (const profile of profiles) {
    const count = votes.get(profile.id) ?? 0
    if (count > best) {
      best = count
      winner = profile
    }
  }

  return {
    branchKey: definition.branches.find((branch) => branch.id === branchId)?.key ?? null,
    branchId,
    rawScore,
    maxScore,
    score,
    tierKey: tier?.key ?? null,
    profileKey: winner?.key ?? null,
    unanswered,
  }
}
