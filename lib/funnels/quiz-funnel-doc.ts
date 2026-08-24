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
 * THE QUIZ IS THE HERO. There is no hero section above it, and that is the
 * whole design of this page.
 *
 * There used to be one, and it produced a page that failed the only job it
 * has. Measured on the real page at 1440x900: the document was 1038px tall in
 * a 900px viewport, so the quiz was ALREADY on screen; the hero's "Start the
 * quiz" button scrolled 138px and started nothing, because starting is a state
 * inside the island and an anchor cannot reach it. A visitor clicked the one
 * thing labelled "start" and had to go and find a second button called
 * "Start".
 *
 * It also read as three headings saying the same thing — the funnel's, the
 * section's, and the quiz's own `introHeadline` — separated by about 300px of
 * empty white.
 *
 * The island already renders a complete opening: a headline, a sub, and a
 * button that works. Putting a second one above it was the error. So the page
 * is the quiz and a footer, and the only button on it is the one that starts.
 */
export function buildQuizFunnelDoc(input: { quizId: string }): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "quiz1",
        kind: "quiz",
        variant: "boxed",
        // `muted` paints the section's BACKGROUND only — `--surface`, a light
        // tint — and leaves every foreground token alone. That matters: the
        // quiz's own controls set `color: var(--foreground)` and
        // `background: var(--background)` explicitly, so a `dark` tone would
        // repaint the band and leave the answers unreadable inside it. Giving
        // this page real depth means teaching those controls to inherit a tone
        // first, which is shared CSS the form island uses too.
        style: { tone: "muted", pad: "roomy" },
        // NO `heading`. The island renders the quiz's own `introHeadline`, and
        // a section heading above it would put the page straight back to two.
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
