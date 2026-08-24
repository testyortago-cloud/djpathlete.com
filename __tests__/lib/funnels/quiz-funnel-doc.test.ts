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
    const result = sectionDocSchema.safeParse(buildQuizFunnelDoc({ quizId: QUIZ_ID, heading: "The Athlete Quiz" }))
    expect(result.success).toBe(true)
  })

  it("points the quiz section at the quiz it was given", () => {
    const doc = buildQuizFunnelDoc({ quizId: QUIZ_ID, heading: "The Athlete Quiz" })
    const quiz = doc.sections.find((section) => section.kind === "quiz")
    expect(quiz).toBeTruthy()
    expect((quiz!.props as { quizId: string }).quizId).toBe(QUIZ_ID)
  })

  it("anchors the hero CTA to a section that is actually on the page", () => {
    // MUTANT: change the anchor's sectionId to "quiz". A hero pointing at a
    // section id the page does not contain is a dead button on a live page,
    // which is a failure this repo has already shipped once.
    const doc = buildQuizFunnelDoc({ quizId: QUIZ_ID, heading: "x" })
    const hero = doc.sections.find((section) => section.kind === "hero")!
    const target = (hero.props as { primaryCta: { target: { kind: string; sectionId?: string } } }).primaryCta.target
    expect(target.kind).toBe("anchor")
    expect(doc.sections.map((section) => section.id)).toContain(target.sectionId)
  })

  it("puts the owner's own heading on the page, not a fixed one", () => {
    const doc = buildQuizFunnelDoc({ quizId: QUIZ_ID, heading: "Rotational Reboot" })
    const hero = doc.sections.find((section) => section.kind === "hero")!
    expect((hero.props as { headline: string }).headline).toBe("Rotational Reboot")
  })

  it("still validates at the longest name the create validator will accept", () => {
    // FUNNEL_NAME_MAX_LENGTH is 120 and the hero headline is capped at 160, so
    // the longest name that can reach here fits. Pinned because a prose cap
    // rejecting a whole payload is a failure this repo has paid for before:
    // the document is built AFTER the quiz has already been inserted.
    const doc = buildQuizFunnelDoc({ quizId: QUIZ_ID, heading: "x".repeat(FUNNEL_NAME_MAX_LENGTH) })
    expect(sectionDocSchema.safeParse(doc).success).toBe(true)
  })

  it("does not repeat the heading on the quiz section itself", () => {
    // The island renders the quiz's own `introHeadline`, so a section heading
    // here would be the third heading on a page with three sections.
    const doc = buildQuizFunnelDoc({ quizId: QUIZ_ID, heading: "Rotational Reboot" })
    const quiz = doc.sections.find((section) => section.kind === "quiz")!
    expect((quiz.props as { heading?: string }).heading).toBeUndefined()
  })

  it("orders the page so the quiz is reachable by scrolling, not only by the button", () => {
    const doc = buildQuizFunnelDoc({ quizId: QUIZ_ID, heading: "x" })
    expect(doc.sections.map((section) => section.kind)).toEqual(["hero", "quiz", "footer"])
  })
})
