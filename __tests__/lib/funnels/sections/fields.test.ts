// Inspector fields, INTROSPECTED from each kind's Zod schema rather than
// declared beside it.
//
// A hand-written field table is the "restate the rule instead of asking the
// thing that owns it" mistake this repo has now paid for three times, and here
// it fails in the quietest possible way: widen `bulletItemSchema` and the
// inspector keeps offering yesterday's fields, so the new one is uneditable
// forever with nothing anywhere reporting it.
//
// The first test is therefore the point of the file: every key the schema
// defines must be reachable through some field, for every kind.

import { describe, it, expect } from "vitest"
import { fieldsForSection, blankItemFor, blankValueFor } from "@/lib/funnels/sections/fields"
import { applyOps } from "@/lib/funnels/sections/apply"
import {
  SECTION_KINDS,
  SECTION_REGISTRY,
  type Section,
  type SectionDoc,
  type SectionKind,
} from "@/lib/funnels/sections/registry"

function fixtureFor(kind: SectionKind, override: Record<string, unknown> = {}): Section {
  const props: Record<SectionKind, Record<string, unknown>> = {
    hero: {
      headline: "Free trial week",
      sub: "Full access.",
      eyebrow: "Seven days",
      primaryCta: { label: "Start", target: { kind: "url", href: "/signup" } },
      secondaryCta: { label: "Plans", target: { kind: "anchor", sectionId: "p1" } },
    },
    proof: {
      heading: "Track record",
      items: [
        { value: "500+", label: "athletes" },
        { value: "12 years", label: "coaching" },
      ],
    },
    bullets: {
      heading: "What you get",
      intro: "Everything.",
      items: [
        { title: "Program", body: "Built for you.", icon: "check" },
        { title: "Numbers", body: "Tracked." },
      ],
    },
    steps: {
      heading: "How it works",
      intro: "Three steps.",
      steps: [
        { title: "Tell me", body: "One line." },
        { title: "Get it", body: "24 hours." },
      ],
    },
    testimonial: { source: "quote", quotes: [{ quote: "Great.", name: "Jordan", detail: "400m" }] },
    pricing: {
      heading: "Plans",
      plans: [
        {
          name: "Monthly",
          price: "$99",
          cadence: "per month",
          blurb: "Cancel any time.",
          features: ["Program", "Check-in"],
          cta: { label: "Choose", target: { kind: "url", href: "/buy" } },
          highlight: true,
        },
      ],
      footnote: "USD.",
    },
    faq: { heading: "Questions", source: "inline", items: [{ q: "Card?", a: "No." }] },
    form: {
      heading: "Start",
      sub: "Tell me your sport.",
      proofPoints: ["No payment now"],
      formKey: "trial",
      fields: [{ name: "email", label: "Email", type: "email", required: true }],
      submitLabel: "Start",
    },
    cta: { headline: "Ready?", sub: "A minute.", cta: { label: "Start", target: { kind: "url", href: "/x" } } },
    footer: {
      businessName: "DJP Athlete",
      lines: ["Tampa Bay, FL"],
      links: [{ label: "Privacy", target: { kind: "url", href: "/privacy" } }],
      legal: "All rights reserved.",
    },
    quiz: {
      heading: "Find your gaps",
      sub: "Three minutes.",
      quizId: "f15ef258-3f0a-494b-a8c9-deb2de7b2aa9",
      submitLabel: "See my result",
    },
  }
  return {
    id: "x1",
    kind,
    variant: SECTION_REGISTRY[kind].variants[0],
    style: {},
    props: { ...props[kind], ...override },
  }
}

/** Top-level key a field addresses — `plans.0.name` belongs to `plans`. */
function rootKeys(section: Section): Set<string> {
  return new Set(fieldsForSection(section).map((field) => field.path.split(".")[0]))
}

/** How many growable lists each kind turned out to have. See the pair below. */
const growable: Partial<Record<SectionKind, number>> = {}

