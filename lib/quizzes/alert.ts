// lib/quizzes/alert.ts — who gets told about a quiz result, and whether they
// actually were.
//
// RED AND ORANGE ONLY. Higher scores are better, so those two are the results
// that mean "large or real gaps". Alerting on Green would train the operator
// to ignore the alert, which is the same as not sending it.
//
// THE DIFFERENCE BETWEEN SENDING AND NOT THROWING is the whole point of this
// module. `lib/email.ts` has 38 sender call sites: 20 throw on a failed send,
// 14 only log it, and 4 discard the result entirely. A caller of one of the 20
// can tell delivery failed, by catching; a caller of the other 18 cannot. This
// one returns the mailer's own `delivered` flag instead, and the caller writes
// it onto the attempt. An attempt marked `sent` when nothing left the building
// is worse than one marked `failed`: nobody goes looking for it.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §5.4

import { sendQuizAlertEmail } from "@/lib/email"
import type { QuizDefinition } from "@/lib/quizzes/types"

/** The tiers worth interrupting someone's day for. */
const ALERTING_TIERS = new Set(["red", "orange"])

export function shouldAlert(tierKey: string | null): boolean {
  return tierKey !== null && ALERTING_TIERS.has(tierKey)
}

export interface QuizAlertInput {
  /**
   * WHOSE lead this is. The alert goes to this business's own `reply_to` and
   * carries their identity -- resolved inside `sendQuizAlertEmail`, not here,
   * so there is one place that decides which column addresses the coach.
   */
  businessId: string
  definition: QuizDefinition
  attemptId: string
  name: string
  email: string
  phone?: string | null
  score: number
  tierKey: string | null
  profileKey: string | null
  branchKey: string | null
}

export async function sendQuizAlert(input: QuizAlertInput): Promise<{ delivered: boolean }> {
  if (!shouldAlert(input.tierKey)) return { delivered: false }

  const tier = input.definition.tiers.find((candidate) => candidate.key === input.tierKey)
  const branch = input.definition.branches.find((candidate) => candidate.key === input.branchKey)
  const profile = input.definition.profiles.find((candidate) => candidate.key === input.profileKey)

  return sendQuizAlertEmail({
    businessId: input.businessId,
    name: input.name,
    email: input.email,
    phone: input.phone ?? null,
    score: input.score,
    tierKey: input.tierKey ?? "unknown",
    tierHeadline: tier?.headline ?? "",
    branchName: branch?.name ?? null,
    profileName: profile?.name ?? null,
    attemptId: input.attemptId,
  })
}
