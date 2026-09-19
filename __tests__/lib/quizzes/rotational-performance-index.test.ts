// The Rotational Performance Index seed, checked against the gate that decides
// whether a quiz may take a real visitor's answers, and against the four
// corrections this build makes to the owner's scoring document.
//
// ZERO MOCKS, deliberately: `quizGate`, `scoreQuiz` and the seed are all pure
// modules whose only import is types. A mock here would mean one of them had
// grown an I/O dependency.

import { describe, expect, it } from "vitest"
import { quizGate } from "@/lib/quizzes/gate"
import { scoreQuiz, walkedQuestions } from "@/lib/quizzes/score"
import { publicQuizDefinition } from "@/lib/quizzes/public-definition"
import {
  ROTATIONAL_PERFORMANCE_INDEX as SEED,
  toDefinition,
} from "@/lib/quizzes/seed/rotational-performance-index"
import type { QuizAnswer, QuizDefinition } from "@/lib/quizzes/types"

const definition = toDefinition(SEED)

/**
 * Answers every walked question with its best, worst or middling option BY WEIGHT.
 *
 * THE ROUTER IS THE EXCEPTION, and it has to be. `scoreQuiz` derives the branch
 * from the answers rather than from any caller-supplied value, so a helper that
 * picked the router's first option for every branch would build a walk for
 * `golf` and then score `racquet` — leaving `q1_racquet` unanswered and
 * silently costing 3 points. The first draft of this file did exactly that and
 * two assertions caught it.
 */
function answerAll(def: QuizDefinition, branchId: string, want: "best" | "worst" | "middling"): QuizAnswer[] {
  return walkedQuestions(def, branchId).map((question) => {
    const routed = question.options.find((option) => option.routesToBranchId === branchId)
    if (routed) return { questionId: question.id, optionId: routed.id }
    // BY WEIGHT, NEVER BY INDEX. These assertions used to pick option [0] to
    // mean "best", which silently encoded best-first ordering — the very
    // property the ordering tests below now forbid. Four of them went red the
    // moment Q1 and Q3 were flipped, for no reason connected to the behaviour
    // they were meant to pin.
    const byWeight = [...question.options].sort((a, b) => a.weight - b.weight)
    const chosen =
      want === "worst" ? byWeight[0]
      : want === "best" ? byWeight[byWeight.length - 1]
      : byWeight[Math.floor(byWeight.length / 2)]
    return { questionId: question.id, optionId: chosen.id }
  })
}

describe("the activation gate", () => {
  it("passes, so the seed cannot ship in a state activation would reject", () => {
    const gate = quizGate(definition)
    expect(gate.blockers).toEqual([])
    expect(gate.ok).toBe(true)
  })

  it("raises no warnings — every profile is voted for and no scored question is flat", () => {
    expect(quizGate(definition).warnings).toEqual([])
  })
})

describe("the zero floor (correction 1)", () => {
  // The document's worst option scores 1, which puts the floor at 31% and
  // squeezes `red` into three raw totals. The whole point of the correction is
  // that the bottom of the scale is reachable.
  it("scores 0 when every answer is the worst one", () => {
    const answers = answerAll(definition, "racquet", "worst")
    const result = scoreQuiz(definition, answers)
    expect(result.rawScore).toBe(0)
    expect(result.score).toBe(0)
    expect(result.tierKey).toBe("red")
  })

  it("scores 100 when every answer is the best one", () => {
    const answers = answerAll(definition, "racquet", "best")
    const result = scoreQuiz(definition, answers)
    expect(result.score).toBe(100)
    expect(result.tierKey).toBe("green")
  })

  it("puts the maximum at 33 — nine movement tests plus Q1 plus Q3, at 3 each", () => {
    const result = scoreQuiz(definition, answerAll(definition, "racquet", "best"))
    expect(result.maxScore).toBe(33)
  })
})

