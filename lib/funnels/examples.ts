// lib/funnels/examples.ts — one worked example per template.
//
// The template registry says what the steps ARE. This says what a good one
// LOOKS LIKE — the name someone actually used, who they wrote it for, and the
// description that produced a usable first draft rather than a generic page.
// That last field is the point: `description` seeds every step's first build,
// and the gap between "summer camp" and a real brief is the gap between a draft
// you keep and one you rewrite.
//
// Code, not a table, for the same reason the templates are: an example naming a
// template or a step plan that does not exist should be a compile error, not a
// broken card discovered by the one person it was meant to teach. Its test
// asserts each example's step slugs MATCH the template it claims to
// demonstrate, so the two cannot drift.
//
// `whyItWorks` is one sentence and is the part worth reading. An example
// without it is a filled-in form; with it, it is a reason.

import { FUNNEL_TEMPLATES, type FunnelTemplateId } from "@/lib/funnels/templates"
import { FUNNEL_GOALS } from "@/lib/validators/funnel"
import type { FunnelGoal } from "@/types/database"

export interface FunnelExample {
  template: FunnelTemplateId
  /** What the owner called it. Short — the list is where this is read. */
  name: string
  slug: string
  steps: readonly { name: string; slug: string; goal: FunnelGoal | null }[]
  audience: string
  description: string
  /** One sentence on the decision that makes this work. */
  whyItWorks: string
}

/** The template's own plan, so an example cannot invent a shape. */
function planOf(id: FunnelTemplateId) {
  return FUNNEL_TEMPLATES.find((template) => template.value === id)!.steps
}

export const FUNNEL_EXAMPLES = [
  {
    template: "event",
    name: "Summer Camp 2026",
    slug: "summer-camp-2026",
    steps: planOf("event"),
    audience: "Junior tennis players aged 12-16 and the parent who pays",
    description:
      "A four-week summer camp running weekday mornings at the Riverside courts. Sessions are 90 minutes, capped at 12 players, focused on serve mechanics and match play. Register asks for the parent's name and email, the player's name and age, and a tick to accept the liability waiver — then takes the payment on that same page. Write for the parent, not the player: they are the one filling this in.",
    whyItWorks:
      "The signup is saved before Stripe is called, so a parent who abandons checkout is still a lead you can phone.",
  },
  {
    template: "leads",
    name: "Free Trial Week",
    slug: "free-trial-week",
    steps: planOf("leads"),
    audience: "High-school athletes considering their first structured training block",
    description:
      "A no-payment offer: one week of training, in person, to see whether the coaching fits. The form asks sport, age and current training days so the first reply can be specific. Reply within 24 hours is the promise — say so on the page.",
    whyItWorks:
      "It asks three questions, not ten. Every extra field costs completions, and sport and age are all you need to reply well.",
  },
  {
    template: "program",
    name: "Off-Season Block",
    slug: "off-season-block",
    steps: planOf("program"),
    audience: "Returning clients who train alone between seasons",
    description:
      "An eight-week programme for athletes who already know the movements and train without supervision. Three sessions a week, delivered in the app, with weekly check-ins. Sell it on structure and accountability, not on novelty — these people have trained before.",
    whyItWorks:
      "It names who it is NOT for. A page that tries to sell a self-directed block to a beginner converts neither.",
  },
  {
    template: "session_pack",
    name: "Ten-Session Pack",
    slug: "ten-session-pack",
    steps: planOf("session_pack"),
    audience: "Local clients who want in-person sessions without a monthly commitment",
    description:
      "Ten one-to-one sessions, used whenever suits, no expiry. For people who want coaching in the room but will not sign up to a subscription. Lead on flexibility and on what a session actually contains.",
    whyItWorks:
      "The objection it answers — 'I do not want to be locked in' — is in the first line, not buried in an FAQ.",
  },
  {
    template: "booking",
    name: "Free Consult",
    slug: "free-consult",
    steps: planOf("booking"),
    audience: "People weighing up coaching who have not decided what they need",
    description:
      "A twenty-minute call to work out whether coaching is the right next step, and which kind. No prep needed, no obligation. Say plainly what happens on the call and what they leave with, because the fear is that it is a sales pitch.",
    whyItWorks:
      "It states what the call is NOT. Naming the sales-pitch fear out loud is what gets it booked.",
  },
  {
    template: "quiz",
    name: "Rotational Reboot Check",
    slug: "rotational-reboot-check",
    steps: planOf("quiz"),
    audience: "Rotational athletes — baseball, golf, tennis — who feel something is off but cannot name it",
    // A QUIZ FUNNEL'S PAGE IS WRITTEN AT CREATION, so unlike every other
    // example here this `description` does not seed a page build. It is still
    // the most useful field: it is what the owner should be thinking about
    // while they rewrite the copied questions in the quiz editor.
    description:
      "A short check for rotational athletes. The questions are about how the body moves through a turn, not about training history. The result names one thing to work on and offers an assessment — it does not try to sell a programme to somebody who has not been assessed.",
    whyItWorks:
      "It copies a quiz that already scores and routes, so the only work left is the wording — and the wording is the part only the coach can do.",
  },
  {
    template: "scratch",
    name: "Coach Referral",
    slug: "coach-referral",
    steps: planOf("scratch"),
    audience: "Physios and club coaches who send athletes on",
    description:
      "A single page for referral partners: what kinds of athlete are a good fit, how to send someone over, and what feedback they get back. Not a sales page — a professional one. Plain, specific, no urgency language.",
    whyItWorks:
      "One page, one job. When the sequence would only ever have one step, a funnel is overhead.",
  },
] as const satisfies readonly FunnelExample[]

