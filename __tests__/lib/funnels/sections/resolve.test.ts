// Stage 1.5 of the AI page builder: CTA refs (names) -> real row ids
// (lib/funnels/sections/resolve.ts).
//
// The AI never writes a UUID, so this module is what makes a hallucinated id
// structurally impossible. Two properties matter more than the rest, and are
// pinned hardest below:
//
//   - IDEMPOTENCE. By turn two the doc already holds real ids. An
//     implementation without id-match-first would try to match a uuid against
//     a list of names, find nothing, and mark a perfectly good button
//     unresolved — blocking publish forever. "running resolveDoc on its own
//     output" below is that test.
//
//   - REFERENCE IDENTITY. applyOps guarantees sections the model didn't name
//     come through `===`; resolveDoc runs on the same doc every turn and must
//     not quietly undo that. Every such assertion is `toBe`, never `toEqual`,
//     and each one is paired with an assertion that something DID change — a
//     test that would pass against a function returning its input unchanged
//     has not earned its name.
//
// Zero mocks: `Catalogue` is a plain literal, exactly like the doc fixtures.
import { describe, it, expect } from "vitest"
import {
  ctaWithLabelSchema,
  type CtaWithLabel,
  type Section,
  type SectionDoc,
} from "@/lib/funnels/sections/registry"
import { resolveDoc, publishGate, type Catalogue } from "@/lib/funnels/sections/resolve"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// RFC-9562-conformant ids (version nibble 4, variant nibble 8) — the same
// shape a real row carries, so a test that accidentally depends on "looks like
// a uuid" behaves the way production would.
const PROGRAM_COMEBACK = "11111111-1111-4111-8111-111111111111"
const PROGRAM_ROTATIONAL = "22222222-2222-4222-8222-222222222222"
const PACK_TEN = "33333333-3333-4333-8333-333333333333"
const EVENT_CAMP = "44444444-4444-4444-8444-444444444444"
const DELETED_ID = "99999999-9999-4999-8999-999999999999"

function catalogue(overrides: Partial<Catalogue> = {}): Catalogue {
  return {
    program: [
      { id: PROGRAM_COMEBACK, name: "Comeback Code" },
      { id: PROGRAM_ROTATIONAL, name: "Rotational Reboot" },
    ],
    session_pack: [{ id: PACK_TEN, name: "10 Session Pack" }],
    event: [{ id: EVENT_CAMP, name: "Summer Camp" }],
    ...overrides,
  }
}

function docOf(sections: Section[]): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections,
  }
}

const programCta = (ref: string): CtaWithLabel => ({ label: "Start now", target: { kind: "program", ref } })
const packCta = (ref: string): CtaWithLabel => ({ label: "Buy sessions", target: { kind: "session_pack", ref } })
const eventCta = (ref: string): CtaWithLabel => ({ label: "Register", target: { kind: "event", ref } })
const urlCta: CtaWithLabel = { label: "Learn more", target: { kind: "url", href: "/thanks" } }
const stepCta: CtaWithLabel = { label: "Next", target: { kind: "step", stepSlug: "checkout" } }
const bookingCta: CtaWithLabel = { label: "Book a call", target: { kind: "booking" } }
const anchorCta = (sectionId: string): CtaWithLabel => ({ label: "See pricing", target: { kind: "anchor", sectionId } })

function hero(props: Record<string, unknown>, id = "hero1"): Section {
  return { id, kind: "hero", variant: "centered", style: {}, props: { headline: "Train like an athlete", ...props } }
}

function plan(name: string, cta: CtaWithLabel) {
  return { name, price: "$99", features: ["Everything included"], cta }
}

function pricing(plans: unknown[], id = "price1"): Section {
  return { id, kind: "pricing", variant: "cards", style: {}, props: { plans } }
}

function ctaSection(cta: CtaWithLabel, id = "cta1"): Section {
  return { id, kind: "cta", variant: "band", style: {}, props: { headline: "Ready?", cta } }
}

function footer(links: CtaWithLabel[], id = "foot1"): Section {
  return { id, kind: "footer", variant: "simple", style: {}, props: { businessName: "DJP", lines: [], links } }
}

/** A section with no CTA site anywhere — the reference-identity control. */
function bullets(id = "b1"): Section {
  return {
    id,
    kind: "bullets",
    variant: "cards",
    style: {},
    props: { items: [{ title: "Strength" }, { title: "Speed" }] },
  }
}