describe("Q2 is segmentation, not scored (correction 2)", () => {
  const q2 = definition.questions.find((q) => q.id === "post_session_soreness")

  it("carries an all-zero weight set, the documented segmentation marker", () => {
    expect(q2).toBeDefined()
    expect(q2!.options.map((o) => o.weight)).toEqual([0, 0, 0, 0, 0])
  })

  it("cannot move the score — 'I feel fine' and 'Lower back' land identically", () => {
    const base = answerAll(definition, "golf", "best").filter((a) => a.questionId !== "post_session_soreness")
    const feelFine = scoreQuiz(definition, [
      ...base,
      { questionId: "post_session_soreness", optionId: "post_session_soreness:4" },
    ])
    const lowerBack = scoreQuiz(definition, [
      ...base,
      { questionId: "post_session_soreness", optionId: "post_session_soreness:0" },
    ])
    // As the document weights it (1 vs 3), these two would differ and the
    // athlete who feels fine would score LOWER. That is the bug being pinned.
    expect(feelFine.score).toBe(lowerBack.score)
  })
})

describe("per-side scoring (correction 3)", () => {
  it("asks the four sided tests twice and the sagittal one once", () => {
    const keys = definition.questions.map((q) => q.id)
    for (const test of ["prone_hip_abduction", "copenhagen", "windshield_wipers", "retro_hop"]) {
      expect(keys).toContain(`${test}_left`)
      expect(keys).toContain(`${test}_right`)
    }
    // Rocking hollow is sagittal: a left/right split would be invented data.
    expect(keys).toContain("rocking_hollow")
    expect(keys).not.toContain("rocking_hollow_left")
  })

  it("lets one side score differently from the other", () => {
    const answers = answerAll(definition, "golf", "best").map((a) =>
      a.questionId === "copenhagen_right" ? { ...a, optionId: "copenhagen_right:3" } : a,
    )
    const result = scoreQuiz(definition, answers)
    expect(result.rawScore).toBe(30)
    expect(result.score).toBe(91)
  })
})

describe("the sport router (correction 4)", () => {
  it("routes every option to a branch, so no visitor is stranded", () => {
    const router = definition.questions.find((q) => q.id === "sport_router")!
    expect(router.options).toHaveLength(5)
    expect(router.options.every((o) => o.routesToBranchId !== null)).toBe(true)
  })

  it("asks the same number of questions on every branch", () => {
    const counts = definition.branches.map((b) => walkedQuestions(definition, b.id).length)
    expect(new Set(counts).size).toBe(1)
    // router + Q1 + 9 movements + Q3 + Q2 + Q4
    expect(counts[0]).toBe(14)
  })

  it("voices Q1 differently per branch but weights it identically", () => {
    const q1s = definition.questions.filter((q) => q.id.startsWith("q1_"))
    expect(q1s).toHaveLength(5)
    expect(new Set(q1s.map((q) => q.prompt)).size).toBe(5)
    for (const q1 of q1s) expect([...q1.options.map((o) => o.weight)].sort()).toEqual([0, 1, 2, 3])
  })

  it("scores a branch identically regardless of which sport was chosen", () => {
    const scores = definition.branches.map(
      (b) => scoreQuiz(definition, answerAll(definition, b.id, "middling")).score,
    )
    expect(new Set(scores).size).toBe(1)
  })
})

describe("option ordering, against satisficing", () => {
  const scored = definition.questions.filter((q) => q.options.some((o) => o.weight > 0))
  const bestFirst = (q: (typeof scored)[number]) =>
    q.options[0].weight === Math.max(...q.options.map((o) => o.weight))

  // THE ONE THAT WOULD HAVE CAUGHT IT ON THE ATHLETE QUIZ. All eleven of its
  // scored questions run 3/2/1/0, so clicking the first button all the way
  // down scores 21/21. Its only prod completion did exactly that. A respondent
  // who satisfices is handed the most flattering result and the softest CTA,
  // which is backwards commercially and worthless diagnostically.
  it("does not put the best answer first on EVERY scored question", () => {
    expect(scored.every(bestFirst)).toBe(false)
  })

  it("puts the worst answer first on both self-report questions", () => {
    for (const q of scored.filter((x) => x.id.startsWith("q1_") || x.id === "rotational_training_frequency")) {
      expect(q.options[0].weight).toBe(0)
      expect(q.options[q.options.length - 1].weight).toBe(3)
    }
  })

  // Kept best-first on purpose: they count down a checklist, and the person
  // has to attempt the movement first, so there is no cost-free drift option.
  it("keeps the movement tests counting down from all-three", () => {
    for (const q of scored.filter((x) => x.mediaUrl !== null)) {
      expect(q.options.map((o) => o.weight)).toEqual([3, 2, 1, 0])
    }
  })

  it("still scores 100 only for a genuinely perfect walk", () => {
    // Clicking the FIRST option on every question is no longer a perfect score.
    const firstEverywhere = walkedQuestions(definition, "golf").map((q) => ({
      questionId: q.id,
      optionId: q.options[0].id,
    }))
    expect(scoreQuiz(definition, firstEverywhere).score).toBeLessThan(100)
  })
})

