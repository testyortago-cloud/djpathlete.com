// lib/funnels/connections.ts — "what leads where", for one funnel.
//
// THE DEFECT THIS MODULE EXISTS FOR: nothing in the product could answer that
// question, so nothing could tell the owner their pages were not joined up. A
// probe of a real funnel found six CTAs — three in-page anchors, one program,
// one booking, one /contact — and ZERO links to another page, with the form set
// to show a message. Every page was built and none of them led anywhere.
//
// The rule that carries the most weight here is the smallest: `href: "/"` is
// NOT SET. `blankValueFor` in fields.ts creates every new button with that
// target and its own comment calls it "obviously a placeholder rather than a
// dead link to somewhere real". If this module reported it as a destination,
// an unwired button would look wired and `autoConnectOps` would have nothing
// to key on.
import { describe, it, expect } from "vitest"
import type { Section, SectionDoc } from "@/lib/funnels/sections/registry"
import { applyOps } from "@/lib/funnels/sections/apply"
import { autoConnectOps, funnelConnections, type StepWithDoc } from "@/lib/funnels/connections"

function docOf(sections: Section[]): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections,
  } as SectionDoc
}

/** A one-hero page whose primary CTA points wherever the test says. */
function heroWith(target: unknown): SectionDoc {
  return docOf([
    {
      id: "he1",
      kind: "hero",
      variant: "centered",
      style: {},
      props: { headline: "Camp", primaryCta: { label: "Get my spot", target } },
    } as Section,
  ])
}

/** A one-form page. `fields` has `.min(1)`, so it carries a real field. */
function formWith(props: Record<string, unknown>): SectionDoc {
  return docOf([
    {
      id: "fo1",
      kind: "form",
      variant: "split",
      style: {},
      props: {
        formKey: "optin",
        fields: [{ name: "email", label: "Email", type: "email" }],
        ...props,
      },
    } as Section,
  ])
}

/**
 * A two-page funnel. The FIRST page carries `doc`; the second is empty.
 *
 * Two pages, not one, because "is this a dead end?" is only a real question
 * when there is somewhere else to go — and because the last page must never be
 * called a dead end, which needs a last page distinct from the first.
 */
const twoPages = (doc: SectionDoc | null): StepWithDoc[] => [
  { id: "s1", name: "Opt-in", slug: "index", position: 0, isEntry: true, doc },
  { id: "s2", name: "Thanks", slug: "thanks", position: 1, isEntry: false, doc: null },
]

