// The server half of the conditional-field rule.
//
// The dialog HIDES a field its template does not ask for; this REFUSES it. Both
// read `template.asks`, so they cannot disagree — but only these tests prove
// the refusing half exists at all, and a hidden-but-accepted field is the
// classic version of this bug: it stores state the owner can never see or clear.

import { describe, it, expect } from "vitest"
import { createFunnelSchema } from "@/lib/validators/funnel"
import { MAX_FUNNEL_STEPS } from "@/lib/funnels/templates"

const base = { name: "Camp 2026", slug: "camp-2026", kind: "funnel" as const }
const eventOffer = { kind: "event" as const, ref: "Summer Camp 2026" }

describe("createFunnelSchema — run window", () => {
  it("refuses dates on a template that does not ask for them", () => {
    // MUTANT KILLED: hiding a field in the UI without refusing it on the
    // server. The dialog hides dates for `leads`; without this, a hand-crafted
    // POST sets a run window the owner can never see, edit or clear — and the
    // window closer would eventually take the page offline for it.
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "leads",
      ends_at: "2026-08-15T00:00:00.000Z",
    })
    expect(result.success).toBe(false)
  })

  it("refuses the auto-offline flag on a template with no window", () => {
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "leads",
      auto_offline_at_end: true,
    })
    expect(result.success).toBe(false)
  })

  it("accepts a window on the event template", () => {
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "event",
      offer: eventOffer,
      starts_at: "2026-06-01T00:00:00.000Z",
      ends_at: "2026-08-15T00:00:00.000Z",
      auto_offline_at_end: true,
    })
    expect(result.success).toBe(true)
  })

  it("refuses an end at or before the start", () => {
    // Mirrors the migration's own funnels_run_window_check, so the owner meets
    // this as a message in the dialog rather than a 500 from Postgres.
    for (const ends_at of ["2026-06-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z"]) {
      const result = createFunnelSchema.safeParse({
        ...base,
        template: "event",
        offer: eventOffer,
        starts_at: "2026-06-01T00:00:00.000Z",
        ends_at,
      })
      expect(result.success, ends_at).toBe(false)
    }
  })
})

describe("createFunnelSchema — offer", () => {
  it("refuses an offer whose kind is not the template's catalogue", () => {
    // MUTANT KILLED: accepting any offer once the template asks for one. A
    // program ref on an event funnel resolves against the wrong table and the
    // CTA silently degrades to a placeholder.
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "event",
      offer: { kind: "program", ref: "Off-Season Block" },
    })
    expect(result.success).toBe(false)
  })

  it("refuses an offer on a template that sells nothing", () => {
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "leads",
      offer: { kind: "program", ref: "Off-Season Block" },
    })
    expect(result.success).toBe(false)
  })

  it("accepts the offer from the template's own catalogue", () => {
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "program",
      offer: { kind: "program", ref: "Off-Season Block" },
    })
    expect(result.success).toBe(true)
  })

  it("refuses a ref longer than the CTA target allows", () => {
    // 120 is ctaTargetSchema's own bound. A longer ref would be accepted here
    // and rejected at render, which is the worst place to find out.
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "program",
      offer: { kind: "program", ref: "x".repeat(121) },
    })
    expect(result.success).toBe(false)
  })
})

describe("createFunnelSchema — notify and audience", () => {
  it("refuses recipients on a template that captures no leads", () => {
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "program",
      notify_emails: ["darren@example.com"],
    })
    expect(result.success).toBe(false)
  })

  it("accepts recipients on a lead-capturing template", () => {
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "leads",
      notify_emails: ["darren@example.com"],
    })
    expect(result.success).toBe(true)
  })

  it("refuses something that is not an email", () => {
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "leads",
      notify_emails: ["not-an-email"],
    })
    expect(result.success).toBe(false)
  })

  it("accepts an audience on every template, since every template asks", () => {
    for (const template of ["leads", "program", "event", "booking", "scratch"]) {
      const result = createFunnelSchema.safeParse({
        ...base,
        template,
        audience: "High-school tennis players and their parents",
        ...(template === "program" ? { offer: { kind: "program", ref: "P" } } : {}),
        ...(template === "event" ? { offer: eventOffer } : {}),
      })
      expect(result.success, template).toBe(true)
    }
  })
})

