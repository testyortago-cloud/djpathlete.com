// @vitest-environment node
// G47: the platform's own result-band buttons moved out of the built-in quiz
// (which any business can clone) and into the script that seeds only this
// platform's quiz. These pin that the script now writes them, one per band.
import { describe, expect, it } from "vitest"
import { PLATFORM_TIER_CTAS, platformQuiz, platformTierRows } from "@/scripts/seed-athlete-quiz"
import { RPI_ATHLETE_QUIZ, toDefinition } from "@/lib/quizzes/seed/rpi-athlete-quiz"
import { quizGate } from "@/lib/quizzes/gate"

describe("scripts/seed-athlete-quiz.ts tier rows", () => {
  it("writes this platform's button on every band of its own quiz", () => {
    const rows = platformTierRows(RPI_ATHLETE_QUIZ)
    expect(rows.map((r) => [r.key, r.cta_label, r.cta_href])).toEqual([
      ["red", "Book a call with Darren", "/contact"],
      ["orange", "Book a call with Darren", "/contact"],
      ["yellow", "See the training options", "/online"],
      ["green", "See what an assessment covers", "/assessment"],
    ])
  })

  it("keeps the band itself from the seed module", () => {
    const [red] = platformTierRows(RPI_ATHLETE_QUIZ)
    const seedRed = RPI_ATHLETE_QUIZ.tiers[0]
    expect(red).toMatchObject({
      key: "red",
      position: seedRed.position,
      min_score: seedRed.minScore,
      max_score: seedRed.maxScore,
      headline: seedRed.headline,
      body: seedRed.body,
    })
  })

  it("refuses a band it has no button for, rather than seeding a dead end", () => {
    const quiz = { ...RPI_ATHLETE_QUIZ, tiers: [...RPI_ATHLETE_QUIZ.tiers, { ...RPI_ATHLETE_QUIZ.tiers[0], key: "violet" }] }
    expect(() => platformTierRows(quiz)).toThrow(/no platform button for tier "violet"/)
  })

  it("gates what it writes: with this platform's buttons the quiz raises no warning", () => {
    expect(quizGate(toDefinition(platformQuiz(RPI_ATHLETE_QUIZ))).warnings).toEqual([])
  })

  it("has a button for exactly the seed's bands", () => {
    expect(Object.keys(PLATFORM_TIER_CTAS).sort()).toEqual(RPI_ATHLETE_QUIZ.tiers.map((t) => t.key).sort())
  })
})