describe("fieldsForSection", () => {
  it.each(SECTION_KINDS)("reaches every prop key a %s actually holds", (kind) => {
    // MUTANT KILLED: a hand-written field list that silently omits a prop.
    const section = fixtureFor(kind)
    const covered = rootKeys(section)
    for (const key of Object.keys(section.props)) {
      expect(covered, `${kind}.${key} is unreachable in the inspector`).toContain(key)
    }
  })

  it.each(SECTION_KINDS)("offers no %s field the real validator would reject", (kind) => {
    // The other direction, asked of the thing that actually decides. An
    // inspector that offers a field `applyOps` refuses invites the owner to
    // type into a box whose save can only fail.
    //
    // Note this asks APPLYOPS, not the props schema directly: the op path is
    // where a real edit goes, and it validates the POST-MERGE section, which
    // is the only check that can catch a patch that is fine alone and invalid
    // in combination.
    const section = fixtureFor(kind)
    const doc: SectionDoc = {
      v: 1,
      engine: "sections",
      theme: { tone: "light", accent: "accent", radius: "soft" },
      sections: [section],
    }

    const isFreeText = (field: { type: string; pattern?: string }) =>
      (field.type === "text" || field.type === "textarea") && field.pattern === undefined

    let checked = 0

    for (const field of fieldsForSection(section)) {
      // A FORMAT-BOUND field is not free text and is covered separately below;
      // writing prose into it proves nothing except that the format works.
      if (isFreeText(field)) {
        checked++
        const result = applyOps(doc, [
          { op: "update_section", id: section.id, props: { [field.path]: "Edited copy" } },
        ])
        expect(result.ok, `${kind}.${field.path}: ${result.ok ? "" : result.errors.join("; ")}`).toBe(true)
        continue
      }

      // A repeater's text lives one level down — `testimonial` and `faq` have
      // NO top-level text field at all, so a sweep that only looked at the top
      // level would pass them vacuously. The op below is the real one the
      // inspector emits for an item edit: the whole array, patched.
      if (field.type !== "repeater") continue
      const current = (section.props as Record<string, unknown>)[field.path]
      if (!Array.isArray(current) || current.length === 0) continue

      for (const itemField of field.item ?? []) {
        if (!isFreeText(itemField)) continue
        checked++
        const patched = current.map((entry, index) =>
          index === 0 ? { ...(entry as Record<string, unknown>), [itemField.path]: "Edited copy" } : entry,
        )
        const result = applyOps(doc, [
          { op: "update_section", id: section.id, props: { [field.path]: patched } },
        ])
        expect(
          result.ok,
          `${kind}.${field.path}.0.${itemField.path}: ${result.ok ? "" : result.errors.join("; ")}`,
        ).toBe(true)
      }
    }

    // MUTANT KILLED: a `fieldsForSection` returning nothing — or only
    // format-bound fields — would make every loop above vacuous and green.
    expect(checked, `${kind} exposed no free-text field to check`).toBeGreaterThan(0)
  })

  it("marks the format-bound fields so the owner does not hit the rule blind", () => {
    // Both found by the sweep above, which tried to type ordinary prose into
    // every text field and was refused by exactly these two. An inspector
    // presenting them as free text invites a save that can only fail.
    const form = fieldsForSection(fixtureFor("form"))
    expect(form.find((f) => f.path === "formKey")?.pattern).toBe("^[a-z0-9][a-z0-9-]{0,39}$")
    // A link field is typed as one, so the UI can say what it will accept.
    expect(form.find((f) => f.path === "redirectUrl")?.type).toBe("url")
    // Ordinary copy carries no constraint, so the UI does not gratuitously
    // restrict what the owner may write.
    expect(fieldsForSection(fixtureFor("hero")).find((f) => f.path === "headline")?.pattern).toBeUndefined()
  })

  it("accepts a valid value in each format-bound field", () => {
    // The other half of the pair: the constraint is real, and a correct value
    // still goes through.
    const section = fixtureFor("form")
    const doc: SectionDoc = {
      v: 1,
      engine: "sections",
      theme: { tone: "light", accent: "accent", radius: "soft" },
      sections: [section],
    }
    expect(applyOps(doc, [{ op: "update_section", id: "x1", props: { formKey: "trial-week" } }]).ok).toBe(true)
    expect(applyOps(doc, [{ op: "update_section", id: "x1", props: { redirectUrl: "/thanks" } }]).ok).toBe(true)
  })

  it("returns the branch matching the current discriminant", () => {
    const live = fixtureFor("testimonial", { source: "live", limit: 3, featuredOnly: false })
    const livePaths = fieldsForSection(live).map((f) => f.path)
    expect(livePaths).toEqual(expect.arrayContaining(["source", "limit", "featuredOnly"]))
    // MUTANT KILLED: offering the other branch's fields. Editing `quotes` on a
    // live testimonial writes a prop its own schema forbids.
    expect(livePaths).not.toContain("quotes")

    const quoted = fixtureFor("testimonial")
    expect(fieldsForSection(quoted).map((f) => f.path)).toContain("quotes")
  })

  it("offers the discriminator as a switch between branches", () => {
    const source = fieldsForSection(fixtureFor("testimonial")).find((f) => f.path === "source")
    expect(source?.type).toBe("select")
    expect(source?.options?.map((o) => o.id).sort()).toEqual(["live", "quote"])
  })

  it("carries the array bounds the schema declares", () => {
    // Bounds are correctness, not decoration: removing the second bullet from
    // a min(2) list must be refused before the save, not after it.
    const items = fieldsForSection(fixtureFor("bullets")).find((f) => f.path === "items")
    expect(items).toMatchObject({ type: "repeater", min: 2, max: 6 })
  })

  it("describes a repeating item's own fields", () => {
    const items = fieldsForSection(fixtureFor("bullets")).find((f) => f.path === "items")
    const itemPaths = items?.item?.map((f) => f.path)
    expect(itemPaths).toEqual(expect.arrayContaining(["title", "body", "icon"]))
    expect(items?.item?.find((f) => f.path === "icon")?.type).toBe("select")
  })

  it("reads an array of plain strings as a list, not a repeater", () => {
    const lines = fieldsForSection(fixtureFor("footer")).find((f) => f.path === "lines")
    expect(lines?.type).toBe("list")
    expect(lines?.item).toBeUndefined()
  })

  it("reads a CTA as one field rather than walking into its union", () => {
    // A CtaTarget's validity is not local — a {kind:"program"} ref only
    // publishes if the name resolves to exactly one row — so it gets a
    // purpose-built editor instead of a generic union walk.
    expect(fieldsForSection(fixtureFor("cta")).find((f) => f.path === "cta")?.type).toBe("cta")
    expect(fieldsForSection(fixtureFor("hero")).find((f) => f.path === "primaryCta")?.type).toBe("cta")
  })

  it("merges both halves of an intersection", () => {
    // form = { heading?, sub?, proofPoints? } & formIslandSchema
    const paths = fieldsForSection(fixtureFor("form")).map((f) => f.path)
    expect(paths).toEqual(
      expect.arrayContaining(["heading", "sub", "proofPoints", "formKey", "fields", "submitLabel"]),
    )
  })

  it("marks optional fields optional and required fields required", () => {
    const hero = fieldsForSection(fixtureFor("hero"))
    expect(hero.find((f) => f.path === "headline")?.optional).toBe(false)
    expect(hero.find((f) => f.path === "sub")?.optional).toBe(true)
  })

  it("sends long text to a textarea and short text to an input", () => {
    const faq = fieldsForSection(fixtureFor("faq"))
    expect(faq.find((f) => f.path === "items")?.item?.find((f) => f.path === "a")?.type).toBe("textarea")
    expect(fieldsForSection(fixtureFor("hero")).find((f) => f.path === "headline")?.type).toBe("text")
  })

  it("reads a boolean as a checkbox and a number as a number", () => {
    const plans = fieldsForSection(fixtureFor("pricing")).find((f) => f.path === "plans")
    expect(plans?.item?.find((f) => f.path === "highlight")?.type).toBe("checkbox")
    const live = fixtureFor("testimonial", { source: "live", limit: 3, featuredOnly: false })
    expect(fieldsForSection(live).find((f) => f.path === "limit")?.type).toBe("number")
    expect(fieldsForSection(live).find((f) => f.path === "featuredOnly")?.type).toBe("checkbox")
  })

  it("labels a field without repeating its raw key", () => {
    const hero = fieldsForSection(fixtureFor("hero"))
    expect(hero.find((f) => f.path === "headline")?.label).toBe("Headline")
    expect(hero.find((f) => f.path === "primaryCta")?.label).toBe("Primary CTA")
  })

  it.each(SECTION_KINDS)("can grow every repeating list a %s has", (kind) => {
    // The point of `blankValueFor`: adding a bullet needs something to add, and
    // "something" is schema-specific. `bulletItemSchema.title` is min(1), so an
    // empty object is refused and the owner would click Add and be told a field
    // they never saw is invalid.
    //
    // Asked of the REAL validator, through the real op path.
    const section = fixtureFor(kind)
    const doc: SectionDoc = {
      v: 1,
      engine: "sections",
      theme: { tone: "light", accent: "accent", radius: "soft" },
      sections: [section],
    }

    let checked = 0
    for (const field of fieldsForSection(section)) {
      if (field.type !== "repeater" && field.type !== "list") continue
      const current = (section.props as Record<string, unknown>)[field.path]
      if (!Array.isArray(current)) continue
      if (field.max !== undefined && current.length >= field.max) continue

      checked++
      const grown = [...current, field.type === "repeater" ? blankItemFor(field) : blankValueFor({ ...field, type: "text" })]
      const result = applyOps(doc, [
        { op: "update_section", id: section.id, props: { [field.path]: grown } },
      ])
      expect(
        result.ok,
        `${kind}.${field.path}: ${result.ok ? "" : result.errors.join("; ")}`,
      ).toBe(true)
    }

    // `hero` and `cta` genuinely have no repeating content, so a per-kind
    // "must have found one" assertion would be false rather than strict. The
    // vacuity guard lives in the next test instead, over the whole set.
    growable[kind] = checked
  })

  it("found something to grow in the kinds that have lists", () => {
    // MUTANT KILLED: a `fieldsForSection` that stopped reporting repeaters at
    // all would make every loop in the test above vacuous and green.
    const withLists = SECTION_KINDS.filter((kind) => (growable[kind] ?? 0) > 0)
    expect(withLists).toEqual(
      expect.arrayContaining(["bullets", "steps", "proof", "pricing", "faq", "testimonial", "footer", "form"]),
    )
  })

  it("omits optional leaves from a blank item rather than blanking them", () => {
    // An optional string set to "" is NOT the same as unset: render.ts renders
    // the empty element instead of the placeholder, so a new row would come
    // back with a dead space in it that the owner cannot get rid of.
    const items = fieldsForSection(fixtureFor("bullets")).find((f) => f.path === "items")
    const blank = blankItemFor(items!)
    expect(blank).toHaveProperty("title")
    expect(blank).not.toHaveProperty("body")
    expect(blank).not.toHaveProperty("icon")
  })

  it("builds a valid CTA for a plan, not a dead button", () => {
    // `pricingPlanSchema.cta` is required, and a CtaTarget that fails SAFE_LINK
    // renders as a disabled placeholder with ok:true and no warning.
    const plans = fieldsForSection(fixtureFor("pricing")).find((f) => f.path === "plans")
    const blank = blankItemFor(plans!) as { cta: { label: string; target: { kind: string; href: string } } }
    expect(blank.cta.target).toEqual({ kind: "url", href: "/" })
    expect(blank.cta.label.length).toBeGreaterThan(0)
    // A plan also needs at least one feature — `features` is min(1).
    expect(Array.isArray((blank as unknown as { features: unknown }).features)).toBe(true)
  })

  it("never exceeds a field's own max length", () => {
    // The placeholder is generated from the label, and a long label on a short
    // field would produce a value the schema rejects for length alone.
    for (const kind of SECTION_KINDS) {
      for (const field of fieldsForSection(fixtureFor(kind))) {
        if (field.type !== "text" && field.type !== "textarea") continue
        const value = blankValueFor(field)
        if (typeof value !== "string" || field.maxLength === undefined) continue
        expect(value.length, `${kind}.${field.path}`).toBeLessThanOrEqual(field.maxLength)
      }
    }
  })

  it("does not throw on a section whose props are incomplete", () => {
    // The inspector opens on whatever is stored, including a document written
    // by an older build. Refusing to render fields is worse than rendering the
    // ones it can work out.
    const broken = { ...fixtureFor("hero"), props: {} as Record<string, unknown> }
    expect(() => fieldsForSection(broken)).not.toThrow()
    expect(fieldsForSection(broken).length).toBeGreaterThan(0)
  })
})
