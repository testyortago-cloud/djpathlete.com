// lib/quizzes/sources.ts — the vocabulary of "copy questions from".
//
// A LEAF SHARED BY THE DIALOG AND THE VALIDATOR, for the reason
// `lib/funnels/templates.ts` gives for being a const rather than a
// `funnel_templates` table: the dialog must not be able to offer a source the
// server refuses. One statement, read by both.
//
// THE BUILT-IN IS A SENTINEL, NOT A UUID, because it is not a row — it is
// `RPI_ATHLETE_QUIZ` in `lib/quizzes/seed/rpi-athlete-quiz.ts`, a typed module
// that exists so the seed can be run through `quizGate` in CI. Offering it as
// a source means a quiz funnel can be created on a database holding no quizzes
// at all, which is every database before the seed script has been run. Without
// it, "Run a quiz" is a template that cannot be used until somebody runs a
// script from a terminal.
//
// NO IMPORTS. The create dialog is a client component and imports this
// directly; pulling in the blueprint itself would ship 539 lines of quiz copy
// to the browser to obtain two strings.
//
// Spec: docs/superpowers/specs/2026-08-24-quiz-funnel-creator-design.md §2

export const BUILTIN_QUIZ_SOURCE = "builtin:rpi"

/** What the picker calls it. Says "the original" because a copy is what this makes. */
export const BUILTIN_QUIZ_LABEL = "Athlete Quiz — the original"

export function isBuiltinQuizSource(value: string): boolean {
  return value === BUILTIN_QUIZ_SOURCE
}
