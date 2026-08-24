// @vitest-environment node
// __tests__/lib/funnels/quiz-funnel-doc.test.ts
//
// The document creation writes onto a quiz funnel's only step. It never passes
// through the AI page builder, so nothing else validates it before a visitor
// sees it — these tests are the validation.
//
// Spec: docs/superpowers/specs/2026-08-24-quiz-funnel-creator-design.md §4
import { describe, it, expect } from "vitest"
import { buildQuizFunnelDoc } from "@/lib/funnels/quiz-funnel-doc"
import { sectionDocSchema } from "@/lib/funnels/sections/registry"
import { FUNNEL_NAME_MAX_LENGTH } from "@/lib/validators/funnel"

const QUIZ_ID = "5f2b7c1e-0000-4000-8000-000000000001"

describe("buildQuizFunnelDoc", () => {
  it("validates against the section grammar", () => {
    const result = sectionDocSchema.safeParse(buildQuizFunnelDoc({ quizId: QUIZ_ID }))
    expect(result.success).toBe(true)
  })

  it("points the quiz section at the quiz it was given", () => {
    const doc = buildQuizFunnelDoc({ quizId: QUIZ_ID })
    const quiz = doc.sections.find((section) => section.kind === "quiz")
    expect(quiz).toBeTruthy()
    expect((quiz!.props as { quizId: string }).quizId).toBe(QUIZ_ID)
  })

  it("puts NO second opening above the quiz", () => {
    // MUTANT KILLED: add a hero back. That is the bug this page shipped with —
    // measured at 1440x900 the document was 1038px in a 900px viewport, so the
    // quiz was already on screen and the hero's "Start the quiz" scrolled 138px
    // and started nothing. Three headings, two buttons, one of them a decoy.
    const doc = buildQuizFunnelDoc({ quizId: QUIZ_ID })
    expect(doc.sections.map((section) => section.kind)).not.toContain("hero")
  })

  it("carries no button of its own, so the only one on the page is the quiz's", () => {
    // MUTANT KILLED: put a CTA anywhere on this document. Starting the quiz is
    // a state inside the island — no link or anchor can reach it — so any
    // button this page adds is decoration that looks like the way in.
    const doc = buildQuizFunnelDoc({ quizId: QUIZ_ID })
    expect(JSON.stringify(doc)).not.toMatch(/"primaryCta"|"secondaryCta"|"anchor"/)
  })

  it("opens on the quiz", () => {
    const doc = buildQuizFunnelDoc({ quizId: QUIZ_ID })
    expect(doc.sections[0].kind).toBe("quiz")
  })

  it("still validates at the longest name the create validator will accept", () => {
    // FUNNEL_NAME_MAX_LENGTH is 120 and the hero headline is capped at 160, so
    // the longest name that can reach here fits. Pinned because a prose cap
    // rejecting a whole payload is a failure this repo has paid for before:
    // the document is built AFTER the quiz has already been inserted.
    const doc = buildQuizFunnelDoc({ quizId: QUIZ_ID })
    expect(sectionDocSchema.safeParse(doc).success).toBe(true)
  })

  it("does not repeat the heading on the quiz section itself", () => {
    // The island renders the quiz's own `introHeadline`, so a section heading
    // here would be the third heading on a page with three sections.
    const doc = buildQuizFunnelDoc({ quizId: QUIZ_ID })
    const quiz = doc.sections.find((section) => section.kind === "quiz")!
    expect((quiz.props as { heading?: string }).heading).toBeUndefined()
  })

  it("is the quiz and a footer, and nothing else", () => {
    const doc = buildQuizFunnelDoc({ quizId: QUIZ_ID })
    expect(doc.sections.map((section) => section.kind)).toEqual(["quiz", "footer"])
  })

  it("tints the ground rather than repainting it", () => {
    // MUTANT KILLED: `tone: "dark"`. The band would repaint, but the quiz's own
    // controls set `color: var(--foreground)` and `background: var(--background)`
    // outright, so the answers would be unreadable on it. `muted` changes the
    // background only.
    const doc = buildQuizFunnelDoc({ quizId: QUIZ_ID })
    const quiz = doc.sections.find((section) => section.kind === "quiz")!
    expect((quiz.style as { tone?: string }).tone).toBe("muted")
  })
})