/** The example for a template, or null. */
export function exampleFor(templateId: string): FunnelExample | null {
  return FUNNEL_EXAMPLES.find((example) => example.template === templateId) ?? null
}

// ---------------------------------------------------------------------------
// LANDING PAGES.
//
// A page is not a one-step funnel and its examples are not one-step funnel
// examples. What varies between pages is the GOAL — the same five values
// `CreatePageDialog` renders and `FUNNEL_GOALS` owns — so there is one worked
// example per goal, and the test asserts the set covers all of them.
//
// The `whyItWorks` line carries more weight here than on the funnel side. A
// funnel example teaches shape, which the step list already shows; a page has
// no shape to show, so the reason IS the lesson.
// ---------------------------------------------------------------------------

export interface PageExample {
  goal: FunnelGoal
  name: string
  slug: string
  audience: string
  description: string
  whyItWorks: string
}

export const PAGE_EXAMPLES = [
  {
    goal: "leads",
    name: "Free Trial Week",
    slug: "free-trial-week",
    audience: "High-school athletes considering their first structured training block",
    description:
      "One week of in-person training, no payment, to see whether the coaching fits. The form asks sport, age and current training days — nothing else — so the first reply can be specific. Promise a reply within 24 hours and say so on the page.",
    whyItWorks:
      "Three form fields, not ten. Every extra field costs completions, and sport and age are all you need to reply well.",
  },
  {
    goal: "booking",
    name: "Free Consult",
    slug: "free-consult",
    audience: "People weighing up coaching who have not decided what they need",
    description:
      "A twenty-minute call to work out whether coaching is the right next step and which kind. No prep, no obligation. Say plainly what happens on the call and what they walk away with.",
    whyItWorks:
      "It names the fear — that this is a sales pitch — instead of hoping nobody has it.",
  },
  {
    goal: "program",
    name: "Off-Season Block",
    slug: "off-season-block",
    audience: "Returning clients who train alone between seasons",
    description:
      "An eight-week programme for athletes who already know the movements and train unsupervised. Three sessions a week in the app, weekly check-ins. Sell structure and accountability, not novelty — these people have trained before.",
    whyItWorks:
      "It says who it is not for, so the people it is not for do not buy it and then churn.",
  },
  {
    goal: "session_pack",
    name: "Ten-Session Pack",
    slug: "ten-session-pack",
    audience: "Local clients who want in-person sessions without a monthly commitment",
    description:
      "Ten one-to-one sessions, used whenever suits, no expiry. For people who want coaching in the room but will not sign up to a subscription. Lead on flexibility and on what a single session actually contains.",
    whyItWorks:
      "The objection it answers is in the first line rather than buried in an FAQ nobody opens.",
  },
  {
    goal: "event",
    name: "Spring Skills Clinic",
    slug: "spring-skills-clinic",
    audience: "Club players aged 14-18 and the parents booking for them",
    description:
      "A one-day clinic on serve mechanics and return position, capped at 16 players. Write for the parent, who is the one paying and reading. Cover date, venue, what to bring, and what a player leaves able to do — then a form that takes the booking and the payment without leaving the page: parent and player details, the waiver to tick, and pay.",
    whyItWorks:
      "A parent who has just read the logistics can pay on the spot, rather than being sent somewhere else to re-type it all.",
  },
] as const satisfies readonly PageExample[]

/** The example for a page goal, or null. */
export function pageExampleFor(goal: string): PageExample | null {
  return PAGE_EXAMPLES.find((example) => example.goal === goal) ?? null
}

/** Every goal the page dialog offers has an example. Asserted in the test. */
export const PAGE_GOALS_COVERED = FUNNEL_GOALS.every((goal) => pageExampleFor(goal.value) !== null)
