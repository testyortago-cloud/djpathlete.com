// What the inspector is allowed to offer for a given element is DERIVED from
// that element's own definition, never declared beside it. A second declaration
// is a second thing that can disagree with the compiler, and when it disagrees
// the owner gets a control that silently does nothing — the same decorative
// -field defect the Inspector's header comment already records for `form`.

import { describe, it, expect } from "vitest"
import { honoursType, richtextField } from "@/lib/funnels/tree/capability"
import { ELEMENT_REGISTRY } from "@/lib/funnels/tree/elements"

describe("honoursType", () => {
  it("is true for elements whose compile passes TypeStyle through", () => {
    // MUTANT KILLED: a probe that always answers false, which would hide the
    // Typography group on every element and leave all five TypeStyle fields
    // unreachable from the inspector even though styleToCss compiles them.
    expect(honoursType(ELEMENT_REGISTRY.heading)).toBe(true)
    expect(honoursType(ELEMENT_REGISTRY.text)).toBe(true)
    expect(honoursType(ELEMENT_REGISTRY.button)).toBe(true)
  })

  it("is false for elements whose compile discards TypeStyle", () => {
    // MUTANT KILLED: a probe that always answers true, which would offer a
    // font-size control on a divider. The control would look identical to a
    // working one and do nothing at all once published.
    expect(honoursType(ELEMENT_REGISTRY.divider)).toBe(false)
    expect(honoursType(ELEMENT_REGISTRY.spacer)).toBe(false)
    expect(honoursType(ELEMENT_REGISTRY.image)).toBe(false)
  })

  it("is false for an island, whose compiled node carries no typography", () => {
    // MUTANT KILLED: probing an element whose compile ignores its style
    // arguments entirely and reading the absence of a crash as a yes.
    expect(honoursType(ELEMENT_REGISTRY.island)).toBe(false)
  })

  it("answers from compile output rather than from a hardcoded kind list", () => {
    // MUTANT KILLED: switching on `def.kind` instead of probing. A kind list
    // passes every assertion above and then goes stale the first time an
    // element starts or stops honouring TypeStyle, which is exactly the drift
    // the ElementDef contract exists to delete.
    const discarding = {
      ...ELEMENT_REGISTRY.heading,
      compile: () => ({ t: "el" as const, tag: "h2", attrs: {}, children: [] }),
    }
    expect(honoursType(discarding)).toBe(false)
  })

  it("does not leak the sentinel into anything it returns", () => {
    // MUTANT KILLED: a probe that mutates the def or its defaultProps while
    // measuring it, which would poison every later render of that element.
    honoursType(ELEMENT_REGISTRY.heading)
    expect(JSON.stringify(ELEMENT_REGISTRY.heading.defaultProps)).not.toContain("9973")
  })
})

describe("richtextField", () => {
  it("returns the richtext field for elements that declare one", () => {
    // MUTANT KILLED: returning null everywhere, which would make double-click
    // inert and leave inline editing unreachable.
    expect(richtextField(ELEMENT_REGISTRY.heading)?.name).toBe("html")
    expect(richtextField(ELEMENT_REGISTRY.text)?.name).toBe("html")
  })

  it("returns null for a button, whose label is plain text", () => {
    // MUTANT KILLED: treating any text-ish field as richtext, which would open
    // a rich text editor over a plain `label` and write markup into a prop
    // whose schema expects a bare string.
    expect(richtextField(ELEMENT_REGISTRY.button)).toBeNull()
  })

  it("returns null for elements with no text at all", () => {
    // MUTANT KILLED: making every element inline-editable, so double-clicking
    // a spacer would open an editor bound to a prop that does not exist.
    expect(richtextField(ELEMENT_REGISTRY.divider)).toBeNull()
    expect(richtextField(ELEMENT_REGISTRY.spacer)).toBeNull()
    expect(richtextField(ELEMENT_REGISTRY.image)).toBeNull()
    expect(richtextField(ELEMENT_REGISTRY.island)).toBeNull()
  })
})
