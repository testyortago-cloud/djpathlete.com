// @vitest-environment node
// __tests__/lib/quizzes/public-definition.test.ts
//
// ZERO MOCKS. Same pure-module contract as score.ts and gate.ts.
//
// THE POINT OF THIS FILE: the browser is handed a quiz to walk, and a walker
// that knows the weights can compute its own result. Scoring is server-side
// (§4.1), so a leaked weight is not merely untidy — it is the whole reason a
// result cannot be forged, handed to the forger.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §4.1
import { describe, it, expect } from "vitest"
import { publicQuizDefinition } from "@/lib/quizzes/public-definition"
import type { QuizDefinition, QuizOption, QuizQuestion } from "@/lib/quizzes/types"

function option(id: string, questionId: string, position: number, extra: Partial<QuizOption> = {}): QuizOption {
  return { id, questionId, position, label: id, weight: 0, routesToBranchId: null, profileId: null, ...extra }
}

function question(id: string, position: number, branchId: string | null, options: QuizOption[]): QuizQuestion {
  return { id, quizId: "q", branchId, position, prompt: id, helpText: null, isActive: true, options }
}

const FIXTURE: QuizDefinition = {
  id: "q",
  key: "rpi",
  name: "RPI",
  status: "active",
  introHeadline: "Intro headline",
  introBody: "Intro body",
  gateHeadline: "Gate headline",
  gateBody: "Gate body",
  resultHeadline: "Result headline",
  seedMarker: "seeded-and-unverified",
  branches: [
    { id: "A", quizId: "q", key: "alpha", name: "Alpha", description: "internal note", position: 1 },
    { id: "B", quizId: "q", key: "beta", name: "Beta", description: null, position: 2 },
  ],
  profiles: [
    { id: "pf0", quizId: "q", key: "unsure", name: "Unsure", description: "d", position: 0 },
    { id: "pf1", quizId: "q", key: "tight", name: "Tight", description: "d", position: 1 },
  ],
  tiers: [
    { id: "t1", quizId: "q", key: "red", position: 1, minScore: 0, maxScore: 49, headline: "h", body: "b", ctaLabel: null, ctaHref: null },
    { id: "t2", quizId: "q", key: "green", position: 2, minScore: 50, maxScore: 100, headline: "h", body: "b", ctaLabel: null, ctaHref: null },
  ],
  questions: [
    question("router", 10, null, [
      option("r-a", "router", 1, { routesToBranchId: "A", weight: 7 }),
      option("r-b", "router", 2, { routesToBranchId: "B", weight: 9 }),
    ]),
    question("a1", 50, "A", [
      option("a1-y", "a1", 1, { weight: 3, profileId: "pf1" }),
      option("a1-n", "a1", 2, { weight: 0, profileId: "pf0" }),
    ]),
    // Inactive: the browser should never be asked to render it.
    question("a2", 60, "A", [option("a2-y", "a2", 1, { weight: 5 }), option("a2-n", "a2", 2)]),
  ],
}
FIXTURE.questions[2].isActive = false

/**
 * Walks the WHOLE serialised object rather than checking three known paths.
 * A three-path check passes forever after someone adds a fourth path.
 */
function keysAnywhere(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((v) => keysAnywhere(v, found))
    return found
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      found.add(k)
      keysAnywhere(v, found)
    }
  }
  return found
}

/** Every primitive value anywhere in the tree, for leak-by-value checks. */
function valuesAnywhere(value: unknown, found: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    value.forEach((v) => valuesAnywhere(v, found))
    return found
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) valuesAnywhere(v, found)
    return found
  }
  found.push(value)
  return found
}

describe("publicQuizDefinition", () => {
  it("lets no weight, profile vote, tier or profile survive anywhere in the public shape", () => {
    const keys = keysAnywhere(JSON.parse(JSON.stringify(publicQuizDefinition(FIXTURE))))
    expect([...keys].filter((k) => /weight|profile|tier|minScore|maxScore|seedMarker/i.test(k))).toEqual([])
  })

  it("keeps routesToBranchId, because the browser must walk the branch", () => {
    const pub = publicQuizDefinition(FIXTURE)
    const router = pub.questions.find((q) => q.id === "router")!
    expect(router.options.map((o) => o.routesToBranchId)).toEqual(["A", "B"])
  })

  it("keeps what the visitor has to read", () => {
    const pub = publicQuizDefinition(FIXTURE)
    expect(pub.id).toBe("q")
    expect(pub.key).toBe("rpi")
    expect(pub.introHeadline).toBe("Intro headline")
    expect(pub.gateBody).toBe("Gate body")
    expect(pub.resultHeadline).toBe("Result headline")
    expect(pub.branches.map((b) => b.key)).toEqual(["alpha", "beta"])
  })

  it("omits inactive questions — the browser cannot render what the walk will not ask", () => {
    expect(publicQuizDefinition(FIXTURE).questions.map((q) => q.id)).toEqual(["router", "a1"])
  })

  it("orders questions by global position", () => {
    const shuffled: QuizDefinition = { ...FIXTURE, questions: [...FIXTURE.questions].reverse() }
    expect(publicQuizDefinition(shuffled).questions.map((q) => q.id)).toEqual(["router", "a1"])
  })

  it("leaks no weight BY VALUE either — 7, 9 and 3 appear nowhere", () => {
    // A key-name walk misses `{ w: 3 }`. This catches a rename as well as an add.
    const values = valuesAnywhere(JSON.parse(JSON.stringify(publicQuizDefinition(FIXTURE))))
    expect(values).not.toContain(7)
    expect(values).not.toContain(9)
    expect(values).not.toContain(3)
  })
})
