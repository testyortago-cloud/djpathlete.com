// Stage 1.4 of the AI page builder: ops -> doc, transactional
// (lib/funnels/sections/apply.ts).
//
// This is the load-bearing guarantee of the whole feature: "make the
// headline bigger" must be STRUCTURALLY unable to touch anything else. The
// two most important test groups below are:
//
//   - "reference identity on every path" — untouched sections must be the
//     SAME OBJECT (`toBe`, never `toEqual`) after update, add, remove, move,
//     AND set_theme. A prior attempt at this exact function shipped a
//     "clone everything" mutant that failed only 1 of 16 tests because
//     identity was pinned on the update path alone.
//
//   - "phase order: add-after-a-removed-section" — a fixture that lists
//     remove_section BEFORE an add_section naming the just-removed section
//     as its anchor. A prior attempt's fixture listed add before remove,
//     which passes even against an implementation with no ordering logic at
//     all (one that resolves every id against the ORIGINAL doc regardless
//     of batch order) — so this file pins the ordering the other way
//     around, which only a correctly-sequential implementation gets right.
import { describe, it, expect } from "vitest"
import type { SectionDoc, Section } from "@/lib/funnels/sections/registry"
import { applyOps, opSchema, SECTION_REWRITE_THRESHOLD, type SectionOp } from "@/lib/funnels/sections/apply"

const urlCta = { label: "Learn more", target: { kind: "url" as const, href: "/thanks" } }
const bookingCta = { label: "Book a call", target: { kind: "booking" as const } }

function baseDoc(overrides: Partial<SectionDoc> = {}): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [],
    ...overrides,
  }
}

// A realistic 9-section page, one of every kind — mirrors doc.test.ts's own
// fixture shape so a section built here is known-good against every kind's
// real registry schema.
function nineSections(): Section[] {
  return [
    {
      id: "hero1",
      kind: "hero",
      variant: "centered",
      style: { headline: "lg", tone: "accent" },
      props: {
        eyebrow: "New",
        headline: "Train like an athlete",
        sub: "An 8-week rotational power program",
        primaryCta: urlCta,
        secondaryCta: bookingCta,
      },
    },
    {
      id: "b1",
      kind: "bullets",
      variant: "cards",
      style: {},
      props: { heading: "Why athletes choose us", items: [{ title: "Fast results" }, { title: "Safe programming" }] },
    },
    {
      id: "s1",
      kind: "steps",
      variant: "numbered",
      style: {},
      props: { heading: "How it works", steps: [{ title: "Book a call" }, { title: "Start training" }] },
    },
    {
      id: "t1",
      kind: "testimonial",
      variant: "grid",
      style: {},
      props: { source: "quote", quotes: [{ quote: "Best program I've done.", name: "Alex" }] },
    },
    {
      id: "p1",
      kind: "pricing",
      variant: "cards",
      style: {},
      props: {
        heading: "Pick your plan",
        plans: [{ name: "Starter", price: "$99", features: ["Weekly check-ins", "Direct support"], cta: urlCta }],
      },
    },
    {
      id: "f1",
      kind: "faq",
      variant: "stack",
      style: {},
      props: { heading: "Questions", source: "inline", items: [{ q: "Refunds?", a: "Yes, within 14 days." }] },
    },
    {
      id: "form1",
      kind: "form",
      variant: "boxed",
      style: {},
      props: {
        heading: "Get your free guide",
        formKey: "optin",
        fields: [{ name: "email", label: "Email", type: "email", required: true }],
      },
    },
    {
      id: "cta1",
      kind: "cta",
      variant: "band",
      style: {},
      props: {
        headline: "Spots are limited",
        cta: { label: "Reserve your spot", target: { kind: "url", href: "/reserve" } },
      },
    },
    {
      id: "foot1",
      kind: "footer",
      variant: "simple",
      style: {},
      props: {
        businessName: "DJP Athlete",
        lines: ["Tampa, FL"],
        links: [{ label: "Privacy", target: { kind: "url", href: "/privacy" } }],
      },
    },
  ]
}

function newHeroSection(id: string): Section {
  return {
    id,
    kind: "hero",
    variant: "centered",
    style: {},
    props: { headline: "Brand new section", primaryCta: urlCta },
  }
}

function idsOf(sections: Section[]): string[] {
  return sections.map((s) => s.id)
}

// ===========================================================================
// opSchema — structural validation
// ===========================================================================

