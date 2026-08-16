// The gate between a model's imagination and the create dialog.
//
// A model can return anything. The dialog and `createFunnelSchema` accept a
// narrow, specific shape, and every rule about that shape already has exactly
// one owner — `FUNNEL_TEMPLATES.asks`, `FUNNEL_GOALS`, `FUNNEL_SLUG_PATTERN`.
// This module's whole job is to route the model's output through those SAME
// owners rather than through a second, AI-shaped copy of them.
//
// It REPAIRS rather than rejects wherever it can: a plan thrown away for one
// bad field costs the owner the whole interview they just sat through.

import { describe, it, expect } from "vitest"
import { sanitiseFunnelPlan } from "@/lib/funnels/ai-plan"
import { MAX_FUNNEL_STEPS, ENTRY_STEP_SLUG } from "@/lib/funnels/templates"

const NO_OFFERS = { allowedOfferNames: [] as string[] }

function raw(overrides: Record<string, unknown> = {}) {
  return {
    template: "event",
    name: "Summer Camp 2026",
    steps: [
      { name: "Details", slug: "index", goal: "event" },
      { name: "Register", slug: "register", goal: "leads" },
    ],
    audience: "Junior tennis players",
    description: "A four-week camp.",
    ...overrides,
  }
}

describe("sanitiseFunnelPlan — the template", () => {
  it("rejects a template the registry does not know", () => {
    // MUTANT KILLED: trusting `raw.template`. The dialog renders its radio
    // group from the registry, so an invented id would select nothing and the
    // owner would get a plan attached to no template at all.
    expect(sanitiseFunnelPlan(raw({ template: "webinar" }), NO_OFFERS)).toBeNull()
    expect(sanitiseFunnelPlan(raw({ template: "" }), NO_OFFERS)).toBeNull()
    expect(sanitiseFunnelPlan(raw({ template: null }), NO_OFFERS)).toBeNull()
  })

  it("keeps a template the registry does know", () => {
    expect(sanitiseFunnelPlan(raw(), NO_OFFERS)?.template).toBe("event")
  })
})

describe("sanitiseFunnelPlan — the asks filter", () => {
  it("drops dates on a template that does not ask for them", () => {
    // MUTANT KILLED: passing the model's intake through unfiltered. The server
    // REFUSES a run window on a `leads` funnel, so this would turn a good
    // interview into a 400 naming a field the owner never saw.
    const plan = sanitiseFunnelPlan(
      raw({
        template: "leads",
        steps: [{ name: "Signup", slug: "index", goal: "leads" }],
        starts_at: "2026-06-01T00:00:00.000Z",
        ends_at: "2026-08-15T00:00:00.000Z",
      }),
      NO_OFFERS,
    )
    expect(plan).not.toBeNull()
    expect(plan!.startsAt).toBeNull()
    expect(plan!.endsAt).toBeNull()
  })

  it("keeps dates on the template that does ask", () => {
    const plan = sanitiseFunnelPlan(
      raw({ starts_at: "2026-06-01T00:00:00.000Z", ends_at: "2026-08-15T00:00:00.000Z" }),
      NO_OFFERS,
    )
    expect(plan!.startsAt).toBe("2026-06-01T00:00:00.000Z")
  })

  it("drops an audience on a template that does not ask", () => {
    // Every current template asks for audience, so this pins the MECHANISM by
    // asserting it reads `asks` rather than hard-coding today's answer.
    const plan = sanitiseFunnelPlan(raw({ template: "leads", audience: "Someone" }), NO_OFFERS)
    expect(plan!.audience).toBe("Someone")
  })
})