// ---------------------------------------------------------------------------
// Test helpers — read a CTA back out of a result doc using the SAME `field`
// path grammar resolveDoc emits, so a test that reads "plans[2].cta" is also
// exercising the claim that "plans[2].cta" is what resolveDoc reported.
// ---------------------------------------------------------------------------

function nodeAt(root: unknown, field: string): unknown {
  let node: unknown = root
  for (const segment of field.split(/[.[\]]+/).filter(Boolean)) {
    if (Array.isArray(node)) node = node[Number(segment)]
    else if (typeof node === "object" && node !== null) node = (node as Record<string, unknown>)[segment]
    else throw new Error(`Cannot descend into ${field} at "${segment}"`)
  }
  return node
}

/** Parses through the registry's own schema, so no cast is needed to read `target`. */
function ctaAt(doc: SectionDoc, sectionId: string, field: string): CtaWithLabel {
  const section = doc.sections.find((s) => s.id === sectionId)
  if (!section) throw new Error(`No section "${sectionId}"`)
  return ctaWithLabelSchema.parse(nodeAt(section.props, field))
}

function refAt(doc: SectionDoc, sectionId: string, field: string): string {
  const target = ctaAt(doc, sectionId, field).target
  if (!("ref" in target)) throw new Error(`Target at ${sectionId}.${field} carries no ref`)
  return target.ref
}

function sectionById(doc: SectionDoc, id: string): Section {
  const section = doc.sections.find((s) => s.id === id)
  if (!section) throw new Error(`No section "${id}"`)
  return section
}

// ---------------------------------------------------------------------------

describe("resolveDoc — every CTA site in the registry", () => {
  it("resolves all four CTA sites: hero primary/secondary, pricing plans[i].cta, cta, footer links[i]", () => {
    const doc = docOf([
      hero({ primaryCta: programCta("Comeback Code"), secondaryCta: eventCta("Summer Camp") }),
      pricing([
        plan("Starter", urlCta),
        plan("Core", programCta("Rotational Reboot")),
        plan("Pro", packCta("10 Session Pack")),
      ]),
      ctaSection(programCta("Comeback Code")),
      footer([programCta("Rotational Reboot"), eventCta("Summer Camp")]),
    ])

    const result = resolveDoc(doc, catalogue())

    expect(result.unresolved).toEqual([])
    expect(result.resolved.map((r) => `${r.sectionId}.${r.field}`)).toEqual([
      "hero1.primaryCta",
      "hero1.secondaryCta",
      "price1.plans[1].cta",
      "price1.plans[2].cta",
      "cta1.cta",
      "foot1.links[0]",
      "foot1.links[1]",
    ])

    // ...and the doc actually holds the ids now. Without these, every
    // assertion above would still pass against a "report but never
    // substitute" implementation.
    expect(refAt(result.doc, "hero1", "primaryCta")).toBe(PROGRAM_COMEBACK)
    expect(refAt(result.doc, "hero1", "secondaryCta")).toBe(EVENT_CAMP)
    expect(refAt(result.doc, "price1", "plans[1].cta")).toBe(PROGRAM_ROTATIONAL)
    expect(refAt(result.doc, "price1", "plans[2].cta")).toBe(PACK_TEN)
    expect(refAt(result.doc, "cta1", "cta")).toBe(PROGRAM_COMEBACK)
    expect(refAt(result.doc, "foot1", "links[0]")).toBe(PROGRAM_ROTATIONAL)
    expect(refAt(result.doc, "foot1", "links[1]")).toBe(EVENT_CAMP)
  })

  it("reports the indexed field path of the exact plan / link slot, not just its section", () => {
    const doc = docOf([
      pricing([plan("A", urlCta), plan("B", urlCta), plan("C", programCta("Comeback Code"))]),
      footer([urlCta, bookingCta, eventCta("Summer Camp")]),
    ])

    const result = resolveDoc(doc, catalogue())

    expect(result.resolved.map((r) => r.field)).toEqual(["plans[2].cta", "links[2]"])
    // Off-by-one guard: the slots the paths name are the ones that changed.
    expect(refAt(result.doc, "price1", "plans[2].cta")).toBe(PROGRAM_COMEBACK)
    expect(refAt(result.doc, "foot1", "links[2]")).toBe(EVENT_CAMP)
  })

  it("carries the matched row's name and the model's original ref on each resolved entry", () => {
    const doc = docOf([hero({ primaryCta: programCta("comeback code") })])

    const result = resolveDoc(doc, catalogue())

    expect(result.resolved).toEqual([
      {
        sectionId: "hero1",
        field: "primaryCta",
        ref: "comeback code",
        id: PROGRAM_COMEBACK,
        name: "Comeback Code",
      },
    ])
  })

  it("populates both arrays for a doc that mixes resolvable and unresolvable targets", () => {
    const doc = docOf([
      hero({ primaryCta: programCta("Comeback Code"), secondaryCta: eventCta("Winter Clinic") }),
      ctaSection(packCta("10 Session Pack")),
      footer([programCta("Nonexistent Program")]),
    ])

    const result = resolveDoc(doc, catalogue())

    expect(result.resolved.map((r) => [r.field, r.id])).toEqual([
      ["primaryCta", PROGRAM_COMEBACK],
      ["cta", PACK_TEN],
    ])
    expect(result.unresolved.map((u) => [u.sectionId, u.field, u.kind, u.reason])).toEqual([
      ["hero1", "secondaryCta", "event", "no_match"],
      ["foot1", "links[0]", "program", "no_match"],
    ])
    // The resolvable ones were substituted; the unresolvable ones kept the
    // name the model wrote, so the island fails validation and degrades to a
    // visible disabled placeholder rather than pointing at a fabricated id.
    expect(refAt(result.doc, "hero1", "primaryCta")).toBe(PROGRAM_COMEBACK)
    expect(refAt(result.doc, "hero1", "secondaryCta")).toBe("Winter Clinic")
    expect(refAt(result.doc, "foot1", "links[0]")).toBe("Nonexistent Program")
  })
})

