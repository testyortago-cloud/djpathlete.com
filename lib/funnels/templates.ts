// lib/funnels/templates.ts — what each kind of funnel IS.
//
// A template declares two things: the step plan it creates, and which follow-up
// questions that plan needs answered. `asks` IS THE WHOLE CONDITIONAL-FIELDS
// MECHANISM — the create dialog renders a field iff it appears here, and
// `createFunnelSchema` REFUSES a field it omits. One array drives both, so a
// hand-crafted POST cannot put a run window on a lead-capture funnel any more
// than the dialog can, and the two can never drift into disagreeing about what
// an event funnel is allowed to carry.
//
// A CONST, NOT A `funnel_templates` TABLE. The dialog must not be able to offer
// a step goal the section registry cannot resolve: `satisfies` makes that a
// compile error, where a table row makes it a dead CTA discovered in
// production. It is the same reason `FUNNEL_GOALS` exists in the validator, and
// this repo has three logged bugs from restating a rule instead of importing
// the one that decides. The cost is that changing a template is a deploy, which
// is the correct cost for changing what the product means by "an event funnel".
//
// This module is a LEAF: types only, no imports from `lib/db`, `lib/ai` or
// anything with a runtime client. The create dialog is a client component and
// imports it directly.

import type { FunnelGoal, OfferKind } from "@/types/database"

/**
 * The ceiling on a created step plan, enforced again in `createFunnelSchema`.
 * Ten is not a technical limit — `funnel_steps.position` allows 0..200 — it is
 * a claim that a sequence longer than ten steps is a mistake made at creation
 * time rather than a thing to support in a dialog. Steps can still be added
 * afterwards one at a time.
 */
export const MAX_FUNNEL_STEPS = 10

/**
 * The entry step's slug. The funnel's own address `/go/<slug>` is served by
 * this step, which is why `AddStepDialog` refuses it for any later step.
 */
export const ENTRY_STEP_SLUG = "index"

export type TemplateAsk = "audience" | "offer" | "dates" | "notify"

export interface TemplateStep {
  name: string
  /** The first step's slug is ALWAYS `ENTRY_STEP_SLUG` — it is the front door. */
  slug: string
  /** What this step is for. Null when a template gives a step no job. */
  goal: FunnelGoal | null
}

export interface FunnelTemplate {
  value: string
  label: string
  hint: string
  steps: readonly TemplateStep[]
  asks: readonly TemplateAsk[]
  /**
   * Which catalogue the offer picker reads. Non-null exactly when `asks`
   * includes `"offer"` — the registry test enforces the biconditional, because
   * either half alone is a broken field.
   */
  offerKind: OfferKind | null
}

export const FUNNEL_TEMPLATES = [
  {
    value: "leads",
    label: "Capture leads",
    hint: "A form, then a thank-you",
    steps: [
      { name: "Signup", slug: ENTRY_STEP_SLUG, goal: "leads" },
      { name: "Thank you", slug: "thank-you", goal: null },
    ],
    asks: ["audience", "notify"],
    offerKind: null,
  },
  {
    value: "program",
    label: "Sell a program",
    hint: "Pitch, checkout, confirmation",
    steps: [
      { name: "Offer", slug: ENTRY_STEP_SLUG, goal: "program" },
      { name: "Checkout", slug: "checkout", goal: "program" },
      { name: "Confirmation", slug: "thank-you", goal: null },
    ],
    // No `notify`: nothing here captures a lead, and Stripe's receipt is
    // already the notification a sale produces.
    asks: ["audience", "offer"],
    offerKind: "program",
  },
  {
    value: "session_pack",
    label: "Sell a session pack",
    hint: "Pitch, checkout, confirmation",
    steps: [
      { name: "Offer", slug: ENTRY_STEP_SLUG, goal: "session_pack" },
      { name: "Checkout", slug: "checkout", goal: "session_pack" },
      { name: "Confirmation", slug: "thank-you", goal: null },
    ],
    asks: ["audience", "offer"],
    offerKind: "session_pack",
  },
  {
    value: "event",
    label: "Fill an event or camp",
    hint: "Details, register, pay, confirm",
    steps: [
      { name: "Details", slug: ENTRY_STEP_SLUG, goal: "event" },
      // The register step captures the athlete's details BEFORE payment, which
      // is why this template is the four-step one and why it asks who to notify.
      { name: "Register", slug: "register", goal: "leads" },
      { name: "Payment", slug: "payment", goal: "event" },
      { name: "Confirmation", slug: "thank-you", goal: null },
    ],
    asks: ["audience", "offer", "dates", "notify"],
    offerKind: "event",
  },
  {
    value: "booking",
    label: "Book a consult",
    hint: "Pitch, pick a time, confirm",
    steps: [
      { name: "Pitch", slug: ENTRY_STEP_SLUG, goal: "booking" },
      { name: "Book a time", slug: "book", goal: "booking" },
      { name: "Confirmation", slug: "thank-you", goal: null },
    ],
    // No `notify`: the booking flow owns its own confirmations, and no step
    // here has goal `leads`.
    asks: ["audience"],
    offerKind: null,
  },
  {
    value: "scratch",
    label: "Start from scratch",
    hint: "One step, no assumptions",
    // Today's behaviour, kept reachable. Removing it would take away the thing
    // people currently do.
    steps: [{ name: "Step 1", slug: ENTRY_STEP_SLUG, goal: null }],
    asks: ["audience"],
    offerKind: null,
  },
] as const satisfies readonly FunnelTemplate[]

export type FunnelTemplateId = (typeof FUNNEL_TEMPLATES)[number]["value"]

/**
 * The template a funnel names, or null.
 *
 * RETURNS NULL RATHER THAN THROWING for an id this build does not know, and
 * that is deliberate: `funnels.template` has no CHECK constraint (migration
 * 00210 says why), so a row created before a template was retired will name one
 * that no longer exists. Every caller already handles null — a funnel with no
 * template is the pre-2026-08-16 case and behaves exactly as it always did.
 */
export function getTemplate(id: string | null | undefined): FunnelTemplate | null {
  if (!id) return null
  return FUNNEL_TEMPLATES.find((template) => template.value === id) ?? null
}

/** Does this template ask for `ask`? An unknown template asks for nothing. */
export function templateAsks(id: string | null | undefined, ask: TemplateAsk): boolean {
  return getTemplate(id)?.asks.includes(ask) ?? false
}
