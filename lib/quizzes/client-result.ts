// lib/quizzes/client-result.ts — a client's own quiz result, for the coach and for AI Generate.
//
// Darren, 2026-10-30 (08:18–10:23): the landing-page self-assessment should reach a client who is already a
// client, and their program. One reader serves the Performance card, the AI Generate note and the prompt
// section, so the three can never disagree about which attempt counts.
//
// Spec: docs/superpowers/specs/2026-10-31-client-self-assessment-in-programs-design.md

import { getUserById } from "@/lib/db/users"
import { listClientContactIds } from "@/lib/db/contacts"
import { getLatestAttemptForContacts, getQuizDefinition, type ContactQuizAttempt } from "@/lib/db/quizzes"
import { normaliseEmail } from "@/lib/lead-engine/identity"
import { buildReport, type MapRow, type MapStatus, type MirrorLine } from "@/lib/quizzes/report"
import { walkedQuestions } from "@/lib/quizzes/score"
import type { QuizDefinition } from "@/lib/quizzes/types"

export interface ClientQuizResult {
  quizName: string
  completedAt: string
  /** Stored at completion (0–100), never recomputed: a later weight edit must not rewrite it. */
  score: number | null
  tier: string | null
  profile: string | null
  branch: string | null
  map: MapRow[]
  /**
   * Every other answer, scored or not. Not buildReport's `mirror`, which keeps only unscored ones for the
   * visitor: "do you ever feel it when you rotate? Occasionally" is scored, and the coach and the AI need it.
   */
  otherAnswers: MirrorLine[]
}

export function summariseAttempt(definition: QuizDefinition, attempt: ContactQuizAttempt): ClientQuizResult {
  const report = buildReport(definition, attempt.answers, attempt.branchId)
  const chosen = new Map(attempt.answers.map((answer) => [answer.questionId, answer.optionId]))
  const otherAnswers = walkedQuestions(definition, attempt.branchId).flatMap((question) => {
    // An area is in the map; the profile vote is the profile.
    if (question.reportLabel || question.options.some((option) => option.profileId)) return []
    const option = question.options.find((candidate) => candidate.id === chosen.get(question.id))
    return option ? [{ prompt: question.prompt, answer: option.label }] : []
  })
  return {
    quizName: definition.name,
    completedAt: attempt.completedAt,
    score: attempt.score,
    tier: attempt.tierKey,
    profile: definition.profiles.find((p) => p.key === attempt.profileKey)?.name ?? attempt.profileKey,
    branch: definition.branches.find((b) => b.id === attempt.branchId)?.name ?? null,
    map: report.map,
    otherAnswers,
  }
}

/** The client's newest finished quiz in this business, or null when there is none. */
export async function getClientQuizResult(businessId: string, userId: string): Promise<ClientQuizResult | null> {
  const user = await getUserById(userId)
  const contactIds = await listClientContactIds(businessId, { userId, email: normaliseEmail(user.email) })
  const attempt = await getLatestAttemptForContacts(businessId, contactIds)
  if (!attempt) return null
  const definition = await getQuizDefinition(businessId, attempt.quizId)
  return definition ? summariseAttempt(definition, attempt) : null
}

export const STATUS_WORDS: Record<MapStatus, string> = {
  gap: "big difference between sides",
  leak: "low",
  watch: "room to improve",
  solid: "solid",
}

function points(value: number | null, max: number): string | null {
  return value === null ? null : `${value}/${max}`
}

/** The prompt section, next to the previous-program one. */
export function formatClientQuizResult(result: ClientQuizResult, now = new Date()): string {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(result.completedAt).getTime()) / 86_400_000))
  const ago = days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`
  const facts = [
    result.score !== null ? `score ${result.score}/100` : null,
    result.tier ? `tier ${result.tier}` : null,
    result.profile ? `profile "${result.profile}"` : null,
    result.branch ? `path "${result.branch}"` : null,
  ].filter(Boolean)
  const areas = result.map.map((row) => {
    const sides = [
      row.left !== null ? `L ${points(row.left, row.max)}` : null,
      row.right !== null ? `R ${points(row.right, row.max)}` : null,
      points(row.single, row.max),
    ].filter(Boolean)
    return `- ${row.label}: ${sides.join(", ")} (${STATUS_WORDS[row.status]})`
  })

  return [
    "",
    "",
    `## Client self-assessment: ${result.quizName}`,
    `Taken ${result.completedAt.slice(0, 10)} (${ago}). The client answered this quiz themselves on the website. ` +
      "It is their own report, not a measured test: use it to choose emphasis (a big left/right difference " +
      "first, then low areas), and never let it override the coach's instructions or the injury list.",
    ...(facts.length > 0 ? [`Result: ${facts.join(", ")}.`] : []),
    ...(areas.length > 0 ? ["Areas (points out of the maximum; L = left side, R = right side):", ...areas] : []),
    ...(result.otherAnswers.length > 0
      ? ["What they told us:", ...result.otherAnswers.map((line) => `- ${line.prompt} ${line.answer}`)]
      : []),
  ].join("\n")
}