describe("resolveDoc — targets with no ref", () => {
  it("never touches or reports url / step / anchor / booking targets", () => {
    const source = docOf([
      hero({ primaryCta: urlCta, secondaryCta: programCta("Comeback Code") }),
      ctaSection(bookingCta),
      footer([stepCta, anchorCta("cta1")]),
    ])

    const result = resolveDoc(source, catalogue())

    // Positive half: the ONE ref-carrying target in this doc did resolve.
    expect(result.resolved.map((r) => r.field)).toEqual(["secondaryCta"])
    expect(refAt(result.doc, "hero1", "secondaryCta")).toBe(PROGRAM_COMEBACK)
    // Negative half: nothing else appears in either array...
    expect(result.unresolved).toEqual([])
    expect(result.danglingAnchors).toEqual([])
    // ...and the ref-less CTA nodes are the SAME OBJECTS, including the one
    // sitting next to the ref that DID get rewritten.
    expect(nodeAt(sectionById(result.doc, "hero1").props, "primaryCta")).toBe(urlCta)
    expect(sectionById(result.doc, "cta1")).toBe(sectionById(source, "cta1"))
    expect(sectionById(result.doc, "foot1")).toBe(sectionById(source, "foot1"))
  })
})

describe("resolveDoc — name matching", () => {
  it("matches case- and whitespace-insensitively", () => {
    const doc = docOf([hero({ primaryCta: programCta("  comeback   CODE ") })])

    const result = resolveDoc(doc, catalogue())

    expect(result.unresolved).toEqual([])
    expect(refAt(result.doc, "hero1", "primaryCta")).toBe(PROGRAM_COMEBACK)
  })

  it("falls back to a unique substring match in either direction", () => {
    const shortRef = resolveDoc(docOf([hero({ primaryCta: programCta("Comeback") })]), catalogue())
    const longRef = resolveDoc(docOf([hero({ primaryCta: programCta("The Comeback Code program") })]), catalogue())

    expect(refAt(shortRef.doc, "hero1", "primaryCta")).toBe(PROGRAM_COMEBACK)
    expect(refAt(longRef.doc, "hero1", "primaryCta")).toBe(PROGRAM_COMEBACK)
    expect(shortRef.unresolved).toEqual([])
    expect(longRef.unresolved).toEqual([])
  })

  it("prefers an EXACT name match over a substring match that would be ambiguous", () => {
    // "Pack" is an exact match for row 1 and a substring of both rows. Rule 2
    // must settle it before rule 3 ever runs; an implementation that ran the
    // substring pass first would report `ambiguous` here.
    const packs = catalogue({
      session_pack: [
        { id: PACK_TEN, name: "Pack" },
        { id: DELETED_ID, name: "Pack Plus" },
      ],
    })
    const result = resolveDoc(docOf([ctaSection(packCta("Pack"))]), packs)

    expect(result.unresolved).toEqual([])
    expect(refAt(result.doc, "cta1", "cta")).toBe(PACK_TEN)
  })

  it("resolves a program ref and an event ref with the SAME name against their own catalogues only", () => {
    const shared = catalogue({
      program: [{ id: PROGRAM_COMEBACK, name: "Momentum" }],
      event: [{ id: EVENT_CAMP, name: "Momentum" }],
    })
    const doc = docOf([hero({ primaryCta: programCta("Momentum"), secondaryCta: eventCta("Momentum") })])

    const result = resolveDoc(doc, shared)

    expect(result.unresolved).toEqual([])
    expect(refAt(result.doc, "hero1", "primaryCta")).toBe(PROGRAM_COMEBACK)
    expect(refAt(result.doc, "hero1", "secondaryCta")).toBe(EVENT_CAMP)
  })
})

