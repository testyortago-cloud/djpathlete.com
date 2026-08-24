// @vitest-environment node
// __tests__/lib/quizzes/score.test.ts
//
// ZERO MOCKS. `lib/quizzes/score.ts` imports nothing but types, the same
// contract as lib/lead-engine/pipeline-move.ts and lib/automation/
// sequence-tick.ts. Every fixture below is a plain object.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §4.4
import { describe, it, expect } from "vitest"
import { sanitiseAnswers, scoreQuiz, walkedQuestions } from "@/lib/quizzes/score"
import type { QuizDefinition, QuizOption, QuizQuestion } from "@/lib/quizzes/types"

function option(id: string, questionId: string, position: number, extra: Partial<QuizOption> = {}): QuizOption {
  return {
    id,
    questionId,
    position,
    label: id,
    weight: 0,
    routesToBranchId: null,
    profileId: null,
    ...extra,
  }
}

function question(id: string, position: number, branchId: string | null, options: QuizOption[]): QuizQuestion {
  return { id, quizId: "q", branchId, position, prompt: id, helpText: null, isActive: true, options }
}

/**
 * Router at 10, a shared segmentation question at 20, one question per branch
 * at 50, and a shared closer at 90. `alpha` has ONE scoring question, `beta`
 * has TWO — the asymmetry that makes the normalisation testable.
 */
const DEF: QuizDefinition = {
  id: "q",
  key: "k",
  name: "n",
  status: "active",
  introHeadline: "",
  introBody: "",
  gateHeadline: "",
  gateBody: "",
  resultHeadline: "",
  seedMarker: null,
  branches: [
    { id: "A", quizId: "q", key: "alpha", name: "Alpha", description: null, position: 1 },
    { id: "B", quizId: "q", key: "beta", name: "Beta", description: null, position: 2 },
  ],
  profiles: [
    { id: "pf0", quizId: "q", key: "unsure", name: "Unsure", description: "", position: 0 },
    { id: "pf1", quizId: "q", key: "tight", name: "Tight", description: "", position: 1 },
    { id: "pf2", quizId: "q", key: "weak", name: "Weak", description: "", position: 2 },
  ],
  tiers: [
    { id: "t1", quizId: "q", key: "red", position: 1, minScore: 0, maxScore: 39, headline: "", body: "", ctaLabel: null, ctaHref: null },
    { id: "t2", quizId: "q", key: "orange", position: 2, minScore: 40, maxScore: 59, headline: "", body: "", ctaLabel: null, ctaHref: null },
    { id: "t3", quizId: "q", key: "yellow", position: 3, minScore: 60, maxScore: 79, headline: "", body: "", ctaLabel: null, ctaHref: null },
    { id: "t4", quizId: "q", key: "green", position: 4, minScore: 80, maxScore: 100, headline: "", body: "", ctaLabel: null, ctaHref: null },
  ],
  questions: [
    question("router", 10, null, [
      option("r-a", "router", 1, { routesToBranchId: "A" }),
      option("r-b", "router", 2, { routesToBranchId: "B" }),
    ]),
    // Segmentation: all weights zero, so it can move neither half of the ratio.
    question("where", 20, null, [option("w1", "where", 1), option("w2", "where", 2)]),
    question("a1", 50, "A", [
      option("a1-best", "a1", 1, { weight: 3 }),
      option("a1-worst", "a1", 2, { weight: 0 }),
    ]),
    question("b1", 50, "B", [
      option("b1-best", "b1", 1, { weight: 3 }),
      option("b1-worst", "b1", 2, { weight: 0 }),
    ]),
    question("b2", 60, "B", [
      option("b2-best", "b2", 1, { weight: 3 }),
      option("b2-mid", "b2", 2, { weight: 2 }),
      option("b2-worst", "b2", 3, { weight: 0 }),
    ]),
    // The profile question: votes, no weight.
    question("profile", 80, null, [
      option("pf-tight", "profile", 1, { profileId: "pf1" }),
      option("pf-weak", "profile", 2, { profileId: "pf2" }),
    ]),
  ],
}

describe("walkedQuestions", () => {
  it("asks the shared questions plus only the chosen branch's own", () => {
    const ids = walkedQuestions(DEF, "A").map((q) => q.id)
    expect(ids).toEqual(["router", "where", "a1", "profile"])
    expect(ids).not.toContain("b1")
  })

  it("orders by global position, interleaving shared and branch questions", () => {
    // Proves position is global, not per branch: `where` (20) precedes `b1`
    // (50) which precedes `b2` (60) which precedes `profile` (80).
    expect(walkedQuestions(DEF, "B").map((q) => q.id)).toEqual(["router", "where", "b1", "b2", "profile"])
  })

  it("asks only the shared questions before the router has been answered", () => {
    expect(walkedQuestions(DEF, null).map((q) => q.id)).toEqual(["router", "where", "profile"])
  })
})

