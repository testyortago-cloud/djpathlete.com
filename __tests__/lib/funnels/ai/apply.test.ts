import { describe, it, expect } from "vitest"
import { applyOps, type OpResults } from "@/lib/funnels/ai/apply"
import type { FunnelSection, PageDraft } from "@/lib/funnels/ai/types"

function section(id: string): FunnelSection {
  return {
    id, kind: "generic", title: `T ${id}`, summary: `S ${id}`,
    html: `<p>${id}</p>`, css: `.x{content:"${id}"}`,
  }
}

function draft(...ids: string[]): PageDraft {
  return { sections: ids.map(section), pageCss: ":root{--brand:teal}" }
}

function results(entries: Record<string, FunnelSection> = {}, extra: Partial<OpResults> = {}): OpResults {
  return { sections: new Map(Object.entries(entries)), ...extra }
}

describe("applyOps — the anti-drift guarantee", () => {
  it("PIN: an edit_section leaves every other section byte-identical", () => {
    const before = draft("hero", "features", "proof", "faq", "cta")
    const rewritten: FunnelSection = { ...section("hero"), html: "<h1>NEW</h1>", summary: "new hero" }

    const after = applyOps(
      before,
      [{ op: "edit_section", sectionId: "hero", instruction: "bigger" }],
      results({ hero: rewritten }),
    )

    expect(after.sections.find((s) => s.id === "hero")?.html).toBe("<h1>NEW</h1>")

    const untouchedBefore = before.sections.filter((s) => s.id !== "hero")
    const untouchedAfter = after.sections.filter((s) => s.id !== "hero")
    expect(untouchedAfter).toEqual(untouchedBefore)
    // Reference equality: these sections were COPIED, never reconstructed.
    untouchedAfter.forEach((s, i) => expect(s).toBe(untouchedBefore[i]))
  })

  it("PIN: an edit_section leaves the page theme byte-identical", () => {
    const before = draft("hero", "features")
    const after = applyOps(
      before,
      [{ op: "edit_section", sectionId: "hero", instruction: "x" }],
      results({ hero: section("hero") }),
    )
    expect(after.pageCss).toBe(before.pageCss)
  })

  it("PIN: throws when a result is supplied for a section no op targeted", () => {
    const before = draft("hero", "features")
    expect(() =>
      applyOps(
        before,
        [{ op: "edit_section", sectionId: "hero", instruction: "x" }],
        results({ hero: section("hero"), features: section("features") }),
      ),
    ).toThrow(/features/)
  })

  it("PIN: throws when an op's result is missing", () => {
    const before = draft("hero")
    expect(() =>
      applyOps(before, [{ op: "edit_section", sectionId: "hero", instruction: "x" }], results()),
    ).toThrow(/hero/)
  })

  it("PIN: only regenerate_page may replace the whole section list", () => {
    const before = draft("hero", "features")
    expect(() =>
      applyOps(
        before,
        [{ op: "edit_section", sectionId: "hero", instruction: "x" }],
        results({ hero: section("hero") }, { replacement: draft("a", "b") }),
      ),
    ).toThrow(/replacement/i)
  })

  it("does not mutate the input draft", () => {
    const before = draft("hero", "features")
    const snapshot = JSON.parse(JSON.stringify(before))
    applyOps(before, [{ op: "delete_section", sectionId: "hero" }], results())
    expect(before).toEqual(snapshot)
  })
})

describe("applyOps — structural ops", () => {
  it("deletes the named section and nothing else", () => {
    const before = draft("a", "b", "c")
    const after = applyOps(before, [{ op: "delete_section", sectionId: "b" }], results())
    expect(after.sections.map((s) => s.id)).toEqual(["a", "c"])
    // Verify reference identity: surviving sections are the same objects.
    const beforeSurviving = before.sections.filter((s) => s.id !== "b")
    after.sections.forEach((s, i) => expect(s).toBe(beforeSurviving[i]))
  })

  it("inserts immediately after the named section", () => {
    const before = draft("a", "b", "c")
    const fresh = section("new")
    const after = applyOps(
      before,
      [{ op: "add_section", afterSectionId: "a", kind: "x", brief: "y", newSectionId: "new" }],
      results({ new: fresh }),
    )
    expect(after.sections.map((s) => s.id)).toEqual(["a", "new", "b", "c"])
    // Verify reference identity: existing sections are the same objects.
    expect(after.sections[0]).toBe(before.sections[0]) // "a"
    expect(after.sections[2]).toBe(before.sections[1]) // "b"
    expect(after.sections[3]).toBe(before.sections[2]) // "c"
  })

  it("inserts at the start when afterSectionId is null", () => {
    const after = applyOps(
      draft("a", "b"),
      [{ op: "add_section", afterSectionId: null, kind: "x", brief: "y", newSectionId: "new" }],
      results({ new: section("new") }),
    )
    expect(after.sections.map((s) => s.id)).toEqual(["new", "a", "b"])
  })

  it("reorders to exactly the requested order", () => {
    const before = draft("a", "b", "c")
    const after = applyOps(before, [{ op: "reorder", order: ["c", "a", "b"] }], results())
    expect(after.sections.map((s) => s.id)).toEqual(["c", "a", "b"])
    // Verify reference identity: sections are the same objects, just reordered.
    const byId = new Map(before.sections.map((s) => [s.id, s]))
    after.sections.forEach((s) => expect(s).toBe(byId.get(s.id)))
  })

  it("replaces page CSS on edit_theme and touches no section", () => {
    const before = draft("a", "b")
    const after = applyOps(before, [{ op: "edit_theme", instruction: "warmer" }], results({}, { pageCss: ":root{--brand:orange}" }))
    expect(after.pageCss).toBe(":root{--brand:orange}")
    expect(after.sections).toEqual(before.sections)
  })

  it("throws when edit_theme has no pageCss result", () => {
    expect(() => applyOps(draft("a"), [{ op: "edit_theme", instruction: "x" }], results())).toThrow(/theme/i)
  })

  it("throws when pageCss is supplied without an edit_theme op", () => {
    expect(() =>
      applyOps(draft("a"), [{ op: "delete_section", sectionId: "a" }], results({}, { pageCss: "x" })),
    ).toThrow(/theme/i)
  })

  it("replaces the whole draft on regenerate_page", () => {
    const replacement = draft("x", "y")
    const after = applyOps(draft("a", "b", "c"), [{ op: "regenerate_page", brief: "start over" }], results({}, { replacement }))
    expect(after).toBe(replacement)
  })

  it("throws when regenerate_page has no replacement", () => {
    expect(() => applyOps(draft("a"), [{ op: "regenerate_page", brief: "x" }], results())).toThrow(/replacement/i)
  })

  it("applies adds before deletes, so an add anchored on a deleted section resolves correctly", () => {
    const after = applyOps(
      draft("a", "b", "c"),
      [
        { op: "add_section", afterSectionId: "b", kind: "k", brief: "test", newSectionId: "new" },
        { op: "delete_section", sectionId: "b" },
      ],
      results({ new: section("new") }),
    )
    // If adds ran after deletes, "b" would be gone and the add would append to the end.
    // Because adds run before deletes, "new" inserts after "b", then "b" is removed.
    expect(after.sections.map((s) => s.id)).toEqual(["a", "new", "c"])
  })
})