describe("resolveDoc — unresolvable refs", () => {
  it("reports two rows with the same name as ambiguous, lists both, and leaves the ref alone", () => {
    const twins = catalogue({
      program: [
        { id: PROGRAM_COMEBACK, name: "Comeback Code" },
        { id: PROGRAM_ROTATIONAL, name: "comeback   code" },
      ],
    })
    const doc = docOf([hero({ primaryCta: programCta("Comeback Code") })])

    const result = resolveDoc(doc, twins)

    expect(result.resolved).toEqual([])
    expect(result.unresolved).toHaveLength(1)
    expect(result.unresolved[0].reason).toBe("ambiguous")
    expect(result.unresolved[0].candidates.map((c) => c.id)).toEqual([PROGRAM_COMEBACK, PROGRAM_ROTATIONAL])
    expect(refAt(result.doc, "hero1", "primaryCta")).toBe("Comeback Code")
    expect(result.doc).toBe(doc)
  })

  it("reports an ambiguous SUBSTRING match with only the rows that tied, not the whole catalogue", () => {
    const overlapping = catalogue({
      program: [
        { id: PROGRAM_COMEBACK, name: "Comeback Code" },
        { id: PROGRAM_ROTATIONAL, name: "Comeback Code Pro" },
        { id: DELETED_ID, name: "Totally Unrelated" },
      ],
    })
    const result = resolveDoc(docOf([hero({ primaryCta: programCta("Comeback") })]), overlapping)

    expect(result.unresolved[0].reason).toBe("ambiguous")
    expect(result.unresolved[0].candidates.map((c) => c.id)).toEqual([PROGRAM_COMEBACK, PROGRAM_ROTATIONAL])
  })

  it("offers the ENTIRE catalogue for that kind when nothing matches", () => {
    const cat = catalogue()
    const result = resolveDoc(docOf([hero({ primaryCta: programCta("Kettlebell Bootcamp") })]), cat)

    expect(result.unresolved).toHaveLength(1)
    expect(result.unresolved[0].reason).toBe("no_match")
    expect(result.unresolved[0].candidates).toBe(cat.program)
    expect(result.unresolved[0].candidates.map((c) => c.name)).toEqual(["Comeback Code", "Rotational Reboot"])
  })

  it("returns no_match with an empty candidate list for an empty catalogue, and does not throw", () => {
    const empty = catalogue({ event: [] })
    const doc = docOf([hero({ primaryCta: programCta("Comeback Code"), secondaryCta: eventCta("Summer Camp") })])

    const result = resolveDoc(doc, empty)

    expect(result.unresolved).toEqual([
      {
        sectionId: "hero1",
        field: "secondaryCta",
        ref: "Summer Camp",
        kind: "event",
        reason: "no_match",
        candidates: [],
      },
    ])
    // The program in the same doc still resolved — an implementation that
    // bailed out on the empty list would fail here, not just above.
    expect(refAt(result.doc, "hero1", "primaryCta")).toBe(PROGRAM_COMEBACK)
  })

  it("un-resolves a ref that WAS a real id but whose row has since been deleted", () => {
    // This is why rule 1 asks the catalogue instead of a uuid regex: a
    // shape-only guard would call this "already resolved" and let a button
    // that now points at nothing sail through the publish gate.
    const doc = docOf([hero({ primaryCta: programCta(DELETED_ID) })])

    const result = resolveDoc(doc, catalogue())

    expect(result.resolved).toEqual([])
    expect(result.unresolved[0]).toMatchObject({ ref: DELETED_ID, kind: "program", reason: "no_match" })
    expect(publishGate(result).ok).toBe(false)
  })

  it("never silently resolves an EMPTY ref, even when the catalogue holds exactly one row", () => {
    // `String.includes("")` is true for every string, so an unguarded
    // substring pass would resolve "" to the sole program with full
    // confidence. `ctaTargetSchema.ref` has no `.min`, so "" is reachable.
    const single = catalogue({ program: [{ id: PROGRAM_COMEBACK, name: "Comeback Code" }] })
    const doc = docOf([hero({ primaryCta: programCta("") })])

    const result = resolveDoc(doc, single)

    expect(result.resolved).toEqual([])
    expect(result.unresolved[0]).toMatchObject({ ref: "", reason: "no_match" })
    expect(result.unresolved[0].candidates).toHaveLength(1)
    expect(refAt(result.doc, "hero1", "primaryCta")).toBe("")
  })
})