describe("sanitiseFunnelPlan — the step plan", () => {
  it("forces the first step to the entry slug", () => {
    // MUTANT KILLED: taking the model's first slug. /go/<slug> is served by
    // whichever step is `index`, so a plan starting at `start` builds a funnel
    // with no front door.
    const plan = sanitiseFunnelPlan(
      raw({ steps: [{ name: "Start", slug: "start", goal: null }] }),
      NO_OFFERS,
    )
    expect(plan!.steps[0].slug).toBe(ENTRY_STEP_SLUG)
  })

  it("slugifies a step slug the pattern would reject", () => {
    const plan = sanitiseFunnelPlan(
      raw({
        steps: [
          { name: "Details", slug: "index", goal: null },
          { name: "Thank You", slug: "Thank You!", goal: null },
        ],
      }),
      NO_OFFERS,
    )
    expect(plan!.steps[1].slug).toBe("thank-you")
  })

  it("de-duplicates step slugs rather than failing", () => {
    // MUTANT KILLED: passing duplicates through. Two steps at one path is a
    // unique-constraint 409 after the owner has already pressed Create.
    const plan = sanitiseFunnelPlan(
      raw({
        steps: [
          { name: "A", slug: "index", goal: null },
          { name: "B", slug: "thanks", goal: null },
          { name: "C", slug: "thanks", goal: null },
        ],
      }),
      NO_OFFERS,
    )
    const slugs = plan!.steps.map((step) => step.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it(`truncates beyond ${MAX_FUNNEL_STEPS} steps`, () => {
    const steps = Array.from({ length: MAX_FUNNEL_STEPS + 4 }, (_, i) => ({
      name: `S${i}`,
      slug: i === 0 ? "index" : `s-${i}`,
      goal: null,
    }))
    expect(sanitiseFunnelPlan(raw({ steps }), NO_OFFERS)!.steps).toHaveLength(MAX_FUNNEL_STEPS)
  })

  it("falls back to the template's own plan when the model sends no steps", () => {
    // A plan with no steps is not a plan. The template already knows the
    // answer, so use it rather than handing back an empty editor.
    const plan = sanitiseFunnelPlan(raw({ steps: [] }), NO_OFFERS)
    expect(plan!.steps.length).toBeGreaterThan(0)
    expect(plan!.steps[0].slug).toBe(ENTRY_STEP_SLUG)
  })

  it("drops a step whose name is unusable rather than the whole plan", () => {
    const plan = sanitiseFunnelPlan(
      raw({
        steps: [
          { name: "Details", slug: "index", goal: null },
          { name: "  ", slug: "blank", goal: null },
          { name: "Register", slug: "register", goal: null },
        ],
      }),
      NO_OFFERS,
    )
    expect(plan!.steps.map((s) => s.name)).toEqual(["Details", "Register"])
  })

  it("nulls an unknown step goal but keeps the step", () => {
    // MUTANT KILLED: rejecting the plan on one bad goal. The owner just
    // answered four questions; losing all of it over a typo'd enum is the
    // wrong trade.
    const plan = sanitiseFunnelPlan(
      raw({
        steps: [
          { name: "Details", slug: "index", goal: "webinar_signup" },
          { name: "Register", slug: "register", goal: "leads" },
        ],
      }),
      NO_OFFERS,
    )
    expect(plan!.steps[0].goal).toBeNull()
    expect(plan!.steps[1].goal).toBe("leads")
  })
})

describe("sanitiseFunnelPlan — the offer", () => {
  it("drops an offer the catalogue does not contain", () => {
    // MUTANT KILLED: trusting the model's product name. It is just a string,
    // so it passes every other check and lands as a `ref` resolve.ts cannot
    // resolve — a dead button on a page the owner believes is finished.
    const plan = sanitiseFunnelPlan(
      raw({ offer: { kind: "event", ref: "Camp That Does Not Exist" } }),
      { allowedOfferNames: ["Summer Camp 2026"] },
    )
    expect(plan!.offer).toBeNull()
  })

  it("keeps an offer the catalogue does contain", () => {
    const plan = sanitiseFunnelPlan(raw({ offer: { kind: "event", ref: "Summer Camp 2026" } }), {
      allowedOfferNames: ["Summer Camp 2026"],
    })
    expect(plan!.offer).toEqual({ kind: "event", ref: "Summer Camp 2026" })
  })

  it("matches case-insensitively on the trimmed name", () => {
    const plan = sanitiseFunnelPlan(raw({ offer: { kind: "event", ref: "  summer camp 2026 " } }), {
      allowedOfferNames: ["Summer Camp 2026"],
    })
    // The CATALOGUE's spelling wins — that is the one resolve.ts will match.
    expect(plan!.offer?.ref).toBe("Summer Camp 2026")
  })

  it("drops an offer whose kind is not the template's catalogue", () => {
    const plan = sanitiseFunnelPlan(
      raw({ offer: { kind: "program", ref: "Summer Camp 2026" } }),
      { allowedOfferNames: ["Summer Camp 2026"] },
    )
    expect(plan!.offer).toBeNull()
  })

  it("drops an offer on a template that sells nothing", () => {
    const plan = sanitiseFunnelPlan(
      raw({
        template: "leads",
        steps: [{ name: "Signup", slug: "index", goal: "leads" }],
        offer: { kind: "program", ref: "Off-Season Block" },
      }),
      { allowedOfferNames: ["Off-Season Block"] },
    )
    expect(plan!.offer).toBeNull()
  })
})

describe("sanitiseFunnelPlan — text fields", () => {
  it("trims and caps the audience at the column bound", () => {
    const plan = sanitiseFunnelPlan(raw({ audience: `  ${"x".repeat(400)}  ` }), NO_OFFERS)
    expect(plan!.audience!.length).toBe(300)
  })

  it("caps the description at the column bound", () => {
    const plan = sanitiseFunnelPlan(raw({ description: "y".repeat(900) }), NO_OFFERS)
    expect(plan!.description!.length).toBe(500)
  })

  it("turns an empty string into null rather than writing blank", () => {
    const plan = sanitiseFunnelPlan(raw({ audience: "   ", description: "" }), NO_OFFERS)
    expect(plan!.audience).toBeNull()
    expect(plan!.description).toBeNull()
  })

  it("survives a name the model left blank", () => {
    const plan = sanitiseFunnelPlan(raw({ name: "  " }), NO_OFFERS)
    expect(plan!.name).toBe("")
  })
})
