// @vitest-environment node
//
// CAN A QUIZ SECTION BE ORIGINATED AT ALL?
//
// Every other quiz test hands the system a document that ALREADY contains a
// quiz section and checks what happens next — it renders, it gates, it
// publishes. None of them asks the prior question: can one get onto a page in
// the first place?
//
// That question has teeth because `quiz` is deliberately withheld from the AI
// page-builder prompt (`NOT_OFFERED_TO_THE_BUILDER`): the model cannot author a
// `quizId` the publish gate would accept. A section can only be originated by
// the model or by a hand-built `add_section` op, and the builder UI emits only
// `update_section` and `move_section`. So if this op grammar rejected a quiz
// section, the kind would be unreachable — full registry, compiler, renderer
// and publish-gate support behind a door with no handle.
//
// Raised in review by a second session. Zero mocks: this is the REAL grammar.
import { describe, it, expect } from "vitest"
import { applyOps } from "@/lib/funnels/sections/apply"
import { NOT_OFFERED_TO_THE_BUILDER } from "@/lib/funnels/sections/prompt"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"

function pageWithoutAQuiz(): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "hero1",
        kind: "hero",
        variant: "centered",
        style: {},
        props: { headline: "Train like an athlete", primaryCta: { label: "Start", target: { kind: "url", href: "/go" } } },
      },
    ],
  }
}

const addQuizOp = (after: string | null = "hero1") => ({
  op: "add_section",
  after,
  section: {
    id: "quiz1",
    kind: "quiz",
    variant: "boxed",
    style: {},
    props: { heading: "The Athlete Quiz", quizId: QUIZ_ID, submitLabel: "See my result" },
  },
})

describe("originating a quiz section", () => {
  it("the op grammar ACCEPTS an added quiz section", () => {
    // MUTANT KILLED: omitting `quizSchema` from `sectionSchema`'s union. That
    // compiles clean — the union is an array literal with no exhaustiveness
    // check — and the kind becomes impossible to add while every
    // already-has-a-quiz test stays green.
    const applied = applyOps(pageWithoutAQuiz(), [addQuizOp()])
    expect(applied.ok, applied.ok ? "" : JSON.stringify(applied.errors)).toBe(true)
    if (!applied.ok) return
    expect(applied.doc.sections.map((s) => s.kind)).toEqual(["hero", "quiz"])
  })

  it("carries the owner's quizId through untouched", () => {
    // The one thing the model could never supply is the whole point of the
    // owner-driven path, so it must survive the op verbatim.
    const applied = applyOps(pageWithoutAQuiz(), [addQuizOp()])
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const quiz = applied.doc.sections.find((s) => s.kind === "quiz")
    expect((quiz?.props as { quizId?: string }).quizId).toBe(QUIZ_ID)
  })

  it("REFUSES a quiz section whose quizId is not a uuid", () => {
    // The publish gate would catch an invented id later, but later means after
    // the owner published and a visitor saw it. The grammar refuses it now.
    const bad = addQuizOp()
    ;(bad.section.props as Record<string, unknown>).quizId = "rpi_athlete_quiz"
    const applied = applyOps(pageWithoutAQuiz(), [bad])
    expect(applied.ok).toBe(false)
  })

  it("REFUSES a quiz section with no quizId at all", () => {
    const bad = addQuizOp()
    delete (bad.section.props as Record<string, unknown>).quizId
    expect(applyOps(pageWithoutAQuiz(), [bad]).ok).toBe(false)
  })

  it("documents WHY the builder prompt is not the origination path", () => {
    // If someone ever offers `quiz` to the model again, this fails and points
    // them at the reason rather than letting the budget and the invalid-id
    // problem come back silently.
    expect(NOT_OFFERED_TO_THE_BUILDER.has("quiz")).toBe(true)
  })
})
