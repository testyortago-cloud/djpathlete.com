// lib/quizzes/gate.ts — the gate a quiz must pass before it can take an answer.
//
// THIS MODULE MUST IMPORT NOTHING BUT TYPES, the same contract as
// lib/quizzes/score.ts. Its tests run with zero mocks.
//
// A quiz cannot be set `active`, and a funnel cannot publish a block pointing
// at one, unless this returns ok. Every blocker below describes a quiz that
// would take a real visitor's answers and then fail them: sort them nowhere,
// ask them nothing, or hand them a result page with a hole where the tier
// should be. The gate exists so that failure happens in the editor, in front
// of the person who can fix it, rather than in front of a lead.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §2.2

import type { QuizDefinition, QuizQuestion } from "@/lib/quizzes/types"

export interface QuizGateResult {
  ok: boolean
  blockers: string[]
  warnings: string[]
}

/**
 * A router question is a shared question (branchId null) that actually routes.
 * Detecting it by shape rather than by a flag means the OTHER shared questions
 * — segmentation, the profile vote — are not mistaken for broken routers just
 * because their options route nowhere. That distinction is the whole reason
 * blocker 2 does not fire on every quiz.
 */
function routerQuestions(active: QuizQuestion[]): QuizQuestion[] {
  return active.filter(
    (question) => question.branchId === null && question.options.some((option) => option.routesToBranchId !== null),
  )
}

export function quizGate(definition: QuizDefinition): QuizGateResult {
  const blockers: string[] = []
  const warnings: string[] = []

  // Inactive questions are not walked, so they cannot satisfy a requirement
  // either. A branch whose only question is switched off is an empty branch.
  const active = definition.questions.filter((question) => question.isActive)
  const routers = routerQuestions(active)

  // 1. No router question.
  if (routers.length === 0) {
    blockers.push("There is no router question: no shared question routes to a branch.")
  }

  // 2. A router option that routes nowhere.
  for (const question of routers) {
    for (const option of question.options) {
      if (option.routesToBranchId === null) {
        blockers.push(`Router option "${option.label}" routes nowhere.`)
      }
    }
  }

  // 3. A branch no router option reaches — an archetype nobody can be sorted into.
  const reached = new Set(
    routers.flatMap((question) =>
      question.options.map((option) => option.routesToBranchId).filter((id): id is string => id !== null),
    ),
  )
  for (const branch of definition.branches) {
    if (!reached.has(branch.id)) {
      blockers.push(`Branch "${branch.key}" is unreachable: no router option routes to it.`)
    }
  }

  // 4. A branch with no questions.
  for (const branch of definition.branches) {
    if (!active.some((question) => question.branchId === branch.id)) {
      blockers.push(`Branch "${branch.key}" has no questions.`)
    }
  }

  // 5 & 6. Bands must cover 0..100 exactly — no gap, no overlap.
  //
  // A gap is a score with no tier, which is a result page with a hole in it.
  // An overlap is worse than ambiguous: `find` takes the first match, so which
  // tier a visitor gets silently depends on row order.
  const tiers = definition.tiers.slice().sort((a, b) => a.minScore - b.minScore)
  if (tiers.length === 0) {
    blockers.push("There are no tier bands, so no score can be given a tier: a gap over 0-100.")
  } else {
    if (tiers[0].minScore !== 0) {
      blockers.push(`Tier bands leave a gap: they start at ${tiers[0].minScore}, not 0.`)
    }
    const last = tiers[tiers.length - 1]
    if (last.maxScore !== 100) {
      blockers.push(`Tier bands leave a gap: they reach ${last.maxScore}, not 100.`)
    }
    for (const tier of tiers) {
      if (tier.minScore > tier.maxScore) {
        blockers.push(`Tier "${tier.key}" is inverted: ${tier.minScore} is above ${tier.maxScore}.`)
      }
    }
    for (let i = 1; i < tiers.length; i++) {
      const previous = tiers[i - 1]
      const current = tiers[i]
      if (current.minScore <= previous.maxScore) {
        blockers.push(`Tier bands overlap: "${previous.key}" ends at ${previous.maxScore} and "${current.key}" starts at ${current.minScore}.`)
      } else if (current.minScore > previous.maxScore + 1) {
        blockers.push(`Tier bands leave a gap between ${previous.maxScore} and ${current.minScore}.`)
      }
    }
  }

  // 7. An option voting for a profile that is not on this quiz.
  const profileIds = new Set(definition.profiles.map((profile) => profile.id))
  for (const question of active) {
    for (const option of question.options) {
      if (option.profileId !== null && !profileIds.has(option.profileId)) {
        blockers.push(`Option "${option.label}" votes for a profile on another quiz.`)
      }
    }
  }

  // 8. Fewer than two options is not a question, it is a statement.
  for (const question of active) {
    if (question.options.length < 2) {
      blockers.push(`Question "${question.prompt}" has fewer than two options.`)
    }
  }

  // WARNING: identical AND NON-ZERO weights. Such a question cannot change the
  // percentage but does inflate both halves of it, which is almost always a
  // mistake. ALL-ZERO is excluded deliberately: it is the documented way to
  // mark a question as segmentation-only, and warning about it would train
  // the operator to ignore this list.
  for (const question of active) {
    if (question.options.length < 2) continue
    const weights = question.options.map((option) => option.weight)
    const [first] = weights
    if (first !== 0 && weights.every((weight) => weight === first)) {
      warnings.push(`Every option on "${question.prompt}" carries the same weight (${first}), so it cannot change the score.`)
    }
  }

  // WARNING: a profile nothing votes for can never be elected, except as the
  // position-0 no-vote fallback.
  const voted = new Set(
    active.flatMap((question) => question.options.map((option) => option.profileId).filter((id): id is string => id !== null)),
  )
  for (const profile of definition.profiles) {
    if (!voted.has(profile.id)) {
      warnings.push(`No option votes for profile "${profile.key}".`)
    }
  }

  return { ok: blockers.length === 0, blockers, warnings }
}
