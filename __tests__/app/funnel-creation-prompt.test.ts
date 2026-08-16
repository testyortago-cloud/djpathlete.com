// The first instruction a never-touched step gets.
//
// It is composed from stored columns every time rather than carried in the URL,
// for the reason the edit page already states: a prompt in the query string
// survives a refresh, a share and a back button, and would replay over work the
// owner has since done.
//
// What is new here is that it composes PER STEP. A funnel's steps have
// different jobs, and telling the payment step it is a lead form is the whole
// reason funnel_steps.goal exists.

import { describe, it, expect } from "vitest"
import { creationPrompt } from "@/app/(admin)/admin/funnels/[id]/edit/[stepId]/page"
import type { Funnel, FunnelStep } from "@/types/database"

function funnel(overrides: Partial<Funnel> = {}): Funnel {
  return {
    id: "f1",
    slug: "summer-camp-2026",
    name: "Summer Camp 2026",
    description: null,
    status: "draft",
    kind: "funnel",
    goal: null,
    template: "event",
    audience: null,
    offer_kind: null,
    offer_ref: null,
    starts_at: null,
    ends_at: null,
    auto_offline_at_end: false,
    notify_emails: null,
    created_by: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  }
}

function step(overrides: Partial<FunnelStep> = {}): FunnelStep {
  return {
    id: "s1",
    funnel_id: "f1",
    slug: "index",
    name: "Details",
    position: 0,
    is_entry: true,
    goal: "event",
    seo_title: null,
    seo_description: null,
    og_image_url: null,
    noindex: false,
    project_data: null,
    doc_revision: 0,
    published_version_id: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  } as FunnelStep
}

const SIBLINGS = [
  step({ id: "s1", slug: "index", name: "Details", position: 0, goal: "event" }),
  step({ id: "s2", slug: "register", name: "Register", position: 1, is_entry: false, goal: "leads" }),
  step({ id: "s3", slug: "payment", name: "Payment", position: 2, is_entry: false, goal: "event" }),
  step({ id: "s4", slug: "thank-you", name: "Confirmation", position: 3, is_entry: false, goal: null }),
]

describe("creationPrompt — landing pages must not change", () => {
  it("composes exactly the string it composed before", () => {
    // MUTANT KILLED: rewriting the page prompt while adding the step one.
    // Landing pages are explicitly out of scope for this change, and their
    // first draft is a shipped, tuned behaviour.
    const page = funnel({
      kind: "page",
      template: null,
      goal: "leads",
      name: "Free Trial Week",
      description: "A page for high-school athletes considering a first block.",
    })
    const entry = step({ name: "Landing page", goal: null })

    expect(creationPrompt(page, entry, [entry])).toBe(
      'Build a landing page called "Free Trial Week".\n' +
        "Its job: capture leads — a form that lands in your inbox.\n" +
        "What it is for: A page for high-school athletes considering a first block.",
    )
  })

  it("returns null for a page with no goal, as it always did", () => {
    // Every row created before goals existed. Those pages open the way they
    // always have — blank, waiting for the owner to type.
    const legacy = funnel({ kind: "page", template: null, goal: null })
    expect(creationPrompt(legacy, step({ goal: null }), [])).toBeNull()
  })
})

describe("creationPrompt — funnel steps", () => {
  it("names the step's position in the sequence and its siblings", () => {
    const prompt = creationPrompt(funnel(), SIBLINGS[1], SIBLINGS)!
    expect(prompt).toContain('step 2 of 4')
    expect(prompt).toContain('"Summer Camp 2026"')
    expect(prompt).toContain("Details, Register, Payment, Confirmation")
  })

  it("prefers the step's own goal over the funnel's", () => {
    // MUTANT KILLED: reading funnel.goal for steps too. On this funnel that is
    // null, so every step would draft as a generic page — and on a funnel that
    // did carry one, the payment step would be told it is a lead form.
    const prompt = creationPrompt(funnel({ goal: "leads" }), SIBLINGS[2], SIBLINGS)!
    expect(prompt).toContain("fill an event")
    expect(prompt).not.toContain("a form that lands in your inbox")
  })

  it("gives a goalless step the sequence context but no job line", () => {
    const prompt = creationPrompt(funnel(), SIBLINGS[3], SIBLINGS)!
    expect(prompt).toContain("step 4 of 4")
    expect(prompt).not.toContain("Its job:")
  })

  it("passes the audience through when there is one", () => {
    const prompt = creationPrompt(
      funnel({ audience: "High-school tennis players and their parents" }),
      SIBLINGS[0],
      SIBLINGS,
    )!
    expect(prompt).toContain("High-school tennis players and their parents")
  })

  it("names the linked offer so the CTA has something real to point at", () => {
    // MUTANT KILLED: storing the offer and never mentioning it. The whole
    // reason the picker exists is that resolve.ts stops having to guess at a
    // name the model invented.
    const prompt = creationPrompt(
      funnel({ offer_kind: "event", offer_ref: "Summer Camp 2026" }),
      SIBLINGS[2],
      SIBLINGS,
    )!
    expect(prompt).toContain("Summer Camp 2026")
    expect(prompt.toLowerCase()).toContain("event")
  })

  it("does not mention an offer when none is linked", () => {
    const prompt = creationPrompt(funnel(), SIBLINGS[2], SIBLINGS)!
    expect(prompt.toLowerCase()).not.toContain("the offer is")
  })

  it("returns null for a step with no goal on a funnel with no template", () => {
    // Funnels created before templates. Their steps open blank, exactly as
    // they do today — this feature must not start drafting over old work.
    const legacy = funnel({ template: null })
    expect(creationPrompt(legacy, step({ goal: null }), [])).toBeNull()
  })

  it("still composes for a templated funnel's goalless entry step", () => {
    // A template is enough on its own: the sequence context is worth having
    // even where the step has no job of its own.
    const prompt = creationPrompt(funnel({ template: "scratch" }), step({ goal: null }), [
      step({ goal: null }),
    ])
    expect(prompt).not.toBeNull()
  })
})