describe("opSchema", () => {
  it("accepts one well-formed instance of each of the six ops", () => {
    const valid: unknown[] = [
      { op: "set_page", sections: nineSections() },
      { op: "add_section", after: "hero1", section: newHeroSection("hero2") },
      { op: "update_section", id: "hero1", props: { headline: "New" } },
      { op: "move_section", id: "cta1", after: "hero1" },
      { op: "remove_section", id: "foot1" },
      { op: "set_theme", theme: { accent: "primary" } },
    ]
    for (const op of valid) {
      expect(opSchema.safeParse(op).success, JSON.stringify(op)).toBe(true)
    }
  })

  it("rejects an unknown op literal", () => {
    expect(opSchema.safeParse({ op: "delete_everything", id: "x" }).success).toBe(false)
  })

  it("rejects add_section whose section fails its own kind's schema (hero with no headline)", () => {
    const badSection = { id: "hero2", kind: "hero", variant: "centered", style: {}, props: { primaryCta: urlCta } }
    expect(opSchema.safeParse({ op: "add_section", after: "hero1", section: badSection }).success).toBe(false)
  })

  it("rejects update_section.style with a value outside the closed enum", () => {
    const result = opSchema.safeParse({ op: "update_section", id: "hero1", style: { headline: "huge" } })
    expect(result.success).toBe(false)
  })

  it("accepts `after: null` on add_section and move_section — the top-of-page sentinel (Fix round 1, CRITICAL 1)", () => {
    expect(opSchema.safeParse({ op: "add_section", after: null, section: newHeroSection("hero2") }).success).toBe(true)
    expect(opSchema.safeParse({ op: "move_section", id: "cta1", after: null }).success).toBe(true)
  })
})

// ===========================================================================
// applyOps — transactional: any invalid op rejects the WHOLE batch
// ===========================================================================

describe("applyOps — rejects the whole batch on any invalid op", () => {
  it("update_section naming a nonexistent id rejects the whole batch", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "update_section", id: "does-not-exist", props: { headline: "x" } }])
    expect(result.ok).toBe(false)
  })

  it("add_section naming a nonexistent 'after' id rejects the whole batch", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "add_section", after: "does-not-exist", section: newHeroSection("hero2") }])
    expect(result.ok).toBe(false)
  })

  it("move_section naming a nonexistent 'id' rejects the whole batch", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "move_section", id: "does-not-exist", after: "hero1" }])
    expect(result.ok).toBe(false)
  })

  it("move_section naming a nonexistent 'after' rejects the whole batch", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "move_section", id: "cta1", after: "does-not-exist" }])
    expect(result.ok).toBe(false)
  })

  it("move_section naming itself as its own anchor rejects the whole batch", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "move_section", id: "cta1", after: "cta1" }])
    expect(result.ok).toBe(false)
  })

  it("remove_section naming a nonexistent id rejects the whole batch", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "remove_section", id: "does-not-exist" }])
    expect(result.ok).toBe(false)
  })

  it("a batch with one valid op followed by one invalid op applies NEITHER — the valid op's effect is nowhere to find", () => {
    const doc = baseDoc({ sections: nineSections() })
    const heroBefore = doc.sections[0]
    const result = applyOps(doc, [
      { op: "update_section", id: "hero1", props: { headline: "Should never land" } },
      { op: "remove_section", id: "does-not-exist" },
    ])
    expect(result.ok).toBe(false)
    // The original doc was never mutated — same object, same content.
    expect(doc.sections[0]).toBe(heroBefore)
    expect((doc.sections[0].props as { headline: string }).headline).toBe("Train like an athlete")

    // Proof the update itself was valid in isolation (so the batch failure
    // really is attributable to the second op, not a bug in the first).
    const soloResult = applyOps(doc, [{ op: "update_section", id: "hero1", props: { headline: "Should never land" } }])
    expect(soloResult.ok).toBe(true)
  })

  it("rejects a raw ops value that isn't an array", () => {
    const doc = baseDoc({ sections: nineSections() })
    // `applyOps` deliberately types its second parameter as `unknown` (not
    // `SectionOp[]`) so it's safe to call with whatever a caller actually
    // sent — including something that isn't an array at all.
    const result = applyOps(doc, { op: "set_theme", theme: {} })
    expect(result.ok).toBe(false)
  })

  it("rejects an invalid input document before even looking at ops", () => {
    const brokenDoc = baseDoc({ sections: [] }) // violates sectionDocSchema's min(1)
    const result = applyOps(brokenDoc, [{ op: "set_theme", theme: { accent: "primary" } }])
    expect(result.ok).toBe(false)
  })
})

