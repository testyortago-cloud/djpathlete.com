// @vitest-environment node
// __tests__/lib/quizzes/gate.test.ts
//
// ZERO MOCKS. `lib/quizzes/gate.ts` imports nothing but types, the same
// contract as lib/quizzes/score.ts and lib/lead-engine/pipeline-move.ts.
//
// Every case below derives from ONE well-formed fixture by breaking exactly
// one thing. That is deliberate: a bespoke fixture per blocker can pass its
// own test while sharing no shape with a real quiz, and a blocker that only
// ever sees a fixture built to trip it is never proven to leave a good quiz
// alone. `VALID` passing is therefore itself a test.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §2.2
import { describe, it, expect } from "vitest"
import { quizGate } from "@/lib/quizzes/gate"
import type { QuizDefinition, QuizOption, QuizQuestion } from "@/lib/quizzes/types"

function option(id: string, questionId: string, position: number, extra: Partial<QuizOption> = {}): QuizOption {
  return { id, questionId, position, label: id, weight: 0, routesToBranchId: null, profileId: null, ...extra }
}

function question(id: string, position: number, branchId: string | null, options: QuizOption[]): QuizQuestion {
  return { id, quizId: "q", branchId, position, prompt: id, helpText: null, isActive: true, options }
}

const VALID: QuizDefinition = {
  id: "q",
  key: "k",
  name: "n",
  status: "draft",
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
  ],
  tiers: [
    { id: "t1", quizId: "q", key: "red", position: 1, minScore: 0, maxScore: 39, headline: "", body: "", ctaLabel: null, ctaHref: null },
    { id: "t2", quizId: "q", key: "orange", position: 2, minScore: 40, maxScore: 79, headline: "", body: "", ctaLabel: null, ctaHref: null },
    { id: "t3", quizId: "q", key: "green", position: 3, minScore: 80, maxScore: 100, headline: "", body: "", ctaLabel: null, ctaHref: null },
  ],
  questions: [
    question("router", 10, null, [
      option("r-a", "router", 1, { routesToBranchId: "A" }),
      option("r-b", "router", 2, { routesToBranchId: "B" }),
    ]),
    // Segmentation: all-zero. Documented marker; the gate must stay quiet.
    question("where", 20, null, [option("w1", "where", 1), option("w2", "where", 2)]),
    // The profile vote. All-zero too, so it warns about nothing.
    question("profile", 30, null, [
      option("pf-unsure", "profile", 1, { profileId: "pf0" }),
      option("pf-tight", "profile", 2, { profileId: "pf1" }),
    ]),
    question("a1", 50, "A", [option("a1-y", "a1", 1, { weight: 3 }), option("a1-n", "a1", 2, { weight: 0 })]),
    question("b1", 60, "B", [option("b1-y", "b1", 1, { weight: 3 }), option("b1-n", "b1", 2, { weight: 0 })]),
  ],
}

/** Structured clone so a case cannot leak a mutation into the next one. */
function derive(mutate: (d: QuizDefinition) => void): QuizDefinition {
  const copy: QuizDefinition = JSON.parse(JSON.stringify(VALID))
  mutate(copy)
  return copy
}

const blockersOf = (d: QuizDefinition) => quizGate(d).blockers.join(" | ")

describe("quizGate — the well-formed case", () => {
  it("passes a quiz with a router, reachable branches, exact bands and voted profiles", () => {
    const result = quizGate(VALID)
    expect(result.blockers).toEqual([])
    expect(result.ok).toBe(true)
  })

  it("stays quiet about an all-zero question, the documented segmentation marker", () => {
    expect(quizGate(VALID).warnings.join(" | ")).not.toMatch(/same weight/i)
  })
})

describe("quizGate — blockers", () => {
  it("1. blocks a quiz with no router question", () => {
    const d = derive((x) => {
      x.questions = x.questions.filter((q) => q.id !== "router")
    })
    expect(quizGate(d).ok).toBe(false)
    expect(blockersOf(d)).toMatch(/no router question/i)
  })

  it("2. blocks a router option that routes nowhere", () => {
    const d = derive((x) => {
      x.questions.find((q) => q.id === "router")!.options[1].routesToBranchId = null
    })
    expect(quizGate(d).ok).toBe(false)
    expect(blockersOf(d)).toMatch(/routes nowhere/i)
  })

  it("3. blocks a branch no router option reaches", () => {
    const d = derive((x) => {
      x.questions.find((q) => q.id === "router")!.options[1].routesToBranchId = "A"
    })
    expect(quizGate(d).ok).toBe(false)
    expect(blockersOf(d)).toMatch(/unreachable/i)
    expect(blockersOf(d)).toMatch(/beta/)
  })

  it("4. blocks a branch with no questions", () => {
    const d = derive((x) => {
      x.questions = x.questions.filter((q) => q.id !== "b1")
    })
    expect(quizGate(d).ok).toBe(false)
    expect(blockersOf(d)).toMatch(/no questions/i)
    expect(blockersOf(d)).toMatch(/beta/)
  })

  it("5. blocks tier bands with a gap", () => {
    const d = derive((x) => {
      x.tiers[1].maxScore = 78 // 79 now belongs to no band
    })
    expect(quizGate(d).ok).toBe(false)
    expect(blockersOf(d)).toMatch(/gap/i)
  })

  it("5b. blocks bands that do not start at 0", () => {
    const d = derive((x) => {
      x.tiers[0].minScore = 1
    })
    expect(quizGate(d).ok).toBe(false)
    expect(blockersOf(d)).toMatch(/gap|start at 0/i)
  })

  it("5c. blocks bands that do not reach 100", () => {
    const d = derive((x) => {
      x.tiers[2].maxScore = 99
    })
    expect(quizGate(d).ok).toBe(false)
    expect(blockersOf(d)).toMatch(/gap|reach 100/i)
  })

  it("6. blocks tier bands that overlap", () => {
    const d = derive((x) => {
      x.tiers[1].minScore = 39 // 39 is in both red and orange
    })
    expect(quizGate(d).ok).toBe(false)
    expect(blockersOf(d)).toMatch(/overlap/i)
  })

  it("7. blocks an option voting for a profile on another quiz", () => {
    const d = derive((x) => {
      x.questions.find((q) => q.id === "profile")!.options[1].profileId = "pf-from-another-quiz"
    })
    expect(quizGate(d).ok).toBe(false)
    expect(blockersOf(d)).toMatch(/another quiz|unknown profile/i)
  })

  it("8. blocks a question with fewer than two options", () => {
    const d = derive((x) => {
      const q = x.questions.find((y) => y.id === "a1")!
      q.options = [q.options[0]]
    })
    expect(quizGate(d).ok).toBe(false)
    expect(blockersOf(d)).toMatch(/fewer than two options/i)
  })
})

describe("quizGate — warnings do not block", () => {
  it("9. warns when every weight on a question is identical and non-zero", () => {
    const d = derive((x) => {
      const q = x.questions.find((y) => y.id === "a1")!
      q.options[0].weight = 2
      q.options[1].weight = 2
    })
    const result = quizGate(d)
    expect(result.ok).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.warnings.join(" | ")).toMatch(/same weight/i)
  })

  it("10. warns about a profile no option votes for", () => {
    const d = derive((x) => {
      x.profiles.push({ id: "pf9", quizId: "q", key: "orphan", name: "Orphan", description: "", position: 9 })
    })
    const result = quizGate(d)
    expect(result.ok).toBe(true)
    expect(result.warnings.join(" | ")).toMatch(/orphan|no option votes/i)
  })
})
