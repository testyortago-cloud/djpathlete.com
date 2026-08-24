// lib/funnels/quiz-funnel-doc.ts — what a quiz funnel's page IS.
//
// THE SAME THREE SECTIONS `scripts/seed-athlete-quiz-funnel.ts` PUBLISHES.
// That script's header explains why it runs the real publish sequence rather
// than hand-writing a node tree: a page assembled a different way from the real
// one proves nothing about the real one. The same argument rules out having two
// definitions of what a quiz page is, so this module is the one and the script
// is free to be rewritten against it.
//
// THIS DOCUMENT NEVER PASSES THROUGH THE AI PAGE BUILDER. Every other template
// creates empty steps and the builder fills them, which means the builder's own
// validation stands between the model and a visitor. Here creation writes the
// page directly, so `quiz-funnel-doc.test.ts` is the only thing checking it
// against the grammar — which is why that file asserts the whole document
// parses rather than spot-checking one field.
//
// A LEAF: types only. The create route is a server route and the tests are
// pure; neither should drag a database client in to ask what a page looks like.
//
// Spec: docs/superpowers/specs/2026-08-24-quiz-funnel-creator-design.md §4

import type { SectionDoc } from "@/lib/funnels/sections/registry"

/**
 * The quiz section's id, referenced twice: once as the section's own id and
 * once as the hero button's anchor. A typed-out second copy is how a hero ends
 * up pointing at a section the page does not contain — a button that does
 * nothing, on a live page, with nothing failing.
 */
const QUIZ_SECTION_ID = "quiz1"

export function buildQuizFunnelDoc(input: { quizId: string; heading: string }): SectionDoc {
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
        props: {
          eyebrow: "A few minutes",
          // The funnel's own name. `FUNNEL_NAME_MAX_LENGTH` is 120 and the hero
          // headline is capped at 160, so the longest name the create validator
          // accepts still fits — a prose cap rejecting the whole document here
          // would be discovered AFTER the quiz row had already been inserted.
          headline: input.heading,
          sub: "Answer a few questions about your sport and how your body is holding up. You will get a readout of where the gaps are.",
          primaryCta: {
            label: "Start the quiz",
            target: { kind: "anchor", sectionId: QUIZ_SECTION_ID },
          },
        },
      },
      {
        id: QUIZ_SECTION_ID,
        kind: "quiz",
        variant: "boxed",
        style: {},
        // NO `heading` HERE. The island renders the quiz's own
        // `introHeadline`, and the hero above already carries the name, so a
        // section heading would be the third heading on a three-section page.
        props: {
          quizId: input.quizId,
          submitLabel: "See my result",
        },
      },
      {
        id: "foot1",
        kind: "footer",
        variant: "simple",
        style: {},
        props: {
          businessName: "DJP Athlete",
          lines: [],
          links: [],
          legal: "All rights reserved.",
        },
      },
    ],
  }
}