// ===========================================================================
// Post-merge validation (contract point 6): a partial props patch that
// makes the WHOLE section invalid must be rejected, not just checked against
// the patch object's own (nonexistent) bounds.
// ===========================================================================

describe("applyOps — validates the POST-MERGE section, not just the incoming patch", () => {
  it("rejects a pricing update that empties plans[] below its schema minimum of 1", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "update_section", id: "p1", props: { plans: [] } }])
    expect(result.ok).toBe(false)
  })

  it("rejects a hero update that empties headline below its schema minimum length", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "update_section", id: "hero1", props: { headline: "" } }])
    expect(result.ok).toBe(false)
  })

  it("rejects an update_section whose variant isn't in that kind's allowed list", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "update_section", id: "hero1", variant: "not-a-real-variant" }])
    expect(result.ok).toBe(false)
  })
})

// ===========================================================================
// Reference identity — on EVERY op path, not just update. `toBe`, never
// `toEqual`: a "clone everything then patch the target" mutant must fail
// every one of these.
// ===========================================================================

describe("applyOps — reference identity on every op path", () => {
  it("update_section: every OTHER section is the exact same object; the targeted one is a new object", () => {
    const doc = baseDoc({ sections: nineSections() })
    const before = doc.sections
    const result = applyOps(doc, [{ op: "update_section", id: "hero1", style: { headline: "xl" } }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (let i = 1; i < before.length; i++) {
      expect(result.doc.sections[i]).toBe(before[i])
    }
    expect(result.doc.sections[0]).not.toBe(before[0])
  })

  it("add_section: every pre-existing section is the exact same object; the array grows by exactly one", () => {
    const doc = baseDoc({ sections: nineSections() })
    const before = doc.sections
    const result = applyOps(doc, [{ op: "add_section", after: "hero1", section: newHeroSection("hero2") }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.sections).toHaveLength(before.length + 1)
    for (const section of before) {
      expect(result.doc.sections.find((s) => s.id === section.id)).toBe(section)
    }
    expect(idsOf(result.doc.sections)).toEqual([
      "hero1",
      "hero2",
      "b1",
      "s1",
      "t1",
      "p1",
      "f1",
      "form1",
      "cta1",
      "foot1",
    ])
  })

  it("remove_section: every surviving section is the exact same object, in original relative order", () => {
    const doc = baseDoc({ sections: nineSections() })
    const before = doc.sections
    const result = applyOps(doc, [{ op: "remove_section", id: "b1" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const survivors = before.filter((s) => s.id !== "b1")
    expect(result.doc.sections).toHaveLength(survivors.length)
    survivors.forEach((section, i) => {
      expect(result.doc.sections[i]).toBe(section)
    })
  })

  it("move_section: the MOVED section is the exact same object (relocated, not cloned); everything else is untouched", () => {
    const doc = baseDoc({ sections: nineSections() })
    const before = doc.sections
    const ctaBefore = before.find((s) => s.id === "cta1")!
    const result = applyOps(doc, [{ op: "move_section", id: "cta1", after: "hero1" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(idsOf(result.doc.sections)).toEqual(["hero1", "cta1", "b1", "s1", "t1", "p1", "f1", "form1", "foot1"])
    // The relocated section is literally the same object — not rebuilt.
    expect(result.doc.sections[1]).toBe(ctaBefore)
    for (const section of before) {
      if (section.id === "cta1") continue
      expect(result.doc.sections.find((s) => s.id === section.id)).toBe(section)
    }
  })

  it("set_theme: EVERY section is the exact same object, and the sections ARRAY itself is the same reference", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "set_theme", theme: { accent: "primary" } }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Nothing about sections changed, so there was no reason to even
    // allocate a new array — copy-on-write never triggered.
    expect(result.doc.sections).toBe(doc.sections)
    doc.sections.forEach((section, i) => {
      expect(result.doc.sections[i]).toBe(section)
    })
  })

  it("a mixed batch (update one, move another, remove a third) leaves every remaining UNTARGETED section identical, AND actually applies the three targeted changes", () => {
    const doc = baseDoc({ sections: nineSections() })
    const before = doc.sections
    const untouchedIds = ["s1", "t1", "form1", "foot1"]
    const result = applyOps(doc, [
      { op: "update_section", id: "hero1", style: { headline: "xl" } },
      { op: "move_section", id: "b1", after: "p1" },
      { op: "remove_section", id: "cta1" },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const id of untouchedIds) {
      const originalSection = before.find((s) => s.id === id)!
      expect(result.doc.sections.find((s) => s.id === id)).toBe(originalSection)
    }
    // Positive assertions that the three TARGETED sections actually changed
    // — without these, this test would pass against an identity function
    // that leaves the whole doc untouched (it never checks anything DID
    // happen, only that certain things didn't).
    expect(result.doc.sections.find((s) => s.id === "hero1")!.style).toEqual({ headline: "xl", tone: "accent" })
    expect(idsOf(result.doc.sections)).toEqual(["hero1", "s1", "t1", "p1", "b1", "f1", "form1", "foot1"])
    expect(result.doc.sections.some((s) => s.id === "cta1")).toBe(false)
  })
})

// ===========================================================================
// `after: null` — insert / move to the very top of the page (Fix round 1,
// CRITICAL 1). Before this fix, add_section/move_section could only target
// "after an existing section", so "put an announcement bar above the hero"
// or "lead with the pricing" had no op and would have forced a full
// set_page rewrite — exactly the drift this file exists to prevent.
// ===========================================================================

describe("applyOps — after: null inserts/moves to the top of the page", () => {
  it("add_section({ after: null }) inserts at index 0; every pre-existing section stays reference-identical", () => {
    const doc = baseDoc({ sections: nineSections() })
    const before = doc.sections
    const result = applyOps(doc, [{ op: "add_section", after: null, section: newHeroSection("top1") }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(idsOf(result.doc.sections)).toEqual([
      "top1",
      "hero1",
      "b1",
      "s1",
      "t1",
      "p1",
      "f1",
      "form1",
      "cta1",
      "foot1",
    ])
    for (const section of before) {
      expect(result.doc.sections.find((s) => s.id === section.id)).toBe(section)
    }
    expect(result.receipt.changed).toEqual([
      { id: "top1", kind: "hero", label: "Hero", action: "added", reasons: ["added at the top"] },
    ])
  })

  it("move_section({ after: null }) relocates to index 0 as the SAME object; every other section stays reference-identical", () => {
    const doc = baseDoc({ sections: nineSections() })
    const before = doc.sections
    const footBefore = before.find((s) => s.id === "foot1")!
    const result = applyOps(doc, [{ op: "move_section", id: "foot1", after: null }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(idsOf(result.doc.sections)).toEqual(["foot1", "hero1", "b1", "s1", "t1", "p1", "f1", "form1", "cta1"])
    expect(result.doc.sections[0]).toBe(footBefore)
    for (const section of before) {
      if (section.id === "foot1") continue
      expect(result.doc.sections.find((s) => s.id === section.id)).toBe(section)
    }
    expect(result.receipt.changed).toEqual([
      { id: "foot1", kind: "footer", label: "Footer", action: "moved", reasons: ["moved to the top"] },
    ])
  })
})

// ===========================================================================
// Merge semantics: shallow per top-level key; arrays replace wholesale.
// ===========================================================================

describe("applyOps — update_section.props merges shallowly per top-level key", () => {
  it("patching one prop key leaves sibling keys at their PRIOR VALUE", () => {
    const doc = baseDoc({ sections: nineSections() })
    const heroBefore = doc.sections[0]
    const primaryCtaBefore = (heroBefore.props as { primaryCta: unknown }).primaryCta
    const result = applyOps(doc, [{ op: "update_section", id: "hero1", props: { sub: "Updated subhead" } }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const heroAfter = result.doc.sections[0]
    const props = heroAfter.props as { sub: string; headline: string; primaryCta: unknown }
    expect(props.sub).toBe("Updated subhead")
    expect(props.headline).toBe("Train like an athlete")
    // Value-equal, not necessarily reference-equal: the merge itself is a
    // plain shallow spread (reference-preserving), but `update_section` then
    // validates the WHOLE candidate through `parseSection` (contract point
    // 6), and Zod's `safeParse` reconstructs its entire output tree —
    // including untouched nested objects — rather than passing them through
    // by reference. That's fine: the reference-identity GUARANTEE this file
    // exists to make is about sections the batch didn't target (see the
    // "reference identity on every op path" block above, all `toBe`) — not
    // about sub-fields inside a section that was legitimately targeted.
    expect(props.primaryCta).toEqual(primaryCtaBefore)
  })

  it("array-valued props (bullets.items) are replaced WHOLESALE, never element-merged", () => {
    const doc = baseDoc({ sections: nineSections() })
    const newItems = [{ title: "Only this one now" }, { title: "And this one" }]
    const result = applyOps(doc, [{ op: "update_section", id: "b1", props: { items: newItems } }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const props = result.doc.sections.find((s) => s.id === "b1")!.props as { items: { title: string }[] }
    expect(props.items).toEqual(newItems)
    expect(props.items).toHaveLength(2)
  })

  it("array-valued props (pricing.plans[].features) are replaced wholesale, not concatenated with the old array", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [
      {
        op: "update_section",
        id: "p1",
        props: {
          plans: [{ name: "Starter", price: "$99", features: ["Only this feature"], cta: urlCta }],
        },
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const props = result.doc.sections.find((s) => s.id === "p1")!.props as { plans: { features: string[] }[] }
    expect(props.plans[0].features).toEqual(["Only this feature"])
  })

  it("update_section.style is a partial merge: patching one knob leaves the others at their prior value", () => {
    const doc = baseDoc({ sections: nineSections() }) // hero1 starts with { headline: "lg", tone: "accent" }
    const result = applyOps(doc, [{ op: "update_section", id: "hero1", style: { headline: "xl" } }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.sections[0].style).toEqual({ headline: "xl", tone: "accent" })
  })

  it("set_theme.theme is a partial merge over the existing theme", () => {
    const doc = baseDoc({ theme: { tone: "light", accent: "accent", radius: "round" }, sections: nineSections() })
    const result = applyOps(doc, [{ op: "set_theme", theme: { accent: "primary" } }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.theme).toEqual({ tone: "light", accent: "primary", radius: "round" })
  })
})

// ===========================================================================
// An explicit `null` in a props patch means "delete this key" (Fix round 1,
// CRITICAL 2). A shallow spread can add and replace a key but never remove
// one, and `undefined` doesn't survive JSON — so before this fix there was
// no way to express "remove the second button" / "drop the video" /
// "delete the eyebrow", and each would have forced a full set_page rewrite.
// ===========================================================================

describe("applyOps — update_section.props: an explicit null deletes an optional key", () => {
  it("nulling an OPTIONAL prop (hero.secondaryCta) removes the key entirely and succeeds", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "update_section", id: "hero1", props: { secondaryCta: null } }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const props = result.doc.sections[0].props as Record<string, unknown>
    expect("secondaryCta" in props).toBe(false)
    // Sibling keys are untouched by the deletion.
    expect(props.headline).toBe("Train like an athlete")
    expect(props.eyebrow).toBe("New")
  })

  it("nulling a REQUIRED prop (hero.headline) still fails the post-merge parse and rejects the whole batch", () => {
    const doc = baseDoc({ sections: nineSections() })
    const heroBefore = doc.sections[0]
    const result = applyOps(doc, [{ op: "update_section", id: "hero1", props: { headline: null } }])
    expect(result.ok).toBe(false)
    // Rejected wholesale, same as any other invalid post-merge section —
    // the original doc is untouched.
    expect(doc.sections[0]).toBe(heroBefore)
  })

  it("the diff receipt reports a deleted key distinctly from a replaced one", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [
      { op: "update_section", id: "hero1", props: { secondaryCta: null, sub: "New subhead" } },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.changed[0].reasons.sort()).toEqual(["content: secondaryCta removed", "content: sub"].sort())
  })
})

// ===========================================================================
// A no-op update_section (none of props/style/variant given) is rejected
// rather than silently touching the section for nothing (Fix round 1,
// IMPORTANT 5).
// ===========================================================================

describe("applyOps — rejects a no-op update_section", () => {
  it("update_section with none of props/style/variant is rejected, not a silent touch", () => {
    const doc = baseDoc({ sections: nineSections() })
    const heroBefore = doc.sections[0]
    const result = applyOps(doc, [{ op: "update_section", id: "hero1" }])
    expect(result.ok).toBe(false)
    expect(doc.sections[0]).toBe(heroBefore)
  })
})

// ===========================================================================
// THE pinned phase-order fixture: add_section anchored to a section a
// remove_section deletes in the SAME batch. Order in the array is the
// discriminant.
// ===========================================================================

describe("applyOps — phase order: add_section anchored to a section removed earlier in the same batch", () => {
  it("[remove THEN add-after-the-removed-one] is REJECTED — by the time add runs, its anchor is gone", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [
      { op: "remove_section", id: "cta1" },
      { op: "add_section", after: "cta1", section: newHeroSection("hero2") },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(" ")).toContain("cta1")
  })

  it("[add-after-X THEN remove-X] SUCCEEDS — the new section lands where X used to be", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [
      { op: "add_section", after: "cta1", section: newHeroSection("hero2") },
      { op: "remove_section", id: "cta1" },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(idsOf(result.doc.sections)).toEqual(["hero1", "b1", "s1", "t1", "p1", "f1", "form1", "hero2", "foot1"])
  })

  it("the SAME two ops, only reordered, produce different outcomes — proving batch order is load-bearing", () => {
    const doc = baseDoc({ sections: nineSections() })
    const removeFirst = applyOps(doc, [
      { op: "remove_section", id: "cta1" },
      { op: "add_section", after: "cta1", section: newHeroSection("hero2") },
    ])
    const addFirst = applyOps(doc, [
      { op: "add_section", after: "cta1", section: newHeroSection("hero2") },
      { op: "remove_section", id: "cta1" },
    ])
    expect(removeFirst.ok).toBe(false)
    expect(addFirst.ok).toBe(true)
  })
})

// ===========================================================================
// Duplicate-id guard
// ===========================================================================

describe("applyOps — rejects a batch that would produce duplicate section ids", () => {
  it("add_section whose new id collides with an existing section is rejected", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "add_section", after: "hero1", section: { ...newHeroSection("cta1") } }])
    expect(result.ok).toBe(false)
  })

  it("set_page with two sections sharing the same id is rejected by the final duplicate check", () => {
    const doc = baseDoc({ sections: nineSections() })
    const dupSections = [newHeroSection("dup"), { ...newHeroSection("dup") }]
    const result = applyOps(doc, [{ op: "set_page", sections: dupSections }])
    expect(result.ok).toBe(false)
  })

  it("a doc that ALREADY has a duplicate id is rejected up front, even on an empty ops batch (Fix round 1, minor)", () => {
    // Previously the duplicate-id guard ran only after applying a
    // non-empty ops batch, so a pre-existing duplicate sailed through
    // silently on the empty-ops no-op fast path.
    const alreadyDuplicated = baseDoc({ sections: [newHeroSection("dup"), { ...newHeroSection("dup") }] })
    const result = applyOps(alreadyDuplicated, [])
    expect(result.ok).toBe(false)
  })

  it("a doc with a pre-existing duplicate id is rejected even when the ops batch itself never touches it", () => {
    // And a non-empty batch shouldn't be blamed ("... after applying ops")
    // for a duplicate it didn't introduce.
    const alreadyDuplicated = baseDoc({ sections: [newHeroSection("dup"), { ...newHeroSection("dup") }] })
    const result = applyOps(alreadyDuplicated, [{ op: "set_theme", theme: { accent: "primary" } }])
    expect(result.ok).toBe(false)
  })
})

// ===========================================================================
// Whole-doc count bounds (1..24), only checkable after all ops are applied.
// ===========================================================================

describe("applyOps — enforces the whole-doc 1..24 section count bound", () => {
  it("removing the only remaining section is rejected (would produce zero sections)", () => {
    const doc = baseDoc({ sections: [nineSections()[0]] })
    const result = applyOps(doc, [{ op: "remove_section", id: "hero1" }])
    expect(result.ok).toBe(false)
  })

  it("adding a 25th section past the 24 cap is rejected", () => {
    const twentyFour = Array.from({ length: 24 }, (_, i) => newHeroSection(`h${i}`))
    const doc = baseDoc({ sections: twentyFour })
    const result = applyOps(doc, [{ op: "add_section", after: "h0", section: newHeroSection("h24") }])
    expect(result.ok).toBe(false)
  })
})

// ===========================================================================
// The diff receipt
// ===========================================================================

describe("applyOps — the diff receipt", () => {
  it("a single style update reports one changed entry with a friendly reason, and the correct untouched count", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "update_section", id: "hero1", style: { headline: "xl" } }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.changed).toEqual([
      { id: "hero1", kind: "hero", label: "Hero", action: "updated", reasons: ["headline size"] },
    ])
    expect(result.receipt.unchangedCount).toBe(8)
    expect(result.receipt.totalSections).toBe(9)
    expect(result.receipt.themeChanged).toBe(false)
    expect(result.receipt.isRewrite).toBe(false)
  })

  it("a combined style+props patch reports a reason for each", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [
      { op: "update_section", id: "hero1", style: { headline: "xl" }, props: { headline: "New headline" } },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.changed[0].reasons).toEqual(["headline size", "content: headline"])
  })

  it("all four style knobs map to distinct, human-readable reasons", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [
      { op: "update_section", id: "hero1", style: { headline: "sm", align: "center", tone: "muted", pad: "roomy" } },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.changed[0].reasons.sort()).toEqual(["alignment", "headline size", "padding", "tone"].sort())
  })

  it("a variant-only change is reported as 'variant'", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "update_section", id: "b1", variant: "list" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.changed[0].reasons).toEqual(["variant"])
  })

  it("just under the 60% rewrite threshold is NOT flagged as a rewrite", () => {
    const doc = baseDoc({ sections: nineSections() }) // 9 sections
    const ids = ["hero1", "b1", "s1", "t1", "p1"] // 5/9 ≈ 55.6%
    const ops: SectionOp[] = ids.map((id) => ({ op: "update_section", id, style: { align: "center" } }))
    const result = applyOps(doc, ops)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.isRewrite).toBe(false)
  })

  it("just over the 60% rewrite threshold IS flagged as a rewrite", () => {
    const doc = baseDoc({ sections: nineSections() }) // 9 sections
    const ids = ["hero1", "b1", "s1", "t1", "p1", "f1"] // 6/9 ≈ 66.7%
    const ops: SectionOp[] = ids.map((id) => ({ op: "update_section", id, style: { align: "center" } }))
    const result = applyOps(doc, ops)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.isRewrite).toBe(true)
    expect(SECTION_REWRITE_THRESHOLD).toBe(0.6)
  })

  it("EXACTLY at the 60% threshold is NOT flagged — the comparison is strict `>`, not `>=` (Fix round 1, IMPORTANT 3)", () => {
    // A 9-section update-only fixture can never land exactly on 0.6 (5/9 ≈
    // 0.556, 6/9 ≈ 0.667) — a mutant flipping `>` to `>=`, or nudging the
    // constant to e.g. 0.58, would still pass both tests above. 5 updates
    // plus 1 add gives 6 touched out of 10 considered (9 original + 1 new)
    // = exactly 0.6, so this is the one fixture that actually pins the
    // comparison operator, not just the constant.
    const doc = baseDoc({ sections: nineSections() })
    // Deliberately NOT typed as `SectionOp[]` — `applyOps`'s second
    // parameter is `unknown` precisely so callers (and these fixtures)
    // don't need one, and `newHeroSection`'s return type is the loose
    // `Section` interface (`props: Record<string, unknown>`), not the
    // stricter per-kind shape `SectionOp`'s `add_section.section` expects.
    const ops = [
      { op: "update_section", id: "hero1", style: { align: "center" } },
      { op: "update_section", id: "b1", style: { align: "center" } },
      { op: "update_section", id: "s1", style: { align: "center" } },
      { op: "update_section", id: "t1", style: { align: "center" } },
      { op: "update_section", id: "p1", style: { align: "center" } },
      { op: "add_section", after: "foot1", section: newHeroSection("hero2") },
    ]
    const result = applyOps(doc, ops)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.totalSections).toBe(10)
    expect(result.receipt.unchangedCount).toBe(4)
    expect(result.receipt.isRewrite).toBe(false)
  })

  it("set_page always flags as a rewrite (100% of the resulting page is 'replaced')", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "set_page", sections: [newHeroSection("only")] }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.isRewrite).toBe(true)
    expect(result.receipt.changed).toEqual([
      { id: "only", kind: "hero", label: "Hero", action: "replaced", reasons: ["page replaced"] },
    ])
    expect(result.receipt.unchangedCount).toBe(0)
  })

  it("set_theme alone changes no sections but reports themeChanged", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "set_theme", theme: { tone: "dark" } }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.changed).toEqual([])
    expect(result.receipt.themeChanged).toBe(true)
    expect(result.receipt.unchangedCount).toBe(9)
    expect(result.receipt.isRewrite).toBe(false)
  })

  it("set_theme with an EMPTY theme patch reports themeChanged: false — nothing actually changed (Fix round 1, minor)", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "set_theme", theme: {} }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.themeChanged).toBe(false)
    expect(result.doc.theme).toEqual(doc.theme)
    expect(result.doc.sections).toBe(doc.sections)
  })

  it("an empty ops array is a successful no-op: same doc reference, empty receipt", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc).toBe(doc)
    expect(result.receipt).toEqual({
      changed: [],
      unchangedCount: 9,
      totalSections: 9,
      themeChanged: false,
      isRewrite: false,
    })
  })

  it("remove_section reports action 'removed' with no reasons needed", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "remove_section", id: "foot1" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.changed).toEqual([
      { id: "foot1", kind: "footer", label: "Footer", action: "removed", reasons: [] },
    ])
  })

  it("add_section reports action 'added' naming its anchor", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "add_section", after: "hero1", section: newHeroSection("hero2") }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.changed).toEqual([
      { id: "hero2", kind: "hero", label: "Hero", action: "added", reasons: ['added after "hero1"'] },
    ])
  })

  it("move_section reports action 'moved' naming its new anchor", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [{ op: "move_section", id: "cta1", after: "hero1" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.changed).toEqual([
      { id: "cta1", kind: "cta", label: "Call to action", action: "moved", reasons: ['moved after "hero1"'] },
    ])
  })

  it("a mixed batch aggregates distinct touched ids correctly (each op contributes its own entry)", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [
      { op: "update_section", id: "hero1", style: { align: "center" } },
      { op: "remove_section", id: "cta1" },
      { op: "add_section", after: "foot1", section: newHeroSection("hero2") },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.changed).toHaveLength(3)
    expect(result.receipt.changed.map((c) => c.id).sort()).toEqual(["cta1", "hero1", "hero2"].sort())
    // 9 original - 1 removed + 1 added = 9 sections in the final doc.
    expect(result.receipt.totalSections).toBe(9)
    // 3 distinct ids touched out of 10 "considered" (9 original + 1 new) = 30%.
    expect(result.receipt.unchangedCount).toBe(7)
    expect(result.receipt.isRewrite).toBe(false)
  })

  it("updating the same section twice in one batch (update then move) produces two receipt entries but counts it once toward touched", () => {
    const doc = baseDoc({ sections: nineSections() })
    const result = applyOps(doc, [
      { op: "update_section", id: "cta1", style: { align: "center" } },
      { op: "move_section", id: "cta1", after: "hero1" },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.changed).toHaveLength(2)
    expect(result.receipt.changed.map((c) => c.action)).toEqual(["updated", "moved"])
    expect(result.receipt.unchangedCount).toBe(8) // only cta1 touched, once
  })
})

