// A LEAF WITH NO MOCKS. `quizUsesInSteps` reads `funnel_steps.project_data`,
// which is `jsonb` typed `unknown` end to end and can hold three different
// things: a real SectionDoc, a legacy GrapesJS blob (steps that predate
// 00203), or null. It must answer "no quizzes" for the last two rather than
// throw on the funnel's own screen.
import { describe, expect, it } from "vitest"
import { quizPlacements, quizUsesInSteps, type QuizPlacementStep } from "@/lib/funnels/quiz-refs"

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

// ---------------------------------------------------------------------------
// `quizPlacements` — the SAME walk read the other way round.
//
// `quizUsesInSteps` answers "which quizzes does this funnel use?" for one
// funnel's settings screen. The quizzes SCREEN needs the inverse — "which page
// shows this quiz?" — because a quiz has no page of its own, so the only thing
// it can show a preview of is the funnel page running it.
// ---------------------------------------------------------------------------

const FUNNEL_A = "11111111-1111-4111-8111-111111111111"
const FUNNEL_B = "22222222-2222-4222-8222-222222222222"

function placementStep(over: Partial<QuizPlacementStep> = {}): QuizPlacementStep {
  return {
    id: "step-1",
    name: "Quiz",
    slug: "index",
    is_entry: true,
    funnel_id: FUNNEL_A,
    published_version_id: null,
    project_data: doc([quizSection("q1", QUIZ_A)]),
    ...over,
  }
}

describe("quizPlacements", () => {
  it("maps a quiz id to the step and funnel whose page shows it", () => {
    const placements = quizPlacements([placementStep()])
    expect(placements.get(QUIZ_A)).toEqual({
      quizId: QUIZ_A,
      funnelId: FUNNEL_A,
      stepId: "step-1",
      stepName: "Quiz",
      stepSlug: "index",
      isEntry: true,
      published: false,
    })
  })

  it("reports a step carrying a published version as published", () => {
    // This is the whole reason the column is read: the card's preview points at
    // the LIVE route for a published page and at the draft route otherwise,
    // which is the identical rule the funnels board follows.
    const placements = quizPlacements([placementStep({ published_version_id: "ver-1" })])
    expect(placements.get(QUIZ_A)?.published).toBe(true)
  })

  it("keeps the FIRST step when two pages show the same quiz", () => {
    // A quiz block holds a pointer, so one quiz can legitimately appear on two
    // pages. The card needs one page to preview, and the first in the given
    // order is the one the caller sorted to the front.
    const placements = quizPlacements([
      placementStep({ id: "step-1", name: "Entry", slug: "index" }),
      placementStep({ id: "step-2", name: "Retake", slug: "retake", is_entry: false }),
    ])
    expect(placements.get(QUIZ_A)?.stepId).toBe("step-1")
    expect(placements.size).toBe(1)
  })

  it("keeps each quiz separately when different pages show different quizzes", () => {
    const placements = quizPlacements([
      placementStep({ id: "step-1", funnel_id: FUNNEL_A, project_data: doc([quizSection("q1", QUIZ_A)]) }),
      placementStep({ id: "step-2", funnel_id: FUNNEL_B, project_data: doc([quizSection("q1", QUIZ_B)]) }),
    ])
    expect(placements.get(QUIZ_A)?.funnelId).toBe(FUNNEL_A)
    expect(placements.get(QUIZ_B)?.funnelId).toBe(FUNNEL_B)
  })

  it("has no entry for a quiz no page shows", () => {
    // NOT an error and not a zero-value placement. "This quiz is on no page" is
    // what the card renders as "No preview yet", and an entry pointing at a
    // funnel that does not show it would build a preview URL for the wrong page.
    const placements = quizPlacements([placementStep({ project_data: doc([heroSection()]) })])
    expect(placements.has(QUIZ_A)).toBe(false)
    expect(placements.size).toBe(0)
  })

  it("survives a legacy GrapesJS blob and a step nobody has built", () => {
    // Same three shapes `project_data` holds across the table. The quizzes
    // screen must not 500 because one old page predates 00203.
    const placements = quizPlacements([
      placementStep({ id: "step-1", project_data: { pages: [{ component: "<div/>" }] } }),
      placementStep({ id: "step-2", project_data: null }),
    ])
    expect(placements.size).toBe(0)
  })

  it("ignores a quizId that is not a uuid", () => {
    const placements = quizPlacements([placementStep({ project_data: doc([quizSection("q1", "not-a-uuid")]) })])
    expect(placements.size).toBe(0)
  })
})
