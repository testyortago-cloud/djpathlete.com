// scripts/lib/rpi-landing-doc.ts — the landing page in front of the
// Rotational Performance Index quiz.
//
// Rebuilt from the GHL page at athletequiz.darrenjpaul.com/home-page, whose
// buttons send visitors to a GHL survey with no video. This page sends them to
// the RPI quiz step of the same funnel, where every movement test has a demo
// clip and a "Common mistakes" clip.
//
// WHAT CHANGED FROM THE GHL COPY, AND WHY:
//   - The quiz's own intro says "five movement tests ... no equipment, and four
//     quick questions ... about five minutes". The page says the same. GHL said
//     "3 minutes" in one place and nothing in another.
//   - No athlete count. GHL claimed both "500+ athletes assessed" and "2,400+
//     athletes assessed" on the same page; neither is a number we can stand
//     behind, so the proof strip states what the test is instead.
//   - No "sport-specific action plan". The result is a colour-coded score, a
//     left-against-right map and a profile; the page promises only those.
//   - A "The five tests" section with the real stills from the quiz's own
//     clips, so a visitor sees what they are about to do before they click.
//
// DESIGN NOTES, from looking at the rendered page:
//   - The hero is `image-bg`. `split` gives the image a fixed 16:9 box with no
//     object-fit, which squashed this square photo; `image-bg` covers.
//   - No `theme.font`: "athletic" sets the BODY in a monospace face, which
//     reads as code. The default is the brand's Lexend pair.
//   - The test stills are `steps` cards, whose media is a full-width strip.
//     As `bullets`, the same media is a 3.5rem thumbnail.
//
// Like `lib/funnels/quiz-funnel-doc.ts`, this document never passes through the
// AI page builder, so `__tests__/scripts/rpi-landing-doc.test.ts` parses it
// whole against the section grammar.

import type { SectionDoc } from "@/lib/funnels/sections/registry"

/** The funnel step the landing page's buttons open: the quiz itself. */
export const RPI_QUIZ_STEP_SLUG = "quiz"

const POSTER = (name: string) =>
  `https://firebasestorage.googleapis.com/v0/b/darrenjpaulcom.firebasestorage.app/o/quiz-media%2Frotational-reboot%2F${name}-poster.jpg?alt=media`

const START = {
  label: "Start my free assessment",
  target: { kind: "step" as const, stepSlug: RPI_QUIZ_STEP_SLUG },
}

