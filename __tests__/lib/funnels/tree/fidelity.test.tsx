// What the canvas shows versus what gets published.
//
// `compile` is the single source of truth: the canvas renders ITS output
// through the real published renderer, so for static elements fidelity holds by
// construction and there is nothing to compare. The thing that CAN still go
// wrong is an element opting out of that — supplying a `canvasFallback` and
// drawing itself by hand — so that is what these tests police, along with the
// two places untrusted input enters.
//
// An earlier draft of this file compared `Render` against `compile` for every
// element. That test could only fail if someone edited one half and not the
// other, and would have passed happily against two consistently-wrong halves.
// This repo's dominant defect is tests that cannot fail; deriving the canvas
// from the compiler removes the failure mode instead of watching for it.

import { describe, it, expect } from "vitest"
import { ELEMENT_REGISTRY, ELEMENT_LIST } from "@/lib/funnels/tree/elements"
import { ELEMENT_KINDS, type ElementKind } from "@/lib/funnels/tree/types"

describe("the canvas/publish contract", () => {
  it("only islands opt out of rendering their compiled output", () => {
    // MUTANT KILLED: a static element quietly gaining a `canvasFallback`, which
    // reintroduces two hand-written implementations of one element and with it
    // the drift this whole contract exists to delete.
    const optedOut = ELEMENT_LIST.filter((def) => def.canvasFallback !== undefined).map((d) => d.kind)
    expect(optedOut).toEqual(["island"])
  })

  it("every registered kind has a compiler", () => {
    for (const kind of ELEMENT_KINDS) {
      expect(typeof ELEMENT_REGISTRY[kind].compile).toBe("function")
    }
  })

  it("every default is accepted by its own schema", () => {
    // MUTANT KILLED: a defaultProps that the element's own propsSchema rejects
    // — dropping one on the canvas would produce a document that cannot save.
    for (const def of ELEMENT_LIST) {
      const parsed = def.propsSchema.safeParse(def.defaultProps)
      expect(parsed.success, `${def.kind} defaults must satisfy its schema`).toBe(true)
    }
  })
})

describe("element compilation", () => {
  const style = { padding: { top: "8px" } }

  it("heading compiles to its chosen level", () => {
    // MUTANT KILLED: hardcoding h2, which makes the Level control decorative.
    const node = ELEMENT_REGISTRY.heading.compile({
      props: { html: "Hi", level: 3 },
      style: {},
    })
    expect(node).toMatchObject({ t: "el", tag: "h3" })
  })

  it("carries styles onto the compiled node", () => {
    const node = ELEMENT_REGISTRY.heading.compile({ props: { html: "Hi", level: 2 }, style })
    expect(JSON.stringify(node)).toContain("padding-top:8px")
  })

  it("spacer height survives compilation", () => {
    // MUTANT KILLED: dropping the height prop, which makes a spacer a no-op.
    const node = ELEMENT_REGISTRY.spacer.compile({ props: { height: "64px" }, style: {} })
    expect(JSON.stringify(node)).toContain("height:64px")
  })

  it("island compiles to an island node carrying its props", () => {
    const node = ELEMENT_REGISTRY.island.compile({
      props: { name: "form", islandProps: { formKey: "waitlist" } },
      style: {},
    })
    expect(node).toMatchObject({ t: "island", name: "form", props: { formKey: "waitlist" } })
  })
})

describe("untrusted input", () => {
  it("strips a script from rich text on compile", () => {
    // MUTANT KILLED: treating TipTap output as trusted because it came from our
    // own editor. Rich text is the ONLY free-HTML path into a published page,
    // and an editor is just a text box someone can paste into.
    const node = ELEMENT_REGISTRY.text.compile({
      props: { html: "<p>keep this</p><script>alert(1)</script>" },
      style: {},
    })
    const json = JSON.stringify(node)
    expect(json.toLowerCase()).not.toContain("script")
    // ...and the safe half SURVIVED. Without this line the assertion above
    // passes just as well against a compiler that dropped the content whole,
    // which would be a different bug wearing the same green tick.
    expect(json).toContain("keep this")
  })

  it("rejects a javascript: href on a button", () => {
    // MUTANT KILLED: assigning props.href straight onto the anchor.
    const node = ELEMENT_REGISTRY.button.compile({
      props: { label: "x", href: "javascript:alert(1)" },
      style: {},
    })
    expect(JSON.stringify(node)).not.toContain("javascript:")
  })

  it("keeps the label when the href is rejected", () => {
    // MUTANT KILLED: dropping the whole element on a bad href, which would
    // silently delete the owner's button instead of just its destination.
    const node = ELEMENT_REGISTRY.button.compile({
      props: { label: "Still here", href: "javascript:alert(1)" },
      style: {},
    })
    expect(JSON.stringify(node)).toContain("Still here")
  })

  it("rejects a javascript: image src", () => {
    const node = ELEMENT_REGISTRY.image.compile({
      props: { src: "javascript:alert(1)", alt: "a" },
      style: {},
    })
    expect(JSON.stringify(node)).not.toContain("javascript:")
  })
})

describe("island fields", () => {
  it("come from ISLAND_TRAITS rather than a copy", async () => {
    // MUTANT KILLED: a hand-written field list here that drifts from the traits
    // the compiler validates against — the exact bug ISLAND_TRAITS was
    // preserved to prevent when the GrapesJS editor was deleted.
    const { fieldsForIsland } = await import("@/lib/funnels/tree/elements")
    const { ISLAND_TRAITS } = await import("@/lib/funnels/island-fields")
    const { ISLAND_NAMES } = await import("@/lib/funnels/islands")

    for (const name of ISLAND_NAMES) {
      expect(fieldsForIsland(name).map((f) => f.name)).toEqual(
        ISLAND_TRAITS[name].map((t) => t.name),
      )
    }
  })
})

describe("registry completeness", () => {
  it("registers exactly the declared element kinds", () => {
    // MUTANT KILLED: adding a kind to the union and forgetting the registry —
    // the palette would offer nothing and getElementDef would return undefined
    // at compile time.
    expect(Object.keys(ELEMENT_REGISTRY).sort()).toEqual([...ELEMENT_KINDS].sort())
  })

  it("gives every element a distinct label for the palette", () => {
    const labels = ELEMENT_LIST.map((d) => d.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it("has no kind missing from ELEMENT_LIST", () => {
    expect(ELEMENT_LIST.map((d) => d.kind as ElementKind).sort()).toEqual([...ELEMENT_KINDS].sort())
  })
})
