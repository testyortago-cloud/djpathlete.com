// lib/quizzes/answer-payload.ts -- a completed quiz as a readable transcript.
//
// THIS MODULE IMPORTS NOTHING BUT TYPES, the same contract as
// `lib/quizzes/score.ts` and `lib/quizzes/gate.ts`. Its tests run with no mocks.
//
// WHY THE SCORE IS NOT IN HERE. This becomes `funnel_submissions.payload`,
// which migration 00204 defines as "the VISITOR's answers, verbatim, as they
// typed them" -- its comment goes on to say that mixing our own state into it
// means the record of what someone said stops being a record of what someone
// said. The score, the tier and the archetype are OURS: they live on the
// attempt row, which the lead points at through `quiz_attempt_id`.

import type { QuizDefinition } from "@/lib/quizzes/types"

/**
 * `{ question prompt: chosen option label }`, in the order the quiz asks.
 *
 * TWO QUESTIONS MAY SHARE A PROMPT -- the same words asked of two archetypes
 * is the ordinary case -- and a bare `Record` would keep only the last of
 * them. A repeat is suffixed ` (2)`, which is visible in the inbox, sorts
 * beside its twin, and loses nothing.
 *
 * An answer naming a question or an option this quiz does not have is dropped,
 * exactly as `sanitiseAnswers` drops it before scoring: the two have to agree
 * about what was answered, or the transcript would show a line the score did
 * not count.
 */
export function quizAnswerPayload(
  definition: QuizDefinition,
  answers: { questionId: string; optionId: string }[],
): Record<string, string> {
  const chosen = new Map(answers.map((answer) => [answer.questionId, answer.optionId]))
  const payload: Record<string, string> = {}
  const used = new Map<string, number>()

  const ordered = definition.questions.slice().sort((a, b) => a.position - b.position)
  for (const question of ordered) {
    // ONE GUARD, NOT TWO. An unanswered question and an answer naming an
    // option this question does not have both end here: `find` on an
    // `undefined` id matches nothing. A separate `if (!optionId) continue`
    // above read as defensive and was untestable -- either guard alone made
    // the whole function behave identically, so neither was pinned.
    const option = question.options.find((candidate) => candidate.id === chosen.get(question.id))
    if (!option) continue

    const seen = (used.get(question.prompt) ?? 0) + 1
    used.set(question.prompt, seen)
    payload[seen === 1 ? question.prompt : `${question.prompt} (${seen})`] = option.label
  }

  return payload
}
