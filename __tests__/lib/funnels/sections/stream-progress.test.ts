// __tests__/lib/funnels/sections/stream-progress.test.ts
//
// EVERY TEST NAMES THE MUTANT IT KILLS. The module under test reads
// deliberately-invalid input — a build response three tokens into being
// written — so the failure mode it has to be protected from is not "rejects
// bad data" but the opposite: throwing, or inventing a value, on a shape that
// is merely incomplete.

import { describe, expect, it } from "vitest"
import { changedSections, collectStreamedSections } from "@/lib/funnels/sections/stream-progress"

describe("collectStreamedSections — reading a partial", () => {
  it("survives every prefix of a real first-draft response without throwing", () => {
    // MUTANT: any unguarded property access — `partial.ops[0].sections.length`,
    // `props.headline.trim()`. `streamObject` emits a partial after nearly
    // every token, so a shape this module cannot read is not a rare edge case;
    // it is most of the stream. One throw takes the whole turn down.
    const shapes: unknown[] = [
      undefined,
      null,
      "",
      {},
      { ops: null },
      { ops: [] },
      { ops: [{}] },
      { ops: [{ op: "set" }] },
      { ops: [{ op: "set_page" }] },
      { ops: [{ op: "set_page", sections: null }] },
      { ops: [{ op: "set_page", sections: [] }] },
      { ops: [{ op: "set_page", sections: [null] }] },
      { ops: [{ op: "set_page", sections: [{}] }] },
      { ops: [{ op: "set_page", sections: [{ kind: "he" }] }] },
      { ops: [{ op: "set_page", sections: [{ kind: "hero", props: null }] }] },
      { ops: [{ op: "set_page", sections: [{ kind: "hero", props: { headline: "" } }] }] },
    ]
    for (const shape of shapes) {
      expect(() => collectStreamedSections(shape)).not.toThrow()
    }
  })

  it("reports a field as null until it exists, never as a guess", () => {
    // MUTANT: defaulting `kind` to "hero" (the commonest first section) or
    // `headline` to "Untitled". Both would put a caption on screen that the
    // model never wrote, which is the one thing the progress display promises
    // it will not do.
    const [section] = collectStreamedSections({ ops: [{ op: "set_page", sections: [{ id: "h1" }] }] })
    expect(section.kind).toBeNull()
    expect(section.headline).toBeNull()
    expect(section.variant).toBeNull()
    expect(section.id).toBe("h1")
  })

  it("treats an empty string as absent", () => {
    // MUTANT: `typeof value === "string"` without the length check. The model
    // opens a field as `""` before writing into it, so a bare typeof check
    // reports a headline that is one keystroke of nothing.
    const [section] = collectStreamedSections({
      ops: [{ op: "set_page", sections: [{ kind: "", props: { headline: "" } }] }],
    })
    expect(section.kind).toBeNull()
    expect(section.headline).toBeNull()
  })

  it("keys by POSITION so a section that grows an id stays one section", () => {
    // MUTANT: keying on `id`. `id` arrives late, so the same section would be
    // reported under a null key and then under "hero" — two wireframe blocks
    // for one section, and the count visibly wrong mid-stream.
    const early = collectStreamedSections({ ops: [{ op: "set_page", sections: [{ kind: "hero" }] }] })
    const later = collectStreamedSections({
      ops: [{ op: "set_page", sections: [{ kind: "hero", id: "hero" }] }],
    })
    expect(early[0].key).toBe(later[0].key)
    expect(changedSections(early, later)).toHaveLength(1)
  })

  it("finds the title wherever the kind happens to keep it", () => {
    // MUTANT: reading only `props.headline`. Six of the nine kinds call it
    // `heading` and the footer calls it `businessName`, so a headline-only
    // reader captions the hero and leaves every other block blank.
    const sections = collectStreamedSections({
      ops: [
        {
          op: "set_page",
          sections: [
            { kind: "hero", props: { headline: "Join the waitlist" } },
            { kind: "bullets", props: { heading: "What the class is" } },
            { kind: "footer", props: { businessName: "DJP Athlete" } },
          ],
        },
      ],
    })
    expect(sections.map((section) => section.headline)).toEqual([
      "Join the waitlist",
      "What the class is",
      "DJP Athlete",
    ])
  })

  it("reports add_section and update_section, and ignores the three ops with nothing to draw", () => {
    // MUTANT 1: handling only `set_page`, so every edit turn shows an empty
    // stage — the majority of turns after the first.
    // MUTANT 2: emitting a block for `remove_section`, which would draw a
    // wireframe of a section that is being DELETED.
    const sections = collectStreamedSections({
      ops: [
        { op: "add_section", after: "hero", section: { kind: "proof", id: "p1" } },
        { op: "update_section", id: "hero", props: { headline: "Shorter" } },
        { op: "move_section", id: "faq", after: "hero" },
        { op: "remove_section", id: "pricing" },
        { op: "set_theme", theme: { tone: "dark" } },
      ],
    })
    expect(sections).toHaveLength(2)
    expect(sections[0]).toMatchObject({ op: "add_section", kind: "proof", id: "p1" })
    expect(sections[1]).toMatchObject({ op: "update_section", kind: null, id: "hero", headline: "Shorter" })
  })

  it("drops an update_section that names nothing yet", () => {
    // MUTANT: pushing an entry for `{op: "update_section"}` the moment the op
    // literal appears. The id has not been written, so the block would render
    // as an anonymous box that never resolves to anything.
    expect(collectStreamedSections({ ops: [{ op: "update_section" }] })).toEqual([])
  })
})

describe("changedSections — what actually goes on the wire", () => {
  it("sends a section once, then only when it changes", () => {
    // MUTANT: returning `next` wholesale. A 24-section page re-sends all 24 on
    // every one of the hundreds of partials in a long generation — thousands of
    // frames for a display that needs dozens.
    const first = collectStreamedSections({ ops: [{ op: "set_page", sections: [{ kind: "hero" }] }] })
    expect(changedSections([], first)).toHaveLength(1)
    expect(changedSections(first, first)).toHaveLength(0)

    const grown = collectStreamedSections({
      ops: [{ op: "set_page", sections: [{ kind: "hero", props: { headline: "Now with copy" } }] }],
    })
    const delta = changedSections(first, grown)
    expect(delta).toHaveLength(1)
    expect(delta[0].headline).toBe("Now with copy")
  })

  it("notices a change in any reported field, not just the headline", () => {
    // MUTANT: comparing only `headline`. `variant` and `kind` both arrive after
    // the section first appears, and a comparison that ignores them freezes the
    // block in whatever shape it was drawn in first.
    const before = collectStreamedSections({ ops: [{ op: "set_page", sections: [{ kind: "hero" }] }] })
    const after = collectStreamedSections({
      ops: [{ op: "set_page", sections: [{ kind: "hero", variant: "split" }] }],
    })
    expect(changedSections(before, after)).toHaveLength(1)
  })
})
