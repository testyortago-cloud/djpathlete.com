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
//   - THE RECOGNITION / OFFER SPLIT. One list used to answer two incompatible
//     questions, and the conflation was a live bug: the moment a row left the
//     "currently valid" set, a page that already referenced it stopped
//     resolving and `publishGate` blocked an owner who had changed nothing.
//     Rule 1 (id) now searches recognition, rules 2-3 (name) search offer, and
//     `candidates` comes from offer. Three mutants, three tests, plus four
//     more in the `loadCatalogues` block for which fetcher feeds which set.
//
// MOCKS: everything that tests `resolveDoc` / `publishGate` / `toCatalogue` is
// mock-free — `Catalogues` is a plain literal, exactly like the doc fixtures.
// The ONE exception is the `loadCatalogues` block at the bottom of this file,
// which substitutes the three DAL modules because the DAL call IS the thing
// under test there (which fetcher feeds which set, with which arguments). It
// uses `vi.doMock` + a scoped dynamic import so the substitution never reaches
// the statically imported `resolveDoc` above, and the stubs are hand-written
// functions, not `vi.fn()` spies. See the comment on that block for why an
// untestable async wrapper was worth this much.
import { describe, it, expect, vi, afterEach } from "vitest"
import {
  ctaWithLabelSchema,
  type CtaWithLabel,
  type Section,
  type SectionDoc,
} from "@/lib/funnels/sections/registry"
import {
  resolveDoc,
  publishGate,
  toCatalogue,
  type Catalogue,
  type Catalogues,
  type ResolvableCtaKind,
} from "@/lib/funnels/sections/resolve"

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

/** One purpose's worth of rows. Fresh arrays and fresh row objects each call. */
function lists(overrides: Partial<Catalogue>): Catalogue {
  const base: Catalogue = {
    program: [
      { id: PROGRAM_COMEBACK, name: "Comeback Code" },
      { id: PROGRAM_ROTATIONAL, name: "Rotational Reboot" },
    ],
    session_pack: [{ id: PACK_TEN, name: "10 Session Pack" }],
    event: [{ id: EVENT_CAMP, name: "Summer Camp" }],
  }
  for (const kind of Object.keys(overrides) as ResolvableCtaKind[]) {
    const rows = overrides[kind]
    if (rows) base[kind] = rows.map((row) => ({ ...row }))
  }
  return base
}

/**
 * Both sets, EQUAL IN CONTENT BUT NOT THE SAME OBJECTS — which is the whole
 * reason `lists()` above copies instead of being called once and reused.
 *
 * Every test written before the recognition/offer split passes one catalogue
 * for both purposes, and that is right: those tests are about MATCHING, and
 * matching against two identical lists is exactly the pre-split behaviour they
 * were written to pin. But if `recognition` and `offer` were literally the same
 * arrays, `expect(candidates).toBe(cat.offer.program)` would be satisfied by an
 * implementation that handed back the RECOGNITION list, and the split's most
 * important reference-identity claim would be untestable. Distinct instances
 * make that assertion a real mutant killer even in the symmetric fixtures.
 *
 * The tests that exercise the split itself build asymmetric `Catalogues`
 * literals by hand — see "the recognition / offer split" below.
 */