describe("funnelConnections — CTA destinations", () => {
  it("reads a step CTA as a connection to that page", () => {
    const result = funnelConnections("camp", twoPages(heroWith({ kind: "step", stepSlug: "thanks" })))
    expect(result.connections).toContainEqual(
      expect.objectContaining({
        fromStepId: "s1",
        sectionId: "he1",
        field: "primaryCta",
        label: "Get my spot",
        via: "cta",
        to: { kind: "step", slug: "thanks", exists: true },
      }),
    )
    expect(result.broken).toEqual([])
  })

  it("marks a step CTA naming no page as broken", () => {
    const result = funnelConnections("camp", twoPages(heroWith({ kind: "step", stepSlug: "nope" })))
    expect(result.broken).toHaveLength(1)
    expect(result.broken[0].to).toEqual({ kind: "step", slug: "nope", exists: false })
  })

  it('href "/" is NOT SET, not a link to the homepage', () => {
    // MUTANT TO KILL: reporting `{kind:"external", href:"/"}`. `/` is
    // `blankValueFor`'s documented placeholder; treating it as a destination
    // makes an unwired button look wired in the rail AND hides it from
    // `autoConnectOps`, which is only allowed to touch what nobody chose.
    const result = funnelConnections("camp", twoPages(heroWith({ kind: "url", href: "/" })))
    expect(result.connections[0].to).toEqual({ kind: "none" })
  })

  it("a real URL is external, not none", () => {
    const result = funnelConnections("camp", twoPages(heroWith({ kind: "url", href: "/contact" })))
    expect(result.connections[0].to).toEqual({ kind: "external", href: "/contact" })
  })

  it("a URL that happens to point into this funnel IS a page link", () => {
    // Someone typed the address by hand before the picker existed. It leads to
    // the same place a step CTA would, so the rail must draw the same arrow —
    // and a typo in it must be as broken as a bad stepSlug.
    const result = funnelConnections("camp", twoPages(heroWith({ kind: "url", href: "/go/camp/thanks" })))
    expect(result.connections[0].to).toEqual({ kind: "step", slug: "thanks", exists: true })
  })

  it("an in-page anchor is its own kind, not a page link and not nothing", () => {
    const result = funnelConnections("camp", twoPages(heroWith({ kind: "anchor", sectionId: "pricing" })))
    expect(result.connections[0].to).toEqual({ kind: "anchor", sectionId: "pricing" })
  })

  it("a program CTA is an offer — a real destination outside the funnel, not broken", () => {
    const result = funnelConnections("camp", twoPages(heroWith({ kind: "program", ref: "Comeback Code" })))
    expect(result.connections[0].to).toEqual({ kind: "offer", what: "Comeback Code" })
    expect(result.broken).toEqual([])
  })

  it("a booking CTA is an offer, because a booking target carries no destination to set", () => {
    // `ctaTargetSchema` is `z.object({ kind: z.literal("booking") })` — no
    // href — and `renderCtaTarget` passes the island only a label. So booking
    // ALWAYS goes to the enquiry page and there is nothing here to wire.
    const result = funnelConnections("camp", twoPages(heroWith({ kind: "booking" })))
    expect(result.connections[0].to).toEqual({ kind: "offer", what: "the booking enquiry" })
  })

  it("finds a CTA nested inside a repeater, not just at the top level", () => {
    const doc = docOf([
      {
        id: "price1",
        kind: "pricing",
        variant: "cards",
        style: {},
        props: {
          plans: [
            {
              name: "Eight weeks",
              price: "$480",
              features: ["Two sessions a week"],
              cta: { label: "Apply", target: { kind: "step", stepSlug: "thanks" } },
            },
          ],
        },
      } as Section,
    ])
    const result = funnelConnections("camp", twoPages(doc))
    // DOTTED, not `plans[0].cta`. This path is fed to `patchForPath`, which
    // splits on "." — resolve.ts's bracket form is for telling a human where a
    // problem is, this one is for addressing a value to write.
    expect(result.connections[0].field).toBe("plans.0.cta")
  })
})

describe("funnelConnections — form destinations", () => {
  it("reads a form redirect inside this funnel as a connection", () => {
    const doc = formWith({ successMode: "redirect", redirectUrl: "/go/camp/thanks" })
    expect(funnelConnections("camp", twoPages(doc)).connections[0]).toMatchObject({
      via: "form",
      label: "Form submit",
      to: { kind: "step", slug: "thanks", exists: true },
    })
  })

  it("a form redirect to the funnel root is the entry page", () => {
    const doc = formWith({ successMode: "redirect", redirectUrl: "/go/camp" })
    expect(funnelConnections("camp", twoPages(doc)).connections[0].to).toEqual({
      kind: "step",
      slug: "index",
      exists: true,
    })
  })

  it("a redirect to ANOTHER funnel is external, not a page of this one", () => {
    // MUTANT TO KILL: matching on "/go/" instead of "/go/<thisFunnelSlug>/".
    // Under that mutant a link to a different funnel's thank-you page would be
    // reported as this funnel's page — and as BROKEN, since the slug is not in
    // this funnel's list, blocking a publish over a link that works.
    const doc = formWith({ successMode: "redirect", redirectUrl: "/go/other-funnel/thanks" })
    expect(funnelConnections("camp", twoPages(doc)).connections[0].to).toEqual({
      kind: "external",
      href: "/go/other-funnel/thanks",
    })
  })

  it("a funnel slug that merely PREFIXES this one is not this funnel", () => {
    // MUTANT TO KILL: `startsWith(base)` without the trailing separator.
    //
    // THE EXAMPLE MATTERS AND THE OBVIOUS ONE DOES NOT WORK. "/go/camp-2026/
    // thanks" survives that mutant — the remainder still contains a "/", so
    // the `rest.includes("/")` guard rejects it anyway and the test passes for
    // a reason its own name does not mention. Verified by running the mutation.
    //
    // "/go/camp-2026" is the case that actually separates them: under the
    // mutant the remainder is "026", which contains no slash, so another
    // funnel's ENTRY page would be reported as a page of this one — and as
    // broken, blocking a publish over a link that works.
    const doc = formWith({ successMode: "redirect", redirectUrl: "/go/camp-2026" })
    expect(funnelConnections("camp", twoPages(doc)).connections[0].to).toEqual({
      kind: "external",
      href: "/go/camp-2026",
    })
  })

  it("a message-only form leads nowhere", () => {
    const doc = formWith({ successMode: "message", successMessage: "Thanks — you're in." })
    expect(funnelConnections("camp", twoPages(doc)).connections[0].to).toEqual({ kind: "none" })
  })

  it("a form with no successMode at all leads nowhere — the schema default is message", () => {
    const doc = formWith({})
    expect(funnelConnections("camp", twoPages(doc)).connections[0].to).toEqual({ kind: "none" })
  })
})