// ===========================================================================
// Purity: doc is never mutated (success or failure); repeat calls are
// independent.
// ===========================================================================

describe("applyOps — purity", () => {
  it("never mutates the input doc on success", () => {
    const doc = baseDoc({ sections: nineSections() })
    const snapshot = JSON.stringify(doc)
    const result = applyOps(doc, [
      { op: "update_section", id: "hero1", style: { headline: "xl" } },
      { op: "remove_section", id: "b1" },
      { op: "set_theme", theme: { accent: "primary" } },
    ])
    expect(result.ok).toBe(true)
    expect(JSON.stringify(doc)).toBe(snapshot)
  })

  it("never mutates the input doc on failure", () => {
    const doc = baseDoc({ sections: nineSections() })
    const snapshot = JSON.stringify(doc)
    const result = applyOps(doc, [{ op: "remove_section", id: "does-not-exist" }])
    expect(result.ok).toBe(false)
    expect(JSON.stringify(doc)).toBe(snapshot)
  })

  it("calling applyOps twice with the same inputs produces deep-equal (independent) results", () => {
    const doc = baseDoc({ sections: nineSections() })
    const ops: SectionOp[] = [{ op: "update_section", id: "hero1", style: { headline: "xl" } }]
    const a = applyOps(doc, ops)
    const b = applyOps(doc, ops)
    expect(a).toEqual(b)
    // But not the SAME object graph — each call builds its own new doc.
    if (a.ok && b.ok) expect(a.doc).not.toBe(b.doc)
  })
})
