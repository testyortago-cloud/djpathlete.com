import { describe, it, expect } from "vitest"
import { statesExerciseCount } from "../instruction-count.js"

/**
 * 2026-10-01, Chris H: "using the exercise pool / 2-4 sets / 4-8 reps / 30-90 sec rest / 4-2-4 tempo"
 * planned a 2-slot Monday. The day directive told the architect the instructions set the count
 * whenever ANY instructions existed, so it took one from "2-4 sets". The directive now asks this
 * function whether the coach actually stated a count.
 */
describe("statesExerciseCount", () => {
  it.each([
    "12 exercises\n2-4 sets\n4-8 reps",
    "12 exercises that are shoulder focused",
    "12 exercises total",
    "• 12 exercises total",
    "HINGE BLOCK (3 exercises):",
    "3 hinge-focused primary_compound movements",
    "2 power exercises",
    "10-12 exercises",
    "1 exercise only",
    "8 movements, mostly lower body",
  ])("reads a count in %j", (text) => {
    expect(statesExerciseCount(text)).toBe(true)
  })

  it.each([
    // The reported run, verbatim.
    "using the exercise pool\n2-4 sets\n4-8 reps\n30-90 sec rest\n4-2-4 tempo",
    "strict use of the exercise pool\n2-4 sets\n4-8 reps\n30-90sec rest\n4-2-4 tempo",
    // A number on one line must not pair with "exercises" on the next.
    "2-4 sets\n4-8 reps\n30-90sec rest\n4-2-4 tempo\nFocus on shoulder exercises",
    "3 sets per exercise",
    "4 x 8 each exercise",
    "rest 90 seconds between exercises",
    "Limit eccentric-heavy exercises to 2 per session",
    "",
  ])("finds no count in %j", (text) => {
    expect(statesExerciseCount(text)).toBe(false)
  })

  it("treats missing instructions as no count", () => {
    expect(statesExerciseCount(undefined)).toBe(false)
  })
})
