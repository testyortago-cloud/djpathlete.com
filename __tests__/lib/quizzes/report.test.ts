// @vitest-environment node
// ZERO MOCKS — lib/quizzes/report.ts imports types and the pure score module only.
import fs from "node:fs"
import path from "node:path"
import { describe, it, expect } from "vitest"
import { buildReport } from "@/lib/quizzes/report"
import type { QuizDefinition, QuizOption, QuizQuestion, QuizSide } from "@/lib/quizzes/types"

function opts(qid: string, weights: number[], extra: Partial<QuizOption> = {}): QuizOption[] {
  return weights.map((weight, i) => ({
    id: `${qid}-o${weight}`, questionId: qid, position: i, label: `${qid} ${weight}`,
    weight, routesToBranchId: null, profileId: null, ...extra,
  }))
}
function q(id: string, position: number, o: QuizOption[], extra: Partial<QuizQuestion> = {}): QuizQuestion {
  return { id, quizId: "q", branchId: null, position, prompt: `${id}?`, helpText: null, mediaUrl: null, mediaPosterUrl: null, isActive: true, options: o, ...extra }
}
function test(id: string, position: number, label: string, side: QuizSide | null): QuizQuestion {
  return q(id, position, opts(id, [3, 2, 1, 0]), { reportLabel: label, side })
}
function def(questions: QuizQuestion[]): QuizDefinition {
  return { id: "q", key: "k", name: "n", status: "active", introHeadline: "", introBody: "", gateHeadline: "",
    gateBody: "", resultHeadline: "", seedMarker: null, branches: [], tiers: [], profiles: [], questions }
}
const pick = (qid: string, weight: number) => ({ questionId: qid, optionId: `${qid}-o${weight}` })

const RPI = def([
  q("sport", 10, opts("sport", [0, 0])),
  test("cL", 60, "Copenhagen", "left"),
  test("cR", 70, "Copenhagen", "right"),
  test("hollow", 50, "Rocking hollow", null),
  q("feel", 130, opts("feel", [0, 0])),
  q("area", 140, opts("area", [0, 0], { profileId: "pf1" })),
  q("freq", 120, opts("freq", [3, 0])),
])

describe("buildReport — the map", () => {
  it("pairs left and right under one label, in walk order", () => {
    const { map } = buildReport(RPI, [pick("cL", 3), pick("cR", 3), pick("hollow", 3)], null)
    expect(map.map((r) => r.label)).toEqual(["Rocking hollow", "Copenhagen"])
    expect(map[1]).toMatchObject({ left: 3, right: 3, single: null, max: 3, status: "solid" })
  })

  it("a 2-point side difference is a gap", () => {
    expect(buildReport(RPI, [pick("cL", 3), pick("cR", 1)], null).map[0].status).toBe("gap")
  })

  it("a 1-point difference is not a gap — it is watch when neither side is low", () => {
    expect(buildReport(RPI, [pick("cL", 3), pick("cR", 2)], null).map[0].status).toBe("watch")
  })

  it("a low side without a big difference is a leak", () => {
    expect(buildReport(RPI, [pick("cL", 1), pick("cR", 0)], null).map[0].status).toBe("leak")
  })

  it("one answered side: one meter, never a gap", () => {
    const row = buildReport(RPI, [pick("cL", 0)], null).map[0]
    expect(row).toMatchObject({ left: 0, right: null, status: "leak" })
  })

  it("an unpaired test fills `single`", () => {
    const row = buildReport(RPI, [pick("hollow", 2)], null).map.find((r) => r.label === "Rocking hollow")
    expect(row).toMatchObject({ single: 2, left: null, right: null, status: "watch" })
  })

  it("zero-max row dropped — no NaN, no divide by zero", () => {
    const d = def([q("z", 10, opts("z", [0, 0]), { reportLabel: "Zero", side: null })])
    expect(buildReport(d, [pick("z", 0)], null).map).toEqual([])
  })

  it("an unanswered test is not on the map", () => {
    expect(buildReport(RPI, [], null).map).toEqual([])
  })

  it("only walked questions count — a question on another branch is ignored", () => {
    const d = def([test("b", 10, "Branch only", "left")])
    d.questions[0].branchId = "B"
    expect(buildReport(d, [pick("b", 3)], "A").map).toEqual([])
  })

  it("two questions with the same label and side: the later one in walk order wins", () => {
    const d = def([test("x1", 10, "Dup", "left"), test("x2", 20, "Dup", "left")])
    expect(buildReport(d, [pick("x1", 3), pick("x2", 0)], null).map[0].left).toBe(0)
  })

  it("a quiz with no report labels has an empty map", () => {
    const d = def([q("a", 10, opts("a", [3, 0]))])
    expect(buildReport(d, [pick("a", 3)], null).map).toEqual([])
  })
})

describe("buildReport — the mirror", () => {
  it("echoes unscored answers, skipping scored, labelled and profile-vote questions", () => {
    const { mirror } = buildReport(RPI, [pick("sport", 0), pick("feel", 0), pick("area", 0), pick("freq", 3), pick("cL", 3)], null)
    expect(mirror).toEqual([
      { prompt: "sport?", answer: "sport 0" },
      { prompt: "feel?", answer: "feel 0" },
    ])
  })
})

it("both result routes use the one shared presentResult", () => {
  for (const route of ["app/api/quiz/submit/route.ts", "app/api/quiz/preview-submit/route.ts"]) {
    const src = fs.readFileSync(path.join(process.cwd(), route), "utf8")
    expect(src).toContain('from "@/lib/quizzes/present-result"')
    expect(src).not.toMatch(/function presentResult/)
  }
})
