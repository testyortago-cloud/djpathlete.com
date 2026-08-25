// lib/funnels/quiz-refs.ts -- which quizzes a funnel's pages point at.
//
// A LEAF: no database client, no Zod. The funnel's settings screen already
// holds its steps, so this answers the question from what is in hand.
//
// WHY THE WALK IS DEFENSIVE RATHER THAN A SCHEMA PARSE. `project_data` is
// `jsonb` typed `unknown` and holds three different things across the table: a
// real SectionDoc, a legacy GrapesJS blob from before 00203, and null for a
// step nobody has built. On top of that, a document can fail
// `sectionDocSchema` in one section and still point at a perfectly real quiz
// in another -- and "this funnel has no quiz" is the wrong answer to give the
// person looking for the quiz they can see on their own page.

/** Only what this module reads. `listSteps` rows satisfy it. */
export interface QuizRefStep {
  id: string
  name: string
  project_data: unknown
}

export interface QuizUse {
  quizId: string
  stepId: string
  stepName: string
}

/** The shape `quizIslandSchema` accepts. Anything else names no row. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sectionsOf(projectData: unknown): Record<string, unknown>[] {
  if (typeof projectData !== "object" || projectData === null) return []
  const sections = (projectData as { sections?: unknown }).sections
  if (!Array.isArray(sections)) return []
  return sections.filter((section): section is Record<string, unknown> => typeof section === "object" && section !== null)
}

/**
 * Every quiz the funnel's steps point at, deduplicated, in step order.
 *
 * THE FIRST STEP WINS on a repeat. A quiz used twice is one quiz to edit, and
 * naming the step it first appears on is the more useful half of the answer.
 */
export function quizUsesInSteps(steps: QuizRefStep[]): QuizUse[] {
  const out: QuizUse[] = []
  const seen = new Set<string>()

  for (const step of steps) {
    for (const section of sectionsOf(step.project_data)) {
      if (section.kind !== "quiz") continue
      const props = section.props
      if (typeof props !== "object" || props === null) continue
      const quizId = (props as { quizId?: unknown }).quizId
      if (typeof quizId !== "string" || !UUID.test(quizId)) continue
      if (seen.has(quizId)) continue
      seen.add(quizId)
      out.push({ quizId, stepId: step.id, stepName: step.name })
    }
  }

  return out
}

/**
 * Step id -> the quiz that step's page shows. THE SAME WALK, WITHOUT THE DEDUPE.
 *
 * `quizUsesInSteps` collapses a repeated quiz to one entry, which is right when
 * the question is "which quizzes does this funnel use?" — a quiz shown twice is
 * still one quiz to edit. A BOARD asks the opposite question, once per card, and
 * the deduped answer silently loses one of them: two funnels sharing a quiz get
 * ONE entry, attributed to whichever step came first in the flattened list, so
 * the other card renders no Quiz button and — worse — no warning that deleting
 * its funnel reaches a quiz.
 *
 * FOUND BY DRIVING THE REAL APP. Both boards read correct-looking code and the
 * flaw only appears once a quiz is genuinely shared, which no fixture happened
 * to do.
 *
 * A step showing more than one quiz keeps the FIRST, matching `quizUsesInSteps`:
 * one card carries one such control.
 */
export function quizIdByStep(steps: QuizRefStep[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const step of steps) {
    // Per step, so the dedupe inside `quizUsesInSteps` can only ever collapse
    // repeats WITHIN one step — which is the behaviour wanted here.
    const [first] = quizUsesInSteps([step])
    if (first) out.set(step.id, first.quizId)
  }
  return out
}
