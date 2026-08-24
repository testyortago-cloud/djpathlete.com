// @vitest-environment node
// __tests__/lib/funnels/sections/quiz-section.test.ts
//
// The `quiz` SECTION kind — the thing that actually puts the quiz island on a
// page.
//
// WHY THIS EXISTS AT ALL. The spec says adding `quiz` to ISLAND_NAMES "offers
// it in the builder automatically". It does not. `reassemble` builds page HTML
// only from `doc.sections`, and page CSS only from
// `SECTION_KINDS.filter(used).map(k => SECTION_CSS[k])` — so an island reaches
// a page ONLY when a section kind emits it, exactly as `form` emits the form
// island and `faq` the faq island. Without this kind the quiz island is
// unreachable: the builder cannot place it, the publish gate has nothing to
// walk, and no CSS would load.
import { describe, it, expect } from "vitest"
import { SECTION_KINDS, SECTION_REGISTRY, quizSectionPropsSchema } from "@/lib/funnels/sections/registry"
import { SECTION_CSS, THEME_CSS } from "@/lib/funnels/sections/styles"
import { renderSection } from "@/lib/funnels/sections/render"
import { ISLAND_ATTR } from "@/lib/funnels/islands"

const QUIZ_ID = "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9"

function quizSection(props: Record<string, unknown> = {}) {
  return {
    id: "q1",
    kind: "quiz" as const,
    variant: "boxed",
    style: {},
    props: { quizId: QUIZ_ID, heading: "Find your gaps", ...props },
  }
}

describe("the quiz section kind", () => {
  it("is registered, so the builder can place it", () => {
    expect(SECTION_KINDS).toContain("quiz")
    expect(SECTION_REGISTRY.quiz.kind).toBe("quiz")
    expect(SECTION_REGISTRY.quiz.propsSchema).toBe(quizSectionPropsSchema)
  })

  it("carries the island's own props, not a restatement of them", () => {
    // Intersected with quizIslandSchema verbatim, the way formSectionPropsSchema
    // intersects formIslandSchema: the section must accept exactly what the
    // island component reads, or the two drift.
    const parsed = quizSectionPropsSchema.safeParse({
      quizId: QUIZ_ID,
      heading: "Find your gaps",
      sub: "Three minutes.",
      submitLabel: "See my result",
    })
    expect(parsed.success).toBe(true)
  })

  it("rejects a section whose quizId is not a uuid", () => {
    expect(quizSectionPropsSchema.safeParse({ quizId: "rpi_athlete_quiz" }).success).toBe(false)
  })

  it("renders the quiz island, carrying the quiz id through", () => {
    const html = renderSection(quizSection(), {})
    expect(html).toContain(`${ISLAND_ATTR}="quiz"`)
    expect(html).toContain(QUIZ_ID)
  })

  it("renders the heading it was given", () => {
    expect(renderSection(quizSection(), {})).toContain("Find your gaps")
  })

  it("escapes a heading rather than emitting markup from it", () => {
    const html = renderSection(quizSection({ heading: '<img src=x onerror="alert(1)">' }), {})
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img")
  })

  it("has CSS for every djp- class it emits", () => {
    // The same invariant leadgen.test.ts enforces for islands: markup with no
    // stylesheet behind it renders perfectly valid and completely unstyled.
    const html = renderSection(quizSection({ sub: "Three minutes." }), {})
    const emitted = new Set<string>()
    for (const match of html.matchAll(/class="([^"]+)"/g)) {
      for (const cls of match[1].split(/\s+/)) if (cls.startsWith("djp-")) emitted.add(cls)
    }
    expect(emitted.size).toBeGreaterThan(0)
    // Asserted against what the PAGE actually loads. `reassemble` emits
    // THEME_CSS plus the per-kind CSS of every kind the doc uses, and shared
    // chrome (djp-s, djp-hd, djp-sub) lives in the theme — checking only the
    // per-kind block would fail on classes that are in fact styled.
    const pageCss = `${THEME_CSS}\n${SECTION_CSS.quiz}`
    for (const cls of emitted) {
      expect(pageCss.includes(`.${cls}`), `${cls} is emitted but has no CSS`).toBe(true)
    }
  })
})
