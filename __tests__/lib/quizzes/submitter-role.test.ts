// @vitest-environment node
//
// G10. `role` for a quiz lead, and the reason it is not simply "not the
// parent branch, therefore an athlete": there is more than one seeded quiz,
// and only one of them asks.
import { describe, it, expect } from "vitest"
import { quizSubmitterRole, QUIZ_NOT_THE_ATHLETE_BRANCH } from "@/lib/quizzes/submitter-role"
import { RPI_ATHLETE_QUIZ } from "@/lib/quizzes/seed/rpi-athlete-quiz"
import { ROTATIONAL_PERFORMANCE_INDEX } from "@/lib/quizzes/seed/rotational-performance-index"

const RPI_BRANCH_KEYS = RPI_ATHLETE_QUIZ.branches.map((b) => b.key)
const ROTATIONAL_BRANCH_KEYS = ROTATIONAL_PERFORMANCE_INDEX.branches.map((b) => b.key)

describe("quizSubmitterRole", () => {
  it("the Athlete Quiz still HAS the branch the constant names", () => {
    // The constant is a plain string. Without this, renaming the branch in
    // the seed leaves it matching nothing, and every taker of the quiz that
    // does ask silently becomes `athlete` — the exact failure its own
    // docstring warns about, with nothing to catch it.
    expect(RPI_BRANCH_KEYS).toContain(QUIZ_NOT_THE_ATHLETE_BRANCH)
  })

  it("answers parent when the taker chose the parent-or-coach branch", () => {
    expect(quizSubmitterRole(RPI_BRANCH_KEYS, QUIZ_NOT_THE_ATHLETE_BRANCH)).toBe("parent")
  })

  it("answers athlete for the quiz's other branches, which all say 'I'm an athlete'", () => {
    for (const key of RPI_BRANCH_KEYS.filter((k) => k !== QUIZ_NOT_THE_ATHLETE_BRANCH)) {
      expect(quizSubmitterRole(RPI_BRANCH_KEYS, key), `branch ${key}`).toBe("athlete")
    }
  })

  it("answers NULL for a quiz that never asked, rather than asserting 'athlete' about someone", () => {
    // The Rotational Performance Index branches on SPORT. A parent taking it
    // for their child said nothing about who they are; recording
    // `role: "athlete"` would be a false statement that a coach's
    // "write to the grown-up" branch would then act on.
    expect(ROTATIONAL_BRANCH_KEYS).not.toContain(QUIZ_NOT_THE_ATHLETE_BRANCH) // the control
    for (const key of ROTATIONAL_BRANCH_KEYS) {
      expect(quizSubmitterRole(ROTATIONAL_BRANCH_KEYS, key), `branch ${key}`).toBeNull()
    }
  })

  it("answers null on a quiz that DOES ask when the taker reached no branch", () => {
    // `branchKey` is nullable on the scoring result. Silence is not "I am the
    // athlete" — recording one here would be the same false statement as the
    // cross-quiz case above, only narrower.
    expect(quizSubmitterRole(RPI_BRANCH_KEYS, null)).toBeNull()
  })

  it("answers null when the quiz has no branches at all", () => {
    expect(quizSubmitterRole([], "anything")).toBeNull()
  })
})
