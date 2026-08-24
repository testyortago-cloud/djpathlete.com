// @vitest-environment node
// __tests__/lib/quizzes/seed-rpi.test.ts
//
// ZERO MOCKS. The seed is a typed module precisely so it can be run through
// the real gate and the real scorer here. A SQL seed could not be.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §6
import { describe, it, expect } from "vitest"
import { RPI_ATHLETE_QUIZ, SEED_MARKER, toDefinition } from "@/lib/quizzes/seed/rpi-athlete-quiz"
import { quizGate } from "@/lib/quizzes/gate"
import { scoreQuiz, walkedQuestions } from "@/lib/quizzes/score"
import type { QuizAnswer } from "@/lib/quizzes/types"

const DEF = toDefinition(RPI_ATHLETE_QUIZ)

/**
 * The router answer is supplied explicitly rather than picked by weight:
 * every router option carries weight 0, so "the best option" is meaningless
 * there, and it is the router answer that decides which branch is walked.
 */
function walkAnswers(branchKey: string, pick: "best" | "worst"): QuizAnswer[] {
  const router = DEF.questions.find((q) => q.id === "router")!
  const routerOption = router.options.find((o) => o.routesToBranchId === branchKey)!
  const answers: QuizAnswer[] = [{ questionId: router.id, optionId: routerOption.id }]

  for (const question of walkedQuestions(DEF, branchKey)) {
    if (question.id === router.id) continue
    const sorted = [...question.options].sort((a, b) => a.weight - b.weight)
    const chosen = pick === "best" ? sorted[sorted.length - 1] : sorted[0]
    answers.push({ questionId: question.id, optionId: chosen.id })
  }
  return answers
}

const BRANCHES = ["ceiling_breaker", "rebuilder", "aspiring_pro", "parent_coach"] as const

describe("the seeded RPI quiz", () => {
  it("1. passes its own activation gate", () => {
    const result = quizGate(DEF)
    // Asserted as [] rather than ok===false so a failure names the reason.
    expect(result.blockers).toEqual([])
    expect(result.ok).toBe(true)
  })

  it("1b. raises no warnings either", () => {
    expect(quizGate(DEF).warnings).toEqual([])
  })

  it("2. makes every branch reachable from the router", () => {
    const router = DEF.questions.find((q) => q.id === "router")!
    const routed = router.options.map((o) => o.routesToBranchId).sort()
    expect(routed).toEqual([...BRANCHES].sort())
  })

  it("3. covers 0..100 with tier bands that neither gap nor overlap", () => {
    const bands = [...DEF.tiers].sort((a, b) => a.minScore - b.minScore)
    expect(bands[0].minScore).toBe(0)
    expect(bands[bands.length - 1].maxScore).toBe(100)
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].minScore).toBe(bands[i - 1].maxScore + 1)
    }
  })

  it.each(BRANCHES)("4. a perfect walk of %s scores 100 and a worst walk scores 0", (branch) => {
    const best = scoreQuiz(DEF, walkAnswers(branch, "best"))
    const worst = scoreQuiz(DEF, walkAnswers(branch, "worst"))

    expect(best.branchKey).toBe(branch)
    expect(worst.branchKey).toBe(branch)
    // This is the assertion that catches a weight typo: a question whose
    // options do not reach the branch maximum drags the perfect walk below 100.
    expect(best.score).toBe(100)
    expect(worst.score).toBe(0)
    expect(best.unanswered).toEqual([])
    expect(best.tierKey).toBe("green")
    expect(worst.tierKey).toBe("red")
  })

  it.each(BRANCHES)("4b. %s has something to score — its maximum is not zero", (branch) => {
    // Without this, an all-segmentation branch would pass test 4 vacuously:
    // 0/0 normalises to 0, and "best === worst === 0" would look like a pass
    // for `worst` while silently making the branch unscoreable.
    expect(scoreQuiz(DEF, walkAnswers(branch, "best")).maxScore).toBeGreaterThan(0)
  })

  /**
   * WHY THIS EXISTS. Test 4's "a perfect walk scores 100" CANNOT FAIL: the
   * best walk picks each question's max-weight option, and `maxScore` is the
   * sum of those same max weights, so it is max/max by construction. Only its
   * "worst walk scores 0" half can go red.
   *
   * The property test 4 was meant to protect — a mistyped weight — needs the
   * ladder asserted directly. Every scoring question descends 3/2/1/0 in the
   * order listed, best first; every segmentation question is all-zero; and
   * `rb_recency` is the one documented exception.
   */
  it("4c. runs every scoring question down the 3/2/1/0 ladder, best first", () => {
    const EXCEPTIONS: Record<string, number[]> = { rb_recency: [0, 2, 1, 0] }
    const offenders: string[] = []

    for (const question of DEF.questions) {
      const weights = question.options.map((o) => o.weight)
      const expected = EXCEPTIONS[question.id]
      if (expected) {
        if (JSON.stringify(weights) !== JSON.stringify(expected)) {
          offenders.push(`${question.id}: ${JSON.stringify(weights)} != documented ${JSON.stringify(expected)}`)
        }
        continue
      }
      const allZero = weights.every((w) => w === 0)
      const ladder = JSON.stringify(weights) === JSON.stringify([3, 2, 1, 0])
      if (!allZero && !ladder) {
        offenders.push(`${question.id}: ${JSON.stringify(weights)} is neither all-zero nor 3/2/1/0`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("5. gives every question at least two options, each belonging to its question", () => {
    for (const question of DEF.questions) {
      expect(question.options.length).toBeGreaterThanOrEqual(2)
      for (const option of question.options) {
        expect(option.questionId).toBe(question.id)
      }
    }
  })

  it("6. carries exactly five profile votes, one per profile", () => {
    const votes = DEF.questions.flatMap((q) => q.options.map((o) => o.profileId)).filter(Boolean)
    expect(votes.sort()).toEqual([...DEF.profiles.map((p) => p.key)].sort())
  })

  it("6b. puts not_sure at position 0, so a no-signal answer set falls back to it", () => {
    expect(DEF.profiles.find((p) => p.position === 0)!.key).toBe("not_sure")
    const routerOnly = scoreQuiz(DEF, walkAnswers("ceiling_breaker", "best").slice(0, 1))
    expect(routerOnly.profileKey).toBe("not_sure")
  })

  it("7. is marked unverified, so the editor can show its banner", () => {
    expect(DEF.seedMarker).toBe(SEED_MARKER)
    expect(SEED_MARKER).toMatch(/reconstructed/)
  })

  it("8. carries neither corrected GHL typo — no label starts with a stray period", () => {
    for (const question of DEF.questions) {
      for (const option of question.options) {
        expect(option.label.startsWith(".")).toBe(false)
      }
    }
  })

  it("9. uses a unique key per question and per option", () => {
    const qKeys = DEF.questions.map((q) => q.id)
    expect(new Set(qKeys).size).toBe(qKeys.length)
    const oKeys = DEF.questions.flatMap((q) => q.options.map((o) => o.id))
    expect(new Set(oKeys).size).toBe(oKeys.length)
  })
})