function catalogue(overrides: Partial<Catalogue> = {}): Catalogues {
  return { recognition: lists(overrides), offer: lists(overrides) }
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

    const paths = result.resolved.map((r) => `${r.sectionId}.${r.field}`)
    // Every slot, by exact path — an off-by-one in an array index still fails
    // here. Compared as a SET because sibling KEYS of one props object
    // (`primaryCta` vs `secondaryCta`) are emitted in `Object.entries` order,
    // which a jsonb round-trip of `funnel_steps.project_data` can reorder.
    // That is documented as non-contractual in resolve.ts; asserting a
    // sequence across them would pin something the storage layer may change.
    expect(new Set(paths)).toEqual(
      new Set([
        "hero1.primaryCta",
        "hero1.secondaryCta",
        "price1.plans[1].cta",
        "price1.plans[2].cta",
        "cta1.cta",
        "foot1.links[0]",
        "foot1.links[1]",
      ]),
    )
    // CONTRACTUAL, and asserted as a sequence: sections come in document
    // order...
    expect(paths.map((p) => p.split(".")[0])).toEqual([
      "hero1",
      "hero1",
      "price1",
      "price1",
      "cta1",
      "foot1",
      "foot1",
    ])
    // ...and array slots in ascending index order within their section.
    expect(paths.filter((p) => p.startsWith("price1."))).toEqual(["price1.plans[1].cta", "price1.plans[2].cta"])
    expect(paths.filter((p) => p.startsWith("foot1."))).toEqual(["foot1.links[0]", "foot1.links[1]"])

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

  it("does NOT resolve a short catalogue name that merely appears as a coincidental substring of a long ref (\"PT\" / \"Optimal Power\")", () => {
    // "optimal power" contains "pt" as a pure coincidence (o-P-T-imal…), so
    // an unguarded bidirectional substring match would resolve this WITH
    // FULL CONFIDENCE to a completely unrelated product — a live buy button
    // pointing at "PT" when the model wrote "Optimal Power".
    // `MIN_PARTIAL_MATCH_LENGTH` exists to stop exactly this.
    const short = catalogue({ session_pack: [{ id: PACK_TEN, name: "PT" }] })
    const result = resolveDoc(docOf([ctaSection(packCta("Optimal Power"))]), short)

    expect(result.resolved).toEqual([])
    expect(result.unresolved).toHaveLength(1)
    expect(result.unresolved[0].reason).toBe("no_match")
    expect(refAt(result.doc, "cta1", "cta")).toBe("Optimal Power")
  })

  it("does NOT resolve a short ref that merely appears as a coincidental substring of a long catalogue name (mirror direction)", () => {
    // Same bug, opposite side short: `name.includes(needle)` is the
    // identical false positive when the REF is the short string instead of
    // the catalogue row's name. A length floor on "the shorter of the two"
    // must catch both directions, not just the one in the brief's example.
    const long = catalogue({
      program: [
        { id: PROGRAM_COMEBACK, name: "Optimal Power" },
        { id: PROGRAM_ROTATIONAL, name: "Rotational Reboot" },
      ],
    })
    const result = resolveDoc(docOf([hero({ primaryCta: programCta("PT") })]), long)

    expect(result.resolved).toEqual([])
    expect(result.unresolved).toHaveLength(1)
    expect(result.unresolved[0].reason).toBe("no_match")
  })

  it("pins the floor at exactly 4 normalised characters: a 4-char partial ref still resolves...", () => {
    const result = resolveDoc(docOf([hero({ primaryCta: eventCta("Camp") })]), catalogue())

    expect(result.unresolved).toEqual([])
    expect(refAt(result.doc, "hero1", "primaryCta")).toBe(EVENT_CAMP)
  })

  it("...while a 3-char partial ref, one below the floor, does not (boundary pin, not just the constant)", () => {
    const result = resolveDoc(docOf([hero({ primaryCta: eventCta("Cam") })]), catalogue())

    expect(result.resolved).toEqual([])
    expect(result.unresolved).toHaveLength(1)
    expect(result.unresolved[0].reason).toBe("no_match")
  })

  it("a name SHORTER than the floor still resolves by EXACT match — the floor guards rule 3 only, never rule 2", () => {
    // `MIN_PARTIAL_MATCH_LENGTH`'s own doc comment promises "anything
    // genuinely that short should be referenced by its EXACT name (rule 2
    // below), WHICH THIS GUARD DOES NOT TOUCH". That promise is what makes
    // the floor safe to set at 4, and until this test it was pinned by
    // nothing: the floor lives INSIDE the `partial` callback, strictly below
    // the `exact` pass, and hoisting it — a plausible "do the cheap length
    // test first" refactor — leaves every other test in this file green.
    //
    // Not academic. Production carries an ACTIVE session pack literally named
    // "Sid " — three characters once normalised, one below the floor. Hoist
    // the check and every page referencing that pack silently stops
    // resolving, blocked publish, picker of eleven packs.
    //
    // The second row is what makes this non-trivial: "sidhinio" contains
    // "sid", so a one-row catalogue would prove nothing. This can only pass
    // if the EXACT pass settled it — rule 3 is barred by the floor and could
    // not have rescued a broken rule 2 anyway.
    const short = catalogue({
      session_pack: [
        { id: PACK_TEN, name: "Sid " },
        { id: DELETED_ID, name: "Sidhinio" },
      ],
    })

    const result = resolveDoc(docOf([ctaSection(packCta("sid"))]), short)

    expect(result.unresolved).toEqual([])
    expect(result.resolved.map((r) => r.id)).toEqual([PACK_TEN])
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
    // The OFFER array, by reference. `catalogue()` builds recognition and offer
    // as distinct instances with equal content, so this fails against an
    // implementation that hands back the recognition list.
    expect(result.unresolved[0].candidates).toBe(cat.offer.program)
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

  // -------------------------------------------------------------------------
  // Blankness is hazardous from THREE sides, and every one of them fails the
  // same way: not silence, but a CONFIDENT WRONG ANSWER that `publishGate`
  // waves through as `ok: true`. The test above covers a blank REF against a
  // normal catalogue. The three below cover the other three combinations —
  // blank ref vs a blank-ID row (the id pass), a blank-ID row matched by
  // name, and a blank-NAME row matched by nothing at all.
  //
  // Fix round 1 exists because the blank-row-NAME guard shipped with no test
  // at all: deleting its line survived all 28 tests, and the Stage 1.5 report
  // claimed it was covered. These pin behaviour, not lines.
  // -------------------------------------------------------------------------

  it("ignores a catalogue row whose own name is blank instead of tying it against every ref", () => {
    // `needle.includes("")` is true for EVERY ref, so one unguarded
    // blank-named row is a universal tie-breaker: the clean "Comeback" match
    // below turns `ambiguous`, and the orphan ref underneath resolves WRONGLY
    // and confidently to the blank row. Owner-entered `programs.name` makes a
    // blank/whitespace name reachable in a way a blank id is not.
    const withBlank = catalogue({
      program: [
        { id: PROGRAM_COMEBACK, name: "Comeback Code" },
        { id: DELETED_ID, name: "   " },
      ],
    })

    const result = resolveDoc(docOf([hero({ primaryCta: programCta("Comeback") })]), withBlank)

    // The blank row neither wins...
    expect(result.resolved.map((r) => r.id)).toEqual([PROGRAM_COMEBACK])
    expect(refAt(result.doc, "hero1", "primaryCta")).toBe(PROGRAM_COMEBACK)
    // ...nor makes a genuine one-row match ambiguous.
    expect(result.unresolved).toEqual([])

    // And a ref that matches nothing else must come back `no_match` — NOT
    // resolved to the blank row, which is the wrong-substitution half of the
    // same hazard.
    const orphan = resolveDoc(docOf([hero({ primaryCta: programCta("Kettlebell Bootcamp") })]), withBlank)
    expect(orphan.resolved).toEqual([])
    expect(orphan.unresolved[0].reason).toBe("no_match")
  })

  it("never resolves a blank ref by ID either: a row carrying a blank id is not an answer", () => {
    // `"" === ""`. With the blank-ref guard one line BELOW the id pass, this
    // comes back `already_id` — reported as RESOLVED with a green publish
    // gate, doc still holding "". The guard's placement above rule 1 is what
    // this pins; a guard that only covers the name passes reads identically
    // and closes two thirds of the hole.
    const withBlankId = catalogue({
      program: [
        { id: "", name: "Ghost Row" },
        { id: PROGRAM_COMEBACK, name: "Comeback Code" },
      ],
    })

    const result = resolveDoc(docOf([hero({ primaryCta: programCta("") })]), withBlankId)

    expect(result.resolved).toEqual([])
    expect(result.unresolved[0]).toMatchObject({ ref: "", reason: "no_match" })
    expect(publishGate(result).ok).toBe(false)
  })

  it("refuses to substitute a blank row id even when that row's name matches EXACTLY", () => {
    // Writing "" into the doc is the silent-absence bug this module exists to
    // prevent, arriving through the front door: `resolved` non-empty, publish
    // gate GREEN, island pointing at nothing. `no_match` + a picker is
    // strictly better, so a row with no usable id is not a candidate for
    // substitution however well it matches.
    const blankId = catalogue({ program: [{ id: "", name: "Comeback Code" }] })

    const result = resolveDoc(docOf([hero({ primaryCta: programCta("Comeback Code") })]), blankId)

    expect(result.resolved).toEqual([])
    expect(result.unresolved[0]).toMatchObject({ reason: "no_match" })
    // The model's own text survives, so the island degrades visibly instead
    // of pointing at "".
    expect(refAt(result.doc, "hero1", "primaryCta")).toBe("Comeback Code")
    expect(publishGate(result).ok).toBe(false)
  })
})

// ===========================================================================
// THE RECOGNITION / OFFER SPLIT.
//
// One list was doing two incompatible jobs. Recognition answers "is the id
// this page ALREADY COMMITTED TO still a real row?" and must see every row
// that ever existed; offering answers "what may a NEW cta point at?" and must
// see only currently valid rows. `matchRef` puts the seam between rule 1 (id,
// recognition) and rules 2-3 (name, offer), and `candidates` comes from offer.
//
// Three separate mutants, three separate tests, because they are three
// different failures:
//   1. rule 1 searching OFFER          -> untouched pages become unpublishable
//   2. rules 2-3 searching RECOGNITION -> live CTA for a retired product
//   3. candidates from RECOGNITION     -> picker offers last summer's camp
// ===========================================================================

describe("resolveDoc — the recognition / offer split", () => {
  it("resolves an ID against RECOGNITION, so a row that has left the offer set keeps a committed page publishable", () => {
    // MUTANT 1. The camp finished (or was marked completed, or cancelled, or
    // un-published to fix a typo — all four drop it out of
    // `getPublishedEvents`). The doc already holds its REAL id. Judging that
    // id against the offer set is what used to flip `publishGate.ok` to false
    // on a page nobody had touched, showing the owner a raw UUID and a picker
    // of unrelated events, not one of which could fix it.
    const cat: Catalogues = {
      recognition: lists({}),
      offer: lists({ event: [] }),
    }
    const doc = docOf([hero({ primaryCta: eventCta(EVENT_CAMP) })])

    const result = resolveDoc(doc, cat)

    expect(result.unresolved).toEqual([])
    expect(result.resolved).toEqual([
      { sectionId: "hero1", field: "primaryCta", ref: EVENT_CAMP, id: EVENT_CAMP, name: "Summer Camp" },
    ])
    expect(publishGate(result).ok).toBe(true)
    // Nothing to substitute — the doc already held the id — so it comes back
    // by reference, which also proves the resolve came from rule 1 and not
    // from some name pass that happened to land on the same row.
    expect(result.doc).toBe(doc)
  })

  it("does NOT resolve a NAME against recognition — a new commitment is bounded by what the prompt advertised", () => {
    // MUTANT 2. `prompt.ts`'s Block B renders the OFFER set and tells the
    // model those are "the only names a CTA may reference". A name pass over
    // the recognition set would silently accept names the prompt never showed
    // it, and the visible result is a live buy button for a retired product.
    // The right answer is `no_match` plus a picker: loud, actionable, and it
    // cannot reach a published page.
    const cat: Catalogues = {
      recognition: lists({
        program: [
          { id: PROGRAM_COMEBACK, name: "Comeback Code" },
          { id: PROGRAM_ROTATIONAL, name: "Retired Program" },
        ],
      }),
      offer: lists({ program: [{ id: PROGRAM_COMEBACK, name: "Comeback Code" }] }),
    }
    const doc = docOf([
      // Positive control in the SAME doc: a name that IS in the offer set
      // still resolves, so this cannot pass against a gutted matcher that
      // resolves nothing at all.
      hero({ primaryCta: programCta("Comeback Code"), secondaryCta: programCta("Retired Program") }),
    ])

    const result = resolveDoc(doc, cat)

    expect(result.resolved.map((r) => [r.field, r.id])).toEqual([["primaryCta", PROGRAM_COMEBACK]])
    expect(result.unresolved).toHaveLength(1)
    expect(result.unresolved[0]).toMatchObject({
      field: "secondaryCta",
      ref: "Retired Program",
      kind: "program",
      reason: "no_match",
    })
    // The model's own text survives, so the CTA degrades visibly.
    expect(refAt(result.doc, "hero1", "secondaryCta")).toBe("Retired Program")
    expect(publishGate(result).ok).toBe(false)
  })

  it("fills the picker from the OFFER list, never from recognition", () => {
    // MUTANT 3. `candidates` is what an owner is asked to choose from, i.e.
    // where the NEXT commitment is made. Offering the recognition list would
    // let them attach a live register button to a camp that finished last
    // summer — the same bad state the split exists to prevent, arriving from
    // the other direction.
    const cat: Catalogues = {
      recognition: lists({
        event: [
          { id: EVENT_CAMP, name: "Summer Camp" },
          { id: DELETED_ID, name: "Last Year's Camp" },
        ],
      }),
      offer: lists({ event: [{ id: EVENT_CAMP, name: "Summer Camp" }] }),
    }

    const result = resolveDoc(docOf([hero({ primaryCta: eventCta("Kettlebell Jamboree") })]), cat)

    expect(result.unresolved).toHaveLength(1)
    expect(result.unresolved[0].candidates).toBe(cat.offer.event)
    // Content too, not just identity: `toBe` alone would survive someone
    // making `offer` an alias of `recognition` one layer up in `loadCatalogues`.
    expect(result.unresolved[0].candidates.map((c) => c.name)).toEqual(["Summer Camp"])
  })

  it("carries a page across the whole lifecycle: name resolves on turn one, id keeps resolving after the row leaves the offer set", () => {
    // The end-to-end story the split exists for, in one test. Turn one: the
    // owner asks for a register button, the model writes the NAME, it is in
    // the offer set, it resolves and the doc now holds the real id. Later the
    // camp ends. Nothing about the page changed. It must still publish.
    const before = catalogue()
    const first = resolveDoc(docOf([hero({ primaryCta: eventCta("Summer Camp") })]), before)

    expect(first.unresolved).toEqual([])
    expect(refAt(first.doc, "hero1", "primaryCta")).toBe(EVENT_CAMP)

    const after: Catalogues = { recognition: before.recognition, offer: { ...before.offer, event: [] } }
    const second = resolveDoc(first.doc, after)

    expect(second.unresolved).toEqual([])
    expect(second.resolved.map((r) => r.id)).toEqual([EVENT_CAMP])
    expect(publishGate(second).ok).toBe(true)
    expect(second.doc).toBe(first.doc)
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

    const result = resolveDoc(doc, catalogue())

    // Positive half FIRST: something actually resolved, so this isn't
    // trivially satisfied by a stub that returns its input untouched and
    // never substitutes anything at all.
    expect(refAt(result.doc, "hero1", "primaryCta")).toBe(PROGRAM_COMEBACK)
    // Negative half: the CALLER's own doc was never touched.
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

  it("throws on a SECTION that fails its own kind's schema rather than reporting a clean result", () => {
    // A genuinely corrupt section, not merely an empty doc (that case is
    // pinned separately below, because it is a different contract).
    // `heroPropsSchema.headline` is `min(1)` and required, so this hero is
    // invalid while still being walkable — which is the point. Two things
    // depend on the up-front `sectionDocSchema.parse`:
    //   1. a clean `unresolved: []` on a corrupt doc would UNBLOCK publish;
    //   2. the CTA walk is DERIVED — it asks `ctaWithLabelSchema.safeParse`
    //      whether each node is a CTA site, so a schema-invalid CTA node
    //      would answer "no", be walked past, and end up neither substituted
    //      NOR reported: a dead button with `publishGate.ok === true`.
    const corruptSection = {
      v: 1,
      engine: "sections",
      theme: { tone: "light", accent: "accent", radius: "soft" },
      sections: [
        { id: "hero1", kind: "hero", variant: "centered", style: {}, props: { primaryCta: programCta("Comeback Code") } },
      ],
    }

    expect(() => resolveDoc(corruptSection as unknown as SectionDoc, catalogue())).toThrow()
  })

  it("throws on a doc with ZERO sections — deliberate, and Stage 1.7 must know it", () => {
    // Pinned ON PURPOSE, not incidentally: `sectionDocSchema.sections` is
    // `z.array(sectionSchema).min(1)`, so an empty doc is not a valid
    // SectionDoc and resolveDoc rejects it exactly like any other schema
    // violation. CONTRACT, not an oversight: 1.7 must not call resolveDoc on
    // a page whose doc has not been populated yet — it will throw, and the
    // route needs a try/catch rather than a special case here.
    const empty = { v: 1, engine: "sections", theme: { tone: "light", accent: "accent", radius: "soft" }, sections: [] }

    expect(() => resolveDoc(empty as unknown as SectionDoc, catalogue())).toThrow()
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
    // A resolvable CTA rides along in the SAME doc as a positive control: a
    // stub that always returns `{doc: input, resolved: [], unresolved: [],
    // danglingAnchors: []}` would pass the danglingAnchors assertion below
    // for free, so without this the test cannot fail against exactly the
    // gutted implementation the file header warns about.
    const doc = docOf([
      hero({ primaryCta: anchorCta("foot1"), secondaryCta: programCta("Comeback Code") }),
      footer([anchorCta("hero1")]),
    ])

    const result = resolveDoc(doc, catalogue())

    expect(result.danglingAnchors).toEqual([])
    expect(refAt(result.doc, "hero1", "secondaryCta")).toBe(PROGRAM_COMEBACK)
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

    const result = resolveDoc(doc, catalogue())
    // Positive proof this isn't a stub that always reports a clean result
    // regardless of input: the program ref really did resolve to a real
    // row, which is WHY the gate is clean, not merely a coincidence of it.
    expect(result.resolved).toEqual([
      { sectionId: "hero1", field: "primaryCta", ref: "Comeback Code", id: PROGRAM_COMEBACK, name: "Comeback Code" },
    ])
    expect(publishGate(result)).toEqual({ ok: true, blockers: [], warnings: [] })
  })
})

// ===========================================================================
// toCatalogue — pure assembly, tested with plain literals (no DB, no mocks).
// `program` and `session_pack` are both `{id, name}[]`, so nothing STRUCTURAL
// stops the two lists being swapped; `CatalogueRows`' named properties are
// what make that a compile error at the call site, and this block pins that
// `toCatalogue`'s own BODY does not transpose them either.
//
// Two earlier tests here were deleted rather than ported, because each killed
// no mutant: "maps Event.title to name" duplicated an assertion below and is
// tsc-enforced anyway (`events` is typed `{id, title}[]`, so `row.name` will
// not compile), and "passes through empty lists without throwing" asserted
// that `[].map(...)` cannot throw. A test that cannot fail is this repo's
// named dominant defect class; two of them in the block that exists to guard
// against exactly that was not a good trade.
// ===========================================================================

describe("toCatalogue", () => {
  it("puts each fetched list under its own catalogue key, mapping Event.title to name", () => {
    // Each list carries a DISTINGUISHABLE name, which is the only thing that
    // can catch a transposition inside the body. Asserted as one whole-object
    // `toEqual` so an extra or missing key fails too.
    const result = toCatalogue({
      programs: [{ id: "prog-1", name: "Program Row" }],
      sessionPacks: [{ id: "pack-1", name: "Pack Row" }],
      events: [{ id: "event-1", title: "Event Row" }],
    })

    expect(result).toEqual({
      program: [{ id: "prog-1", name: "Program Row" }],
      session_pack: [{ id: "pack-1", name: "Pack Row" }],
      event: [{ id: "event-1", name: "Event Row" }],
    })
  })

  it("preserves list order and handles multiple rows per kind", () => {
    const result = toCatalogue({
      programs: [
        { id: "p1", name: "First" },
        { id: "p2", name: "Second" },
      ],
      sessionPacks: [],
      events: [],
    })

    expect(result.program.map((r) => r.id)).toEqual(["p1", "p2"])
  })
})

// ===========================================================================
// loadCatalogues — THE ONLY MOCKED BLOCK IN THIS FILE, deliberately.
//
// `loadCatalogues` is the thin async DAL wrapper, and "thin" is exactly why it
// needs mocks: there is no pure part left to extract, because the ONLY thing
// it decides is WHICH FETCHER FEEDS WHICH SET. That decision IS the
// recognition/offer split — every line of reasoning in resolve.ts about
// untouched pages going unpublishable cashes out here, in five function
// references — and each half of it can be broken by a one-word edit that
// leaves tsc and every other test in this repo green.
//
// Kept surgical: `vi.doMock` (NOT hoisted `vi.mock`) plus `vi.resetModules()`
// and a scoped dynamic import, so the substitution applies only to the module
// instance these tests import. The `resolveDoc` imported statically at the top
// of this file is untouched and still runs against the real graph — it never
// calls the DAL anyway. The stubs are plain async functions rather than
// `vi.fn()` spies, so what is recorded is visible in the source of the helper
// rather than behind a mock API.
//
// THE FIXTURES ARE MUTATION-DISCRIMINATING BY CONSTRUCTION: every stub returns
// a list that DIFFERS from its opposite number, so "recognition came from the
// wrong fetcher" and "offer came from the wrong fetcher" are each visible in
// the returned ids. A fixture where both fetchers returned the same rows would
// make all four of these tests unfalsifiable — which is exactly how the
// previous version of this block, with one event fetcher, could not have
// caught the status axis at all.
//
// NOTE ON WHAT WAS DELETED HERE. The old block pinned
// `getPublishedEvents({from: new Date(0)})` — the epoch sentinel that was the
// first, partial attempt at recognition. It is gone, and so is that test:
// recognition is now `getEvents({})`, which has no date bound AND no status
// filter, and the epoch call would be strictly worse (it still filtered
// `status = 'published'` and still missed NULL `end_date`). Keeping a test
// that asserted the epoch argument would now be pinning a mutant.
// ===========================================================================

interface EventFilters {
  type?: string
  status?: string
  from?: Date
}

async function loadCataloguesWithStubbedDal() {
  const getEventsCalls: (EventFilters | undefined)[] = []
  const publishedEventsCalls: (EventFilters | undefined)[] = []

  vi.resetModules()
  vi.doMock("@/lib/db/programs", () => ({
    getPrograms: async () => [{ id: "prog-1", name: "Program Row" }],
  }))
  vi.doMock("@/lib/db/session-pack-products", () => ({
    listActiveProducts: async () => [{ id: "pack-active", name: "Active Pack" }],
    listAllProducts: async () => [
      { id: "pack-active", name: "Active Pack" },
      { id: "pack-retired", name: "Retired Pack" },
    ],
  }))
  vi.doMock("@/lib/db/events", () => ({
    getEvents: async (filters?: EventFilters) => {
      getEventsCalls.push(filters)
      return [
        { id: "event-published", title: "Published Event" },
        { id: "event-completed", title: "Completed Event" },
      ]
    },
    getPublishedEvents: async (filters?: EventFilters) => {
      publishedEventsCalls.push(filters)
      return [{ id: "event-published", title: "Published Event" }]
    },
  }))

  const { loadCatalogues } = await import("@/lib/funnels/sections/resolve")
  return { catalogues: await loadCatalogues(), getEventsCalls, publishedEventsCalls }
}

describe("loadCatalogues", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/db/programs")
    vi.doUnmock("@/lib/db/session-pack-products")
    vi.doUnmock("@/lib/db/events")
    vi.resetModules()
  })

  it("builds the RECOGNITION event list from getEvents({}) — every event ever, whatever its status", async () => {
    // MUTANT: `recognition` fed from `getPublishedEvents(...)`, in any of its
    // forms. Four separate things drop an event out of that call — `end_date`
    // passing, `published -> completed`, `published -> cancelled`, and
    // `published -> draft` (whose own comment in lib/db/events.ts says it
    // exists for "un-publish for major edits", i.e. routine work). Any one of
    // them then breaks a page that already points at the event, because the
    // uuid in the doc stops matching a row and then matches no name either.
    // The stub returns TWO events from getEvents and ONE from
    // getPublishedEvents precisely so that substitution is visible here.
    const { catalogues, getEventsCalls } = await loadCataloguesWithStubbedDal()

    expect(catalogues.recognition.event.map((r) => r.id)).toEqual(["event-published", "event-completed"])
    // ...from getEvents, called ONCE, with NO status filter. A second mutant
    // lives here: `getEvents({status: "published"})` returns the same shape
    // and would re-introduce three quarters of the bug while the id list above
    // still looked plausible against a less careful stub.
    expect(getEventsCalls).toHaveLength(1)
    expect(getEventsCalls[0]?.status).toBeUndefined()
    expect(getEventsCalls[0]?.type).toBeUndefined()
  })

  it("builds the OFFER event list from getPublishedEvents() with NO `from` override — the picker must not offer last year's camp", async () => {
    // MUTANT, and it is a DIFFERENT failure from the one above: `offer` fed
    // from `getEvents({})` (or from `getPublishedEvents({from: new Date(0)})`,
    // the old epoch sentinel). Either widens the picker — and Block B of the
    // prompt, which renders this same list — to every event that ever ran, so
    // the model can advertise, and an owner can attach, a live register button
    // to a camp that finished last summer.
    const { catalogues, publishedEventsCalls } = await loadCataloguesWithStubbedDal()

    expect(catalogues.offer.event.map((r) => r.id)).toEqual(["event-published"])
    expect(publishedEventsCalls).toHaveLength(1)
    // No argument at all: `getPublishedEvents`'s own `from = new Date()`
    // default IS the offer bound. Passing an epoch here is the mutant.
    expect(publishedEventsCalls[0]?.from).toBeUndefined()
  })

  it("builds the RECOGNITION pack list from listAllProducts — deactivating a pack must not break the page selling it", async () => {
    // MUTANT: `recognition` fed from `listActiveProducts`. `is_active` is the
    // packs' version of the events `status` axis and carries the identical
    // hazard: a deliberate admin action silently blocking publish on a page
    // that did not change.
    const { catalogues } = await loadCataloguesWithStubbedDal()

    expect(catalogues.recognition.session_pack.map((r) => r.id)).toEqual(["pack-active", "pack-retired"])
  })

  it("builds the OFFER pack list from listActiveProducts — a retired pack must not be offered as a NEW target", async () => {
    // MUTANT: `offer` fed from `listAllProducts`. Mirror of the events case:
    // recognition keeps existing pages working, offer stops anything new being
    // pointed at something that is no longer for sale.
    const { catalogues } = await loadCataloguesWithStubbedDal()

    expect(catalogues.offer.session_pack.map((r) => r.id)).toEqual(["pack-active"])
  })

  it("puts each DAL's rows under the right catalogue key in BOTH sets — a transposed CALL SITE is not silently correct either", async () => {
    // `toCatalogue`'s named-object parameter already makes a swap a compile
    // error; this is the belt to that pair of braces, and it also pins that
    // the session-pack lists come from the aliased `session-pack-products`
    // exports and not from the identically-named `listActiveProducts` in
    // `lib/db/shop-products.ts`. Whole-object `toEqual` on both sets, so an
    // extra or missing key fails too.
    const { catalogues } = await loadCataloguesWithStubbedDal()

    expect(catalogues).toEqual({
      recognition: {
        program: [{ id: "prog-1", name: "Program Row" }],
        session_pack: [
          { id: "pack-active", name: "Active Pack" },
          { id: "pack-retired", name: "Retired Pack" },
        ],
        event: [
          { id: "event-published", name: "Published Event" },
          { id: "event-completed", name: "Completed Event" },
        ],
      },
      offer: {
        program: [{ id: "prog-1", name: "Program Row" }],
        session_pack: [{ id: "pack-active", name: "Active Pack" }],
        event: [{ id: "event-published", name: "Published Event" }],
      },
    })
  })

  it("returns recognition and offer as SEPARATE objects, so a caller narrowing one cannot narrow the other", async () => {
    // Cheap, and it kills a real refactor mutant: `const c = toCatalogue(...);
    // return {recognition: c, offer: c}` type-checks, satisfies most of the
    // assertions above whenever the two happen to agree, and quietly undoes
    // the split. Programs are the live case — both sets are fed from
    // `getPrograms()` today (see loadCatalogues) — so this pins the CONTAINERS,
    // which must stay distinct even where the rows currently agree.
    const { catalogues } = await loadCataloguesWithStubbedDal()

    expect(catalogues.offer).not.toBe(catalogues.recognition)
    expect(catalogues.offer.program).not.toBe(catalogues.recognition.program)
  })
})