describe("createFunnelSchema — the step plan", () => {
  const step = (slug: string, name = "Step") => ({ name, slug, goal: null })

  it("accepts a plan whose first step is the entry slug", () => {
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "scratch",
      steps: [step("index", "Details"), step("register", "Register")],
    })
    expect(result.success).toBe(true)
  })

  it("refuses a first step that is not the entry slug", () => {
    // MUTANT KILLED: letting the client name the entry step's path. The
    // funnel's address /go/<slug> is served by whichever step is `index`, so a
    // plan starting at `start` creates a funnel whose front door 404s.
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "scratch",
      steps: [step("start")],
    })
    expect(result.success).toBe(false)
  })

  it("refuses duplicate step slugs", () => {
    // Two steps at one path is a unique-constraint 409 the dialog promised
    // would not happen.
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "scratch",
      steps: [step("index"), step("thanks"), step("thanks")],
    })
    expect(result.success).toBe(false)
  })

  it("refuses a step slug the pattern would reject", () => {
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "scratch",
      steps: [step("index"), step("Thank_You")],
    })
    expect(result.success).toBe(false)
  })

  it("refuses an empty plan", () => {
    const result = createFunnelSchema.safeParse({ ...base, template: "scratch", steps: [] })
    expect(result.success).toBe(false)
  })

  it(`refuses more than ${MAX_FUNNEL_STEPS} steps`, () => {
    const steps = Array.from({ length: MAX_FUNNEL_STEPS + 1 }, (_, index) =>
      step(index === 0 ? "index" : `s-${index}`),
    )
    expect(createFunnelSchema.safeParse({ ...base, template: "scratch", steps }).success).toBe(false)
  })

  it(`accepts exactly ${MAX_FUNNEL_STEPS} steps`, () => {
    // The boundary in the other direction — an off-by-one here would refuse a
    // plan the dialog let the owner build.
    const steps = Array.from({ length: MAX_FUNNEL_STEPS }, (_, index) =>
      step(index === 0 ? "index" : `s-${index}`),
    )
    expect(createFunnelSchema.safeParse({ ...base, template: "scratch", steps }).success).toBe(true)
  })

  it("keeps each step's goal", () => {
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "event",
      offer: eventOffer,
      steps: [
        { name: "Details", slug: "index", goal: "event" },
        { name: "Register", slug: "register", goal: "leads" },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.steps?.map((s) => s.goal)).toEqual(["event", "leads"])
  })

  it("defaults a step with no goal to null rather than dropping it", () => {
    const result = createFunnelSchema.safeParse({
      ...base,
      template: "scratch",
      steps: [{ name: "Only", slug: "index" }],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.steps?.[0].goal).toBeNull()
  })
})

describe("createFunnelSchema — what must not change", () => {
  it("still accepts the landing-page body CreatePageDialog sends", () => {
    // MUTANT KILLED: tightening the schema under CreatePageDialog, which sends
    // no template and no steps and is explicitly out of scope for this change.
    const result = createFunnelSchema.safeParse({
      name: "Free Trial Week",
      slug: "free-trial-week",
      kind: "page",
      goal: "leads",
      description: "A page for high-school athletes considering a first block.",
    })
    expect(result.success).toBe(true)
  })

  it("still accepts the bare funnel body the old dialog sent", () => {
    const result = createFunnelSchema.safeParse({
      name: "Camp 2026",
      slug: "camp-2026",
      kind: "funnel",
      description: "Registration flow.",
    })
    expect(result.success).toBe(true)
  })

  it("still reserves the reserved slugs", () => {
    expect(createFunnelSchema.safeParse({ ...base, slug: "admin" }).success).toBe(false)
  })

  it("refuses a template this build does not know", () => {
    expect(createFunnelSchema.safeParse({ ...base, template: "webinar" }).success).toBe(false)
  })
})

describe("createFunnelSchema — landing pages, which have no template", () => {
  const page = { name: "Free Trial", slug: "free-trial", kind: "page" as const, goal: "leads" as const }

  it("accepts an audience on a page", () => {
    // MUTANT KILLED: `asks()` returning false whenever there is no template.
    // A page legitimately names its reader — `funnels.audience` is a plain
    // column the page builder's first prompt reads — and the obvious reading
    // of the asks filter rejected every one of them.
    const result = createFunnelSchema.safeParse({
      ...page,
      audience: "High-school athletes considering a first block",
    })
    expect(result.success).toBe(true)
  })

  it("still refuses a run window on a page", () => {
    // Dates exist only as a thing a funnel TEMPLATE asks for. Loosening the
    // no-template case must not loosen this one too.
    expect(
      createFunnelSchema.safeParse({ ...page, ends_at: "2026-08-15T00:00:00.000Z" }).success,
    ).toBe(false)
  })

  it("still refuses an offer and recipients on a page", () => {
    expect(
      createFunnelSchema.safeParse({ ...page, offer: { kind: "program", ref: "X" } }).success,
    ).toBe(false)
    expect(
      createFunnelSchema.safeParse({ ...page, notify_emails: ["a@b.com"] }).success,
    ).toBe(false)
  })
})