describe("where a result sends the visitor", () => {
  it("gives every tier a CTA — a result with no next step is a dead end", () => {
    for (const tier of definition.tiers) {
      expect(tier.ctaLabel).toBeTruthy()
      expect(tier.ctaHref).toBeTruthy()
    }
  })

  // THE ONE THAT WOULD HAVE CAUGHT THE BUG. Three of this funnel's four steps
  // have `project_data` NULL — never built — so a tier aimed at its own
  // `offer` step is a live page whose result button leads nowhere. `publishGate`
  // cannot see it: it validates links inside a SECTION DOCUMENT, and a tier's
  // ctaHref lives on the quiz row. Nothing but this assertion stands between
  // that and paid traffic.
  it("never points a tier back into this funnel's own unbuilt steps", () => {
    for (const tier of definition.tiers) {
      expect(tier.ctaHref).not.toContain("/go/rotational-reboot-score")
    }
  })

  it("sends the three buying tiers to the live program page", () => {
    for (const key of ["red", "orange", "yellow"]) {
      const tier = definition.tiers.find((t) => t.key === key)!
      expect(tier.ctaHref).toBe("/programs/rotational-reboot")
    }
  })
})

describe("the demo clips", () => {
  const movement = definition.questions.filter((q) => q.mediaUrl !== null)

  it("attaches a clip and a poster to all nine movement questions, and to nothing else", () => {
    expect(movement).toHaveLength(9)
    for (const question of movement) {
      expect(question.mediaPosterUrl).not.toBeNull()
      // The path storage.rules matches is quiz-media/{quizKey}/{fileName}.
      // Encoded whole, slashes included — segment-wise encoding 404s.
      expect(question.mediaUrl).toContain("quiz-media%2Frotational-reboot%2F")
      expect(question.mediaUrl).toMatch(/\.mp4\?alt=media$/)
      expect(question.mediaPosterUrl).toMatch(/-poster\.jpg\?alt=media$/)
    }
  })

  it("gives both sides of a test the same clip — the movement is the same, the side is not", () => {
    const left = movement.find((q) => q.id === "copenhagen_left")!
    const right = movement.find((q) => q.id === "copenhagen_right")!
    expect(left.mediaUrl).toBe(right.mediaUrl)
  })

  it("puts the criteria in help text, so they are read before the attempt", () => {
    for (const question of movement) {
      expect(question.helpText).toBeTruthy()
      expect(question.helpText!.length).toBeGreaterThan(80)
    }
  })
})

describe("what reaches the browser", () => {
  const publicDef = publicQuizDefinition(definition)

  it("ships the clip, because a movement test cannot be answered unseen", () => {
    const question = publicDef.questions.find((q) => q.id === "copenhagen_left")!
    expect(question.mediaUrl).toBe(definition.questions.find((q) => q.id === "copenhagen_left")!.mediaUrl)
    expect(question.mediaPosterUrl).toBeTruthy()
  })

  it("still ships no weight, no profile vote and no tier band", () => {
    const serialised = JSON.stringify(publicDef)
    expect(serialised).not.toContain("weight")
    expect(serialised).not.toContain("profileId")
    expect(serialised).not.toContain("minScore")
  })
})