describe("funnelConnections — dead ends", () => {
  it("a page whose only form shows a message is a dead end", () => {
    const doc = formWith({ successMode: "message" })
    expect(funnelConnections("camp", twoPages(doc)).deadEnds).toEqual(["s1"])
  })

  it("the LAST page is never a dead end — it is supposed to end", () => {
    const result = funnelConnections("camp", twoPages(heroWith({ kind: "step", stepSlug: "thanks" })))
    expect(result.deadEnds).toEqual([])
  })

  it("a page with no document at all is a dead end, not a crash", () => {
    expect(funnelConnections("camp", twoPages(null)).deadEnds).toEqual(["s1"])
  })

  it("an offer CTA does not rescue a page from being a dead end", () => {
    // Buying something leaves the funnel. The page still has no onward page,
    // which is what the rail is reporting.
    const doc = heroWith({ kind: "program", ref: "Comeback Code" })
    expect(funnelConnections("camp", twoPages(doc)).deadEnds).toEqual(["s1"])
  })

  it("a BROKEN page link does not count as leading somewhere", () => {
    // MUTANT TO KILL: counting any `to.kind === "step"` as an exit. A page
    // whose only exit is broken is worse than a dead end, not better, and
    // would otherwise be reported as connected.
    const doc = heroWith({ kind: "step", stepSlug: "nope" })
    expect(funnelConnections("camp", twoPages(doc)).deadEnds).toEqual(["s1"])
  })

  it("orders by position, not by array order, when deciding which page is last", () => {
    // MUTANT TO KILL: using the last ARRAY element. The rail sorts, but a
    // caller that hands these over unsorted must not turn the entry page into
    // "the last page" and silence its dead-end warning.
    const unsorted: StepWithDoc[] = [
      { id: "s2", name: "Thanks", slug: "thanks", position: 1, isEntry: false, doc: null },
      { id: "s1", name: "Opt-in", slug: "index", position: 0, isEntry: true, doc: formWith({}) },
    ]
    expect(funnelConnections("camp", unsorted).deadEnds).toEqual(["s1"])
  })

  it("a single-page funnel has no dead ends — a landing page is supposed to end", () => {
    const only: StepWithDoc[] = [
      { id: "s1", name: "Landing", slug: "index", position: 0, isEntry: true, doc: formWith({}) },
    ]
    expect(funnelConnections("camp", only).deadEnds).toEqual([])
  })
})