describe("scoreQuiz", () => {
  it("reads the branch from the router option, not from the caller", () => {
    const result = scoreQuiz(DEF, [{ questionId: "router", optionId: "r-b" }])
    expect(result.branchKey).toBe("beta")
  })

  it("normalises to 0..100 against the walked branch's own maximum", () => {
    // Alpha: one scoring question worth 3. Beta: two, worth 3 and 3.
    // Both answer everything at the best option, so both must be 100 — a raw
    // total would give 3 and 6 and make Green mean two different things.
    const alpha = scoreQuiz(DEF, [
      { questionId: "router", optionId: "r-a" },
      { questionId: "a1", optionId: "a1-best" },
    ])
    const beta = scoreQuiz(DEF, [
      { questionId: "router", optionId: "r-b" },
      { questionId: "b1", optionId: "b1-best" },
      { questionId: "b2", optionId: "b2-best" },
    ])
    expect(alpha.score).toBe(100)
    expect(beta.score).toBe(100)
    expect(alpha.maxScore).toBe(3)
    expect(beta.maxScore).toBe(6)
  })

  it("lets a segmentation question move neither the raw total nor the maximum", () => {
    const withAnswer = scoreQuiz(DEF, [
      { questionId: "router", optionId: "r-a" },
      { questionId: "where", optionId: "w1" },
      { questionId: "a1", optionId: "a1-best" },
    ])
    expect(withAnswer.maxScore).toBe(3)
    expect(withAnswer.score).toBe(100)
  })

  it("does not divide by zero when every weight on the walk is zero", () => {
    const allZero: QuizDefinition = {
      ...DEF,
      questions: DEF.questions.filter((q) => q.id === "router" || q.id === "where"),
    }
    const result = scoreQuiz(allZero, [{ questionId: "router", optionId: "r-a" }])
    expect(result.maxScore).toBe(0)
    expect(result.score).toBe(0)
    expect(Number.isNaN(result.score)).toBe(false)
    expect(result.tierKey).toBe("red")
  })

  it("ignores an answer to a question outside the walked branch", () => {
    const result = scoreQuiz(DEF, [
      { questionId: "router", optionId: "r-a" },
      { questionId: "a1", optionId: "a1-worst" },
      // Beta's question, answered at its best. Must contribute nothing.
      { questionId: "b1", optionId: "b1-best" },
    ])
    expect(result.rawScore).toBe(0)
    expect(result.maxScore).toBe(3)
  })

  it("ignores an option that does not belong to the question it was sent for", () => {
    const result = scoreQuiz(DEF, [
      { questionId: "router", optionId: "r-a" },
      { questionId: "a1", optionId: "b2-best" },
    ])
    expect(result.rawScore).toBe(0)
    expect(result.unanswered).toContain("a1")
  })

  it("counts a duplicated answer once, taking the last", () => {
    const result = scoreQuiz(DEF, [
      { questionId: "router", optionId: "r-a" },
      { questionId: "a1", optionId: "a1-best" },
      { questionId: "a1", optionId: "a1-worst" },
    ])
    expect(result.rawScore).toBe(0)
    expect(result.maxScore).toBe(3)
  })

  it("puts a score exactly on a band edge inside that band, at both ends", () => {
    // 40 is orange's minimum, 59 its maximum. An exclusive comparison at
    // either end drops a real score into no band at all.
    const edges: [number, string][] = [
      [0, "red"],
      [39, "red"],
      [40, "orange"],
      [59, "orange"],
      [60, "yellow"],
      [100, "green"],
    ]
    for (const [score, expected] of edges) {
      const def: QuizDefinition = {
        ...DEF,
        questions: [
          question("router", 10, null, [option("r-a", "router", 1, { routesToBranchId: "A" })]),
          question("only", 50, "A", [
            option("hit", "only", 1, { weight: score }),
            option("top", "only", 2, { weight: 100 }),
          ]),
        ],
      }
      const result = scoreQuiz(def, [
        { questionId: "router", optionId: "r-a" },
        { questionId: "only", optionId: "hit" },
      ])
      expect(result.score, `score ${score}`).toBe(score)
      expect(result.tierKey, `score ${score}`).toBe(expected)
    }
  })

  it("elects the most-voted profile", () => {
    const def: QuizDefinition = {
      ...DEF,
      questions: [
        ...DEF.questions,
        question("profile2", 85, null, [option("pf2-weak", "profile2", 1, { profileId: "pf2" })]),
      ],
    }
    const result = scoreQuiz(def, [
      { questionId: "router", optionId: "r-a" },
      { questionId: "profile", optionId: "pf-weak" },
      { questionId: "profile2", optionId: "pf2-weak" },
    ])
    expect(result.profileKey).toBe("weak")
  })

  it("breaks a profile tie by position", () => {
    const def: QuizDefinition = {
      ...DEF,
      questions: [
        ...DEF.questions,
        question("profile2", 85, null, [option("pf2-tight", "profile2", 1, { profileId: "pf2" })]),
      ],
    }
    // One vote each for pf1 (position 1) and pf2 (position 2).
    const result = scoreQuiz(def, [
      { questionId: "router", optionId: "r-a" },
      { questionId: "profile", optionId: "pf-tight" },
      { questionId: "profile2", optionId: "pf2-tight" },
    ])
    expect(result.profileKey).toBe("tight")
  })

  it("falls back to the position-zero profile when nothing was voted for", () => {
    const result = scoreQuiz(DEF, [{ questionId: "router", optionId: "r-a" }])
    expect(result.profileKey).toBe("unsure")
  })

  it("lists what the walk asked and did not get", () => {
    const result = scoreQuiz(DEF, [{ questionId: "router", optionId: "r-a" }])
    expect(result.unanswered).toEqual(["where", "a1", "profile"])
  })
})