export function buildRpiLandingDoc(input: { businessName: string }): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "hero",
        kind: "hero",
        variant: "image-bg",
        // `lg`, not `xl`: at `xl` the headline runs to seven lines on a phone.
        style: { tone: "dark", headline: "lg", pad: "roomy" },
        props: {
          eyebrow: "Free assessment for rotational athletes",
          headline: "Find where your swing, serve or strike is losing power",
          sub: "Five movement tests you can do at home with no equipment, and four quick questions. Watch the demo, try each test, score yourself. In about five minutes you get your Rotational Performance Index.",
          media: {
            kind: "image",
            src: "/images/clinics/rotate.webp",
            alt: "An athlete driving off one leg and rotating on a turf field",
            w: 1920,
            h: 1920,
          },
          primaryCta: START,
          secondaryCta: { label: "See the five tests", target: { kind: "anchor", sectionId: "tests" } },
        },
      },
      {
        id: "proof",
        kind: "proof",
        // `strip`: `cards` stacks four tall boxes on a phone, and `stats`
        // wraps 2 x 2 there with a stray divider on the second row.
        variant: "strip",
        style: {},
        props: {
          items: [
            { value: "5", label: "movement tests" },
            { value: "4", label: "quick questions" },
            { value: "5 min", label: "start to finish" },
            { value: "Free", label: "result on screen straight away" },
          ],
        },
      },
      {
        id: "for-you",
        kind: "bullets",
        variant: "list",
        style: { tone: "muted" },
        props: {
          heading: "This is for you if…",
          items: [
            {
              title: "You lose it when it counts",
              body: "Your swing, serve or strike feels strong in training but loses power, control or consistency in competition.",
              icon: "check",
            },
            {
              title: "The energy doesn't transfer",
              body: "You feel a loss of connection when you rotate, as if the power from your legs never fully reaches your arms.",
              icon: "check",
            },
            {
              title: "Your back or hips tire first",
              body: "Your lower back or hips are the first thing to fatigue in a match, a sign your rotational chain is compensating.",
              icon: "check",
            },
            {
              title: "You coach or parent an athlete",
              body: "The skill is there, but the speed and power their training should deliver isn't showing up on the field or court.",
              icon: "check",
            },
            {
              title: "Conditioning hasn't fixed it",
              body: "You've done plenty of conditioning, but nobody has trained the rotational chain that connects your feet to your hands.",
              icon: "check",
            },
          ],
        },
      },
      {
        id: "discover",
        kind: "bullets",
        variant: "cards",
        style: {},
        props: {
          heading: "What you'll find out",
          intro: "Real answers. No generic fitness advice.",
          items: [
            {
              title: "Rotational weakness",
              body: "Where in your rotational chain (hips, core or the stabilisers down your side) force is leaking before it reaches your swing, serve or strike.",
              icon: "bolt",
            },
            {
              title: "Rotational control",
              body: "Your control across five movement tests, from hip stability to the side chain to whole-body coordination, with your left side scored against your right.",
              icon: "shield",
            },
            {
              title: "Rotational focus",
              body: "Which gap to close first, so the work you do next goes where it changes your output the most.",
              icon: "arrow",
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
          heading: "Five tests, four questions, one clear answer",
          intro: "Built for tennis, golf, baseball, softball, soccer, pickleball and every sport where you rotate to produce power.",
          steps: [
            {
              title: "Do the five movement tests",
              body: "Watch the demo, try the movement, and score yourself out of three. Unsure? Switch to the “Common mistakes” clip before you answer.",
            },
            {
              title: "Answer four quick questions",
              body: "Your sport, how you train, and where you feel it after a hard session.",
            },
            {
              title: "Get your RPI",
              body: "A score out of 100, colour-coded from red to green, with a map of your left side against your right.",
            },
          ],
        },
      },
      {
        id: "tests",
        kind: "steps",
        variant: "cards",
        // `narrow` gives three columns on desktop, so five cards land 3 + 2
        // instead of 4 + 1 with an orphan.
        style: { width: "narrow" },
        props: {
          heading: "The five tests",
          intro: "Each test has a short demo clip and a “Common mistakes” clip, so you know what a clean rep looks like before you score it. Four of them are scored on each side.",
          steps: [
            {
              title: "Prone hip abduction",
              body: "Face down, turn the leg out and lift it away. Shows whether your hips hold still while the leg works.",
              media: { src: POSTER("1-prone-hip-abduction"), alt: "Darren demonstrating the prone hip abduction" },
            },
            {
              title: "Rocking hollow",
              body: "Rock on your back like the bottom of a bowl. Shows whether your midsection stays braced.",
              media: { src: POSTER("2-rocking-hollow"), alt: "Darren demonstrating the rocking hollow" },
            },
            {
              title: "Short lever Copenhagen",
              body: "A side plank with the top leg supported. Shows the inner-thigh and side chain that steady every rotation.",
              media: { src: POSTER("3-short-lever-copenhagen"), alt: "Darren setting up the short lever Copenhagen" },
            },
            {
              title: "Windshield wipers",
              body: "Lower straight legs from side to side with your shoulders flat. Shows how well you control rotation through the trunk.",
              media: { src: POSTER("4-windshield-wipers"), alt: "Darren demonstrating windshield wipers" },
            },
            {
              title: "Retro backwards hop",
              body: "Hop backwards and land balanced. Shows how you control a change of direction.",
              media: { src: POSTER("5-retro-backwards-hop"), alt: "Darren demonstrating the retro backwards hop" },
            },
          ],
        },
      },
      {
        id: "faq",
        kind: "faq",
        variant: "two-col",
        style: { tone: "muted" },
        props: {
          heading: "Questions",
          source: "inline",
          items: [
            {
              q: "Do I need any equipment?",
              a: "No. A clear patch of floor is enough. A mat makes the floor tests more comfortable.",
            },
            { q: "How long does it take?", a: "About five minutes." },
            {
              q: "Is it free?",
              a: "Yes. You enter your name and email at the end, and your result appears on screen straight away.",
            },
            {
              q: "Should I film myself?",
              a: "It helps. Prop your phone up, do the test, and watch it back before you score. It is harder than it looks.",
            },
            {
              q: "I'm a parent or coach. Can I take it for my athlete?",
              a: "Yes. Go through the tests with them and score what you see.",
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
          headline: "Ready to find out what's limiting your rotational output?",
          sub: "Pinpoint where your rotational power breaks down, in about five minutes.",
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
