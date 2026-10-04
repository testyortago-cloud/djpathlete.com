// lib/quizzes/present-result.ts — the visitor-facing result, ONE copy.
//
// Both /api/quiz/submit and /api/quiz/preview-submit return this. The preview
// route used to build the same object by hand, which is how a preview starts
// disagreeing with the real thing. Carries no weight and no raw total; the
// map carries only the visitor's own points, after they submitted.

import { buildReport, type MapRow, type MirrorLine } from "@/lib/quizzes/report"
import type { QuizScoreResult } from "@/lib/quizzes/score"
import type { QuizAnswer, QuizDefinition } from "@/lib/quizzes/types"

export interface PresentedResult {
  score: number
  tier: { key: string; headline: string; body: string; ctaLabel: string | null; ctaHref: string | null } | null
  profile: { key: string; name: string; description: string } | null
  branch: { key: string; name: string } | null
  mirror: MirrorLine[]
  map: MapRow[]
}

export function presentResult(definition: QuizDefinition, result: QuizScoreResult, answers: QuizAnswer[]): PresentedResult {
  const tier = definition.tiers.find((candidate) => candidate.key === result.tierKey) ?? null
  const profile = definition.profiles.find((candidate) => candidate.key === result.profileKey) ?? null
  const branch = definition.branches.find((candidate) => candidate.key === result.branchKey) ?? null
  const { mirror, map } = buildReport(definition, answers, result.branchId)
  return {
    score: result.score,
    tier: tier
      ? { key: tier.key, headline: tier.headline, body: tier.body, ctaLabel: tier.ctaLabel, ctaHref: tier.ctaHref }
      : null,
    profile: profile ? { key: profile.key, name: profile.name, description: profile.description } : null,
    branch: branch ? { key: branch.key, name: branch.name } : null,
    mirror,
    map,
  }
}