/**
 * ADDED after a mutation sweep: `Math.round` -> `Math.floor` in `normalise`
 * SURVIVED all fifteen tests above. Nothing pinned the rounding.
 *
 * The cause is arithmetic, not oversight: every score DEF can reach is 0,
 * 33.3, 50, 83.3 or 100, and round and floor agree on all five. A test that
 * cannot produce a fraction at or above .5 cannot see the difference.
 *
 * `ROUNDING` exists to produce exactly those fractions. One scoring question,
 * best weight 3, so raw 2 -> 66.66 (round 67, floor 66) and raw 1 -> 33.33
 * (round 33, ceil 34). Together they pin round from BOTH sides — floor and
 * ceil each fail one.
 */
const ROUNDING: QuizDefinition = {
  ...DEF,
  questions: [
    question("only", 10, null, [
      option("only-3", "only", 1, { weight: 3 }),
      option("only-2", "only", 2, { weight: 2 }),
      option("only-1", "only", 3, { weight: 1 }),
    ]),
  ],
}

describe("scoreQuiz — the percentage is rounded, not truncated", () => {
  it("rounds 66.66 up to 67 rather than flooring it to 66", () => {
    const result = scoreQuiz(ROUNDING, [{ questionId: "only", optionId: "only-2" }])
    expect(result.rawScore).toBe(2)
    expect(result.maxScore).toBe(3)
    expect(result.score).toBe(67)
  })

  it("rounds 33.33 down to 33 rather than ceiling it to 34", () => {
    const result = scoreQuiz(ROUNDING, [{ questionId: "only", optionId: "only-1" }])
    expect(result.rawScore).toBe(1)
    expect(result.maxScore).toBe(3)
    expect(result.score).toBe(33)
  })
})

describe("sanitiseAnswers — what is worth STORING", () => {
  it("keeps an answer whose option really belongs to its question", () => {
    const kept = sanitiseAnswers(DEF, [{ questionId: "a1", optionId: "a1-best" }])
    expect(kept).toEqual([{ questionId: "a1", optionId: "a1-best" }])
  })

  it("drops an answer to a question that is not in this quiz", () => {
    expect(sanitiseAnswers(DEF, [{ questionId: "not-a-question", optionId: "a1-best" }])).toEqual([])
  })

  it("drops an option that belongs to a DIFFERENT question", () => {
    // scoreQuiz already refuses to count this. The point here is that it must
    // not be STORED either: quiz_attempts.answers is read by an operator and
    // counted by a report, and "it could not have moved the score" is not a
    // reason to keep a forged row.
    expect(sanitiseAnswers(DEF, [{ questionId: "a1", optionId: "b1-best" }])).toEqual([])
  })

  it("keeps the LAST answer when a question is answered twice", () => {
    const kept = sanitiseAnswers(DEF, [
      { questionId: "a1", optionId: "a1-best" },
      { questionId: "a1", optionId: "a1-worst" },
    ])
    expect(kept).toEqual([{ questionId: "a1", optionId: "a1-worst" }])
  })

  it("drops an answer to an INACTIVE question", () => {
    const withInactive: QuizDefinition = {
      ...DEF,
      questions: DEF.questions.map((q) => (q.id === "a1" ? { ...q, isActive: false } : q)),
    }
    expect(sanitiseAnswers(withInactive, [{ questionId: "a1", optionId: "a1-best" }])).toEqual([])
  })
})