describe("funnelConnections — robustness", () => {
  it("a document this build does not recognise reports nothing rather than throwing", () => {
    // The rail renders for every page at once, so ONE corrupt draft must not
    // take down navigation for the whole funnel. `resolveDoc` throws on a bad
    // document precisely so publish cannot be unblocked; this module is not a
    // gate, so it does the opposite.
    const junk = { v: 1, engine: "sections", theme: {}, sections: [{ nope: true }] } as unknown as SectionDoc
    expect(() => funnelConnections("camp", twoPages(junk))).not.toThrow()
  })

  it("a funnel with no pages at all is not a crash", () => {
    expect(funnelConnections("camp", [])).toEqual({ connections: [], broken: [], deadEnds: [] })
  })
})

// ---------------------------------------------------------------------------
// autoConnectOps — the repair tool, for funnels that already exist.
//
// IT IS ONLY ALLOWED TO TOUCH WHAT NOBODY CHOSE. There are exactly two such
// things: a CTA still carrying `blankValueFor`'s `{kind:"url", href:"/"}`
// placeholder, and a form left on its `successMode` default. Everything else
// on the page is somebody's decision, including a URL that looks unhelpful.
//
// The refusals are tested harder than the successes, deliberately: a repair
// tool that rewrites a deliberate choice is worse than one that does nothing,
// and "it connected my pages" is easy to notice while "it silently re-pointed
// my buy button" is not.
// ---------------------------------------------------------------------------
describe("autoConnectOps", () => {
  const TARGET = { funnelSlug: "camp", nextStepSlug: "thanks" }

  it("rewires a placeholder button to the next page", () => {
    const plan = autoConnectOps(heroWith({ kind: "url", href: "/" }), TARGET)
    expect(plan.ops).toEqual([
      {
        op: "update_section",
        id: "he1",
        props: {
          primaryCta: { label: "Get my spot", target: { kind: "step", stepSlug: "thanks" } },
        },
      },
    ])
  })

  it("describes every change before it is applied, in the owner's words", () => {
    // The rail shows this list and waits. A repair tool that just acts is one
    // the owner has to diff their own page against afterwards.
    const plan = autoConnectOps(heroWith({ kind: "url", href: "/" }), TARGET)
    expect(plan.changes).toEqual([
      { sectionId: "he1", field: "primaryCta", label: "Get my spot", to: "thanks" },
    ])
  })

  it.each([
    ["a program CTA", { kind: "program", ref: "Comeback Code" }],
    ["a session pack CTA", { kind: "session_pack", ref: "10 Session Pack" }],
    ["an event CTA", { kind: "event", ref: "Summer Camp" }],
    ["a booking CTA", { kind: "booking" }],
    ["an in-page anchor", { kind: "anchor", sectionId: "pricing" }],
    ["a URL somebody actually typed", { kind: "url", href: "/contact" }],
    ["a page link already set", { kind: "step", stepSlug: "index" }],
    ["a page link that is BROKEN — a typo is still a choice", { kind: "step", stepSlug: "nope" }],
  ])("refuses to touch %s", (_label, target) => {
    expect(autoConnectOps(heroWith(target), TARGET)).toEqual({ ops: [], changes: [] })
  })

  it("switches a message-only form to redirect at the next page", () => {
    const plan = autoConnectOps(formWith({ successMode: "message" }), TARGET)
    expect(plan.ops).toEqual([
      {
        op: "update_section",
        id: "fo1",
        // BOTH keys, in one patch. `formIslandSchema`'s superRefine rejects
        // `successMode: "redirect"` with no `redirectUrl`, so writing one
        // without the other would be an op `applyOps` refuses.
        props: { successMode: "redirect", redirectUrl: "/go/camp/thanks" },
      },
    ])
  })

  it("switches a form that has no successMode at all — the default is message", () => {
    expect(autoConnectOps(formWith({}), TARGET).ops).toHaveLength(1)
  })

  it("refuses a form that already redirects somewhere", () => {
    const doc = formWith({ successMode: "redirect", redirectUrl: "/go/camp/somewhere-else" })
    expect(autoConnectOps(doc, TARGET).ops).toEqual([])
  })

  it("refuses a form carrying a redirect URL even if successMode was left behind", () => {
    // Half-configured is still configured. Overwriting the URL here would
    // discard the only evidence of what the owner meant.
    const doc = formWith({ successMode: "message", redirectUrl: "/go/camp/somewhere-else" })
    expect(autoConnectOps(doc, TARGET).ops).toEqual([])
  })

  it("returns nothing when there is nothing to connect, so the button can say so", () => {
    expect(autoConnectOps(heroWith({ kind: "step", stepSlug: "thanks" }), TARGET)).toEqual({
      ops: [],
      changes: [],
    })
  })

  it("rewires a placeholder nested in a repeater", () => {
    const doc = docOf([
      {
        id: "price1",
        kind: "pricing",
        variant: "cards",
        style: {},
        props: {
          plans: [
            {
              name: "Eight weeks",
              price: "$480",
              features: ["Two sessions a week"],
              cta: { label: "Apply", target: { kind: "url", href: "/" } },
            },
          ],
        },
      } as Section,
    ])
    const plan = autoConnectOps(doc, TARGET)
    // The WHOLE `plans` array comes back, one leaf changed — `applyOps` merges
    // props shallow per top-level key, so a `{"plans.0.cta": ...}` patch would
    // invent a key rather than edit the array.
    expect(plan.ops).toHaveLength(1)
    const op = plan.ops[0] as { props: { plans: Array<{ name: string; cta: unknown }> } }
    expect(op.props.plans[0].cta).toEqual({
      label: "Apply",
      target: { kind: "step", stepSlug: "thanks" },
    })
    expect(op.props.plans[0].name).toBe("Eight weeks")
  })

  it("emits ONE op per section even when that section has two placeholders", () => {
    // MUTANT TO KILL: one op per CTA. Two `update_section` ops for the same id
    // in one batch both patch the same top-level key, and the second overwrites
    // the first — so one of the two buttons would silently stay unwired.
    const doc = docOf([
      {
        id: "he1",
        kind: "hero",
        variant: "centered",
        style: {},
        props: {
          headline: "Camp",
          primaryCta: { label: "Get my spot", target: { kind: "url", href: "/" } },
          secondaryCta: { label: "Learn more", target: { kind: "url", href: "/" } },
        },
      } as Section,
    ])
    const plan = autoConnectOps(doc, TARGET)
    expect(plan.ops).toHaveLength(1)
    expect(plan.changes).toHaveLength(2)

    // AND BOTH FIXES ARE IN THAT ONE OP. Asserting only the op count let a
    // second mutant through — a patch that does not accumulate emits exactly
    // one op containing only the LAST button, so the count was right and one
    // button silently stayed unwired. Verified by running that mutation.
    const op = plan.ops[0] as { props: Record<string, { target: unknown }> }
    expect(op.props.primaryCta.target).toEqual({ kind: "step", stepSlug: "thanks" })
    expect(op.props.secondaryCta.target).toEqual({ kind: "step", stepSlug: "thanks" })
  })

  it("the ops it returns are accepted by the REAL applyOps", () => {
    // The op shape is only correct if `applyOps` says so. Asserting on a
    // hand-written object literal is an assertion about a contract, not the
    // contract — which is exactly how this repo shipped a feature whose tests
    // and implementation were wrong in the same direction.
    const doc = heroWith({ kind: "url", href: "/" })
    const result = applyOps(doc, autoConnectOps(doc, TARGET).ops)
    expect(result.ok).toBe(true)
  })

  it("the form ops it returns are accepted by the REAL applyOps", () => {
    const doc = formWith({ successMode: "message" })
    const result = applyOps(doc, autoConnectOps(doc, TARGET).ops)
    expect(result.ok).toBe(true)
  })

  it("applying its ops actually removes the dead end it was reported for", () => {
    // The end-to-end property, and the only one that matters: the rail says
    // this page leads nowhere, the button is pressed, the rail stops saying it.
    const doc = formWith({ successMode: "message" })
    expect(funnelConnections("camp", twoPages(doc)).deadEnds).toEqual(["s1"])

    const applied = applyOps(doc, autoConnectOps(doc, TARGET).ops)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(funnelConnections("camp", twoPages(applied.doc)).deadEnds).toEqual([])
  })
})
