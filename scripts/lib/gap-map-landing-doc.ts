// scripts/lib/gap-map-landing-doc.ts — the landing page in front of the
// Performance Gap Map quiz (quiz key `rpi_athlete_quiz`, the one already live
// behind /go/athlete-quiz).
//
// Rebuilt from the GHL page at athletequiz.darrenjpaul.com/take-the-quiz, whose
// button opens GHL survey HRi8CrbRKWlYMgVneHlt. That survey and this quiz ask
// the same questions down the same four routes; the difference is that GHL asks
// for name, email, phone and date of birth BEFORE the first question, and this
// quiz asks for a name and email at the end, before the readout.
//
// CHANGED FROM THE GHL COPY:
//   - "12 questions" became "about 12": the four routes are 10 to 13 long.
//   - The four GHL pillars stay, and the page adds who it is for, using the
//     quiz's own four routes, so a visitor recognises their route before
//     the quiz asks.
//
// Same layout lessons as `rpi-landing-doc.ts` (image-bg hero, no "athletic"
// font, `lg` headline for phones, `strip` proof). Checked by
// `__tests__/scripts/funnel-page-docs.test.ts`.

import type { SectionDoc } from "@/lib/funnels/sections/registry"

/** The funnel step the buttons open: the quiz itself. */
export const GAP_MAP_QUIZ_STEP_SLUG = "quiz"

const START = {
  label: "Take the performance gap map",
  target: { kind: "step" as const, stepSlug: GAP_MAP_QUIZ_STEP_SLUG },
}

export function buildGapMapLandingDoc(input: { businessName: string }): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "hero",
        kind: "hero",
        variant: "image-bg",
        style: { tone: "dark", headline: "lg", pad: "roomy" },
        props: {
          eyebrow: "3-minute performance map",
          headline: "Discover what's silently capping your performance",
          sub: "Most athletes train hard. Few train accurately. Answer a few questions about your sport, your training and how your body is holding up, and get a performance gap map built from your answers.",
          media: {
            kind: "image",
            src: "/images/assessment/motion-capture.webp",
            alt: "An athlete mid-bound in a motion-capture lab, markers on every joint",
            w: 1312,
            h: 816,
          },
          primaryCta: START,
          secondaryCta: { label: "How it works", target: { kind: "anchor", sectionId: "how" } },
        },
      },
      {
        id: "proof",
        kind: "proof",
        variant: "strip",
        style: {},
        props: {
          items: [
            { value: "3 min", label: "start to finish" },
            { value: "About 12", label: "questions" },
            { value: "No sign-up", label: "to start" },
            { value: "Free", label: "readout on screen straight away" },
          ],
        },
      },
      {
        id: "who",
        kind: "bullets",
        variant: "grid-2",
        style: { tone: "muted" },
        props: {
          heading: "Built for where you are right now",
          intro: "Your first answer sends you down the questions for your situation.",
          items: [
            {
              title: "You've hit a ceiling",
              body: "You train hard, but the numbers and the results have stopped moving, and you can't say why.",
              icon: "bolt",
            },
            {
              title: "You're coming back from injury",
              body: "You've been cleared, or you're close, but you're not sure the cause was ever fixed.",
              icon: "shield",
            },
            {
              title: "You're a young athlete with big goals",
              body: "You're building toward selection, a scholarship or the next level, and want to build it right.",
              icon: "star",
            },
            {
              title: "You're a parent or coach",
              body: "You want to know where an athlete really stands physically, and what to do about it.",
              icon: "check",
            },
          ],
        },
      },
      {
        id: "pillars",
        kind: "bullets",
        variant: "cards",
        style: {},
        props: {
          heading: "How we look at your performance",
          items: [
            {
              title: "Systems over methods",
              body: "We map your whole training system, not just the exercises in it.",
            },
            {
              title: "Capacity over fatigue",
              body: "More sessions won't fix what the structure of your training won't. We build capacity.",
            },
            {
              title: "Diagnostic precision",
              body: "You can't fix what you've never measured. We look for the exact gap.",
            },
            {
              title: "Individualisation",
              body: "Your readout is built from your answers, not a template.",
            },
          ],
        },
      },
      {
        id: "how",
        kind: "steps",
        variant: "timeline",
        style: { tone: "muted" },
        props: {
          heading: "How it works",
          steps: [
            {
              title: "Answer a few questions",
              body: "About your sport, what you're working toward, how you train, and how your body is holding up.",
            },
            {
              title: "Tell us where to send it",
              body: "Your name and email at the end. Nothing before that.",
            },
            {
              title: "Get your performance gap map",
              body: "A colour-coded readout of where your gaps are, on screen straight away.",
            },
          ],
        },
      },
      {
        id: "faq",
        kind: "faq",
        variant: "two-col",
        style: {},
        props: {
          heading: "Questions",
          source: "inline",
          items: [
            // Three, not four: `two-col` fits three across, and a fourth sat alone.
            // How long it takes is already in the stat strip and the last band.
            { q: "Is it free?", a: "Yes. You enter your name and email at the end, and your readout appears on screen." },
            {
              q: "I'm a parent or coach. Can I take it for an athlete?",
              a: "Yes. Choose “parent or coach” on the first question and answer for the athlete.",
            },
            {
              q: "Do I need to do any tests?",
              a: "No. This one is questions only. If you want a movement screen, ask us about the Rotational Performance Index.",
            },
          ],
        },
      },
      {
        id: "cta",
        kind: "cta",
        variant: "band",
        style: { tone: "dark", pad: "roomy" },
        props: {
          headline: "Find the gap that's holding you back",
          sub: "Three minutes. A readout built from your answers.",
          cta: START,
        },
      },
      {
        id: "foot",
        kind: "footer",
        variant: "simple",
        style: {},
        props: {
          businessName: input.businessName,
          lines: [],
          links: [],
          legal: "All rights reserved.",
        },
      },
    ],
  }
}
