// A LEAF WITH NO MOCKS. `quizUsesInSteps` reads `funnel_steps.project_data`,
// which is `jsonb` typed `unknown` end to end and can hold three different
// things: a real SectionDoc, a legacy GrapesJS blob (steps that predate
// 00203), or null. It must answer "no quizzes" for the last two rather than
// throw on the funnel's own screen.
import { describe, expect, it } from "vitest"
import { quizUsesInSteps } from "@/lib/funnels/quiz-refs"

const QUIZ_A = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"
const QUIZ_B = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"

function doc(sections: unknown[]) {
  return { v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" }, sections }
}
function quizSection(id: string, quizId: string) {
  return { id, kind: "quiz", variant: "boxed", style: {}, props: { quizId, submitLabel: "See my result" } }
}
function heroSection() {
  return { id: "h1", kind: "hero", variant: "centered", style: {}, props: { headline: "Hi" } }
}

describe("quizUsesInSteps", () => {
  it("finds the quiz a step's draft points at, with the step it is on", () => {
    const uses = quizUsesInSteps([
      { id: "step-1", name: "Quiz", project_data: doc([heroSection(), quizSection("q1", QUIZ_A)]) },
    ])
    expect(uses).toEqual([{ quizId: QUIZ_A, stepId: "step-1", stepName: "Quiz" }])
  })

  it("returns every step's quiz, in step order", () => {
    const uses = quizUsesInSteps([
      { id: "step-1", name: "Entry", project_data: doc([quizSection("q1", QUIZ_A)]) },
      { id: "step-2", name: "Second", project_data: doc([quizSection("q1", QUIZ_B)]) },
    ])
    expect(uses.map((u) => u.quizId)).toEqual([QUIZ_A, QUIZ_B])
    expect(uses.map((u) => u.stepId)).toEqual(["step-1", "step-2"])
  })

  it("reports the SAME quiz on two steps once, keeping the first step", () => {
    const uses = quizUsesInSteps([
      { id: "step-1", name: "Entry", project_data: doc([quizSection("q1", QUIZ_A)]) },
      { id: "step-2", name: "Retake", project_data: doc([quizSection("q1", QUIZ_A)]) },
    ])
    expect(uses).toEqual([{ quizId: QUIZ_A, stepId: "step-1", stepName: "Entry" }])
  })

  it("ignores a step that has never been built", () => {
    expect(quizUsesInSteps([{ id: "step-1", name: "New", project_data: null }])).toEqual([])
  })

  it("ignores a legacy GrapesJS blob rather than throwing", () => {
    const legacy = { pages: [{ frames: [{ component: { type: "wrapper" } }] }] }
    expect(quizUsesInSteps([{ id: "step-1", name: "Old", project_data: legacy }])).toEqual([])
  })

  it("ignores a quiz block whose quizId is blank -- the registry's own default", () => {
    const uses = quizUsesInSteps([{ id: "step-1", name: "Unset", project_data: doc([quizSection("q1", "")]) }])
    expect(uses).toEqual([])
  })

  it("ignores a quizId that is not a uuid, which no quizzes row can have", () => {
    const uses = quizUsesInSteps([{ id: "step-1", name: "Junk", project_data: doc([quizSection("q1", "not-a-uuid")]) }])
    expect(uses).toEqual([])
  })

  it("ignores a quizId stamped onto a section that is not a quiz", () => {
    // Not hypothetical. The AI page builder writes section props, and the
    // registry's own instruction to it is "NEVER WRITE quizId" -- which is an
    // instruction precisely because a model can stamp one anywhere. Only the
    // `quiz` kind renders the island, so only the `quiz` kind is a use.
    const stray = { id: "h1", kind: "hero", variant: "centered", style: {}, props: { headline: "Hi", quizId: QUIZ_B } }
    expect(quizUsesInSteps([{ id: "step-1", name: "Stray", project_data: doc([stray]) }])).toEqual([])
  })

  it("finds a quiz in a document a full schema parse would reject", () => {
    // The panel's job is to say WHICH quiz this funnel points at. A document
    // that fails `sectionDocSchema` somewhere else still points at it, and a
    // whole-document parse would answer "no quiz" for a page that has one.
    const broken = doc([quizSection("q1", QUIZ_A), { id: "x1", kind: "not-a-kind", style: {}, props: {} }])
    expect(quizUsesInSteps([{ id: "step-1", name: "Broken", project_data: broken }])).toEqual([
      { quizId: QUIZ_A, stepId: "step-1", stepName: "Broken" },
    ])
  })
})