describe("resolveDoc — idempotence", () => {
  it("running resolveDoc on its own output changes nothing and reports nothing unresolved", () => {
    const cat = catalogue()
    const doc = docOf([
      hero({ primaryCta: programCta("Comeback Code"), secondaryCta: eventCta("Summer Camp") }),
      pricing([plan("Pro", packCta("10 Session Pack"))]),
      footer([programCta("Rotational Reboot")]),
    ])

    const first = resolveDoc(doc, cat)
    const second = resolveDoc(first.doc, cat)

    expect(first.unresolved).toEqual([])
    expect(second.unresolved).toEqual([])
    // Nothing left to substitute, so turn two returns the doc BY REFERENCE.
    expect(second.doc).toBe(first.doc)
    // Turn one DID substitute, so turn one's doc is a new object — otherwise
    // the assertion above would be trivially true.
    expect(first.doc).not.toBe(doc)
    // Same slots, same rows, both turns. Only `ref` differs: on turn two the
    // doc already holds the id, which is exactly what rule 1 matched on.
    expect(second.resolved.map((r) => ({ sectionId: r.sectionId, field: r.field, id: r.id, name: r.name }))).toEqual(
      first.resolved.map((r) => ({ sectionId: r.sectionId, field: r.field, id: r.id, name: r.name })),
    )
    expect(second.resolved.map((r) => r.ref)).toEqual(second.resolved.map((r) => r.id))
    expect(first.resolved.map((r) => r.ref)).toEqual([
      "Comeback Code",
      "Summer Camp",
      "10 Session Pack",
      "Rotational Reboot",
    ])
  })
})

