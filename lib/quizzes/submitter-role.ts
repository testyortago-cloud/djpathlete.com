// lib/quizzes/submitter-role.ts — who filled a quiz in, when the quiz asked
// (G10).
//
// ONLY WHEN THE QUIZ ASKED. There is more than one seeded quiz. The Athlete
// Quiz opens with a router question — "Which describes you best?" — whose
// three athlete answers begin "I'm an athlete" and whose fourth routes to a
// branch meaning "I'm a parent or coach looking for the right system for an
// athlete". The Rotational Performance Index
// (lib/quizzes/seed/rotational-performance-index.ts) asks nothing of the kind:
// its branches are SPORTS (`racquet`, `golf`, `throwing`, …).
//
// So "the branch is not the parent one, therefore an athlete" is only true of
// a quiz that HAS the parent branch. Applied to the other quiz it is not a
// default, it is a false statement about a real person: a mother taking the
// Rotational Performance Index for her 14-year-old would be recorded
// `role: "athlete"`, and a coach's "write to the grown-up" branch would send
// her the athlete-voiced email. `null` — record nothing — is the honest
// answer there, and it makes `enrolled_metadata_is role=parent` false rather
// than wrong. Same rule as `pickEnrolmentMetadata`: a value we cannot stand
// behind is ABSENT, never guessed.

/**
 * The branch key whose answer is NOT the athlete themselves.
 *
 * Declared HERE rather than in the seed so the dependency runs the safe way
 * round: `lib/quizzes/seed/rpi-athlete-quiz.ts` imports this constant to key
 * its own branch, so the two cannot drift, and the submit route can read it
 * without pulling a large seed module into its bundle.
 * `__tests__/lib/quizzes/submitter-role.test.ts` pins that the seed still
 * carries a branch with this key — the constant is otherwise a string that
 * matches nothing the day someone renames the branch.
 */
export const QUIZ_NOT_THE_ATHLETE_BRANCH = "parent_coach"

/**
 * `parent` when this taker said they are filling it in for someone else,
 * `athlete` when they said it is for themselves, and `null` when THIS QUIZ
 * never asked — see the header.
 *
 * "PARENT" IS THE NEARER OF TWO WORDS, NOT AN EXACT ONE. The question offers
 * "a parent or coach" as one answer, so a coach is recorded as `parent`. What
 * this really separates is the athlete themselves from anyone acting on an
 * athlete's behalf, which is the distinction the copy needs and the finest
 * one the quiz's own data supports. The step editor says so in words next to
 * the field, rather than leaving a coach to infer it.
 */
export function quizSubmitterRole(
  branchKeys: readonly string[],
  branchKey: string | null,
): "parent" | "athlete" | null {
  // This quiz never asked.
  if (!branchKeys.includes(QUIZ_NOT_THE_ATHLETE_BRANCH)) return null
  // It asked, and this taker reached no branch — so they did not answer it.
  // `athlete` here would be the same false statement as above, only narrower:
  // silence is not "I am the athlete".
  if (branchKey === null) return null
  return branchKey === QUIZ_NOT_THE_ATHLETE_BRANCH ? "parent" : "athlete"
}