describe("resolveDoc — reference identity", () => {
  it("returns the SAME doc and the SAME sections array when nothing needs substituting", () => {
    const doc = docOf([bullets(), hero({ primaryCta: urlCta }), ctaSection(programCta(PROGRAM_COMEBACK))])

    const result = resolveDoc(doc, catalogue())

    expect(result.doc).toBe(doc)
    expect(result.doc.sections).toBe(doc.sections)
    // Paired positive: the already-resolved id WAS recognised, so this is not
    // simply a function that did nothing.
    expect(result.resolved.map((r) => r.id)).toEqual([PROGRAM_COMEBACK])
  })

  it("rebuilds ONLY the sections whose refs changed, reusing everything else by reference", () => {
    const untouched = bullets()
    const urlOnly = ctaSection(urlCta, "cta2")
    const doc = docOf([untouched, hero({ primaryCta: programCta("Comeback Code") }), urlOnly, footer([bookingCta])])

    const result = resolveDoc(doc, catalogue())

    expect(result.doc).not.toBe(doc)
    expect(result.doc.sections).not.toBe(doc.sections)
    expect(result.doc.theme).toBe(doc.theme)
    // Untouched sections: same objects.
    expect(sectionById(result.doc, "b1")).toBe(untouched)
    expect(sectionById(result.doc, "cta2")).toBe(urlOnly)
    expect(sectionById(result.doc, "foot1")).toBe(sectionById(doc, "foot1"))
    // The one section that changed: a new object, but its non-props fields
    // are still the originals, and its ref really was rewritten.
    const before = sectionById(doc, "hero1")
    const after = sectionById(result.doc, "hero1")
    expect(after).not.toBe(before)
    expect(after.props).not.toBe(before.props)
    expect(after.style).toBe(before.style)
    expect(after.variant).toBe(before.variant)
    expect(refAt(result.doc, "hero1", "primaryCta")).toBe(PROGRAM_COMEBACK)
  })

  it("does not mutate the input doc", () => {
    const doc = docOf([hero({ primaryCta: programCta("Comeback Code") })])

    resolveDoc(doc, catalogue())

    expect(refAt(doc, "hero1", "primaryCta")).toBe("Comeback Code")
  })

  it("rebuilds only the changed element of a plans array, not the whole array", () => {
    const keptPlan = plan("Starter", urlCta)
    const doc = docOf([pricing([keptPlan, plan("Pro", programCta("Comeback Code"))])])

    const result = resolveDoc(doc, catalogue())

    const plans = nodeAt(sectionById(result.doc, "price1").props, "plans")
    expect(Array.isArray(plans)).toBe(true)
    expect((plans as unknown[])[0]).toBe(keptPlan)
    expect(refAt(result.doc, "price1", "plans[1].cta")).toBe(PROGRAM_COMEBACK)
  })

  it("throws on a document that is not a valid SectionDoc rather than reporting a clean result", () => {
    // A clean `unresolved: []` on a corrupt doc would UNBLOCK publish.
    const corrupt = { v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" }, sections: [] }

    expect(() => resolveDoc(corrupt as SectionDoc, catalogue())).toThrow()
  })
})

describe("resolveDoc — dangling anchors", () => {
  it("reports an anchor naming no section in the doc, and says which section holds the dead link", () => {
    const doc = docOf([
      // `primaryCta` points at a section that IS in this doc, so only the
      // other two may be reported — an implementation that flagged every
      // anchor would fail here rather than pass the negative test below.
      hero({ primaryCta: anchorCta("foot1"), secondaryCta: anchorCta("nowhere") }),
      footer([anchorCta("gone")]),
    ])

    const result = resolveDoc(doc, catalogue())

    expect(result.danglingAnchors).toEqual([
      { sectionId: "hero1", field: "secondaryCta", target: "nowhere" },
      { sectionId: "foot1", field: "links[0]", target: "gone" },
    ])
    // A dangling anchor is NOT an unresolved ref — separate arrays, separate
    // severities — and the doc is untouched either way.
    expect(result.unresolved).toEqual([])
    expect(result.resolved).toEqual([])
    expect(result.doc).toBe(doc)
  })

  it("reports nothing when every anchor names a real section", () => {
    const doc = docOf([hero({ primaryCta: anchorCta("foot1") }), footer([anchorCta("hero1")])])

    const result = resolveDoc(doc, catalogue())

    expect(result.danglingAnchors).toEqual([])
  })
})

describe("publishGate", () => {
  it("blocks publish on an unresolved ref and names the slot and the ref", () => {
    const doc = docOf([hero({ primaryCta: programCta("Kettlebell Bootcamp") })])

    const gate = publishGate(resolveDoc(doc, catalogue()))

    expect(gate.ok).toBe(false)
    expect(gate.blockers).toHaveLength(1)
    expect(gate.blockers[0]).toContain("hero1")
    expect(gate.blockers[0]).toContain("primaryCta")
    expect(gate.blockers[0]).toContain("Kettlebell Bootcamp")
    expect(gate.warnings).toEqual([])
  })

  it("distinguishes an ambiguous ref from a missing one in the blocker text", () => {
    const twins = catalogue({
      program: [
        { id: PROGRAM_COMEBACK, name: "Comeback Code" },
        { id: PROGRAM_ROTATIONAL, name: "Comeback Code" },
      ],
    })
    const gate = publishGate(resolveDoc(docOf([hero({ primaryCta: programCta("Comeback Code") })]), twins))

    expect(gate.ok).toBe(false)
    expect(gate.blockers[0]).toContain("matches 2")
  })

  it("uses the human name of the kind, not the enum literal", () => {
    const gate = publishGate(resolveDoc(docOf([ctaSection(packCta("Twenty Pack"))]), catalogue()))

    expect(gate.blockers[0]).toContain("session pack")
    expect(gate.blockers[0]).not.toContain("session_pack")
  })

  it("does NOT block publish on a dangling anchor, but does warn about it", () => {
    const doc = docOf([hero({ primaryCta: programCta("Comeback Code"), secondaryCta: anchorCta("nowhere") })])

    const gate = publishGate(resolveDoc(doc, catalogue()))

    expect(gate.ok).toBe(true)
    expect(gate.blockers).toEqual([])
    expect(gate.warnings).toHaveLength(1)
    expect(gate.warnings[0]).toContain("#nowhere")
  })

  it("passes a fully resolved page with no dead anchors", () => {
    const doc = docOf([hero({ primaryCta: programCta("Comeback Code"), secondaryCta: anchorCta("foot1") }), footer([])])

    const gate = publishGate(resolveDoc(doc, catalogue()))

    expect(gate).toEqual({ ok: true, blockers: [], warnings: [] })
  })
})
