// The tree has one invariant with no correct resolution: a row's column count
// versus its layout. Everything else can be defaulted or clamped; that one
// cannot, because either way of resolving it changes what the page looks like
// and one of them silently drops content.

import { describe, it, expect } from "vitest"
import { pageTreeSchema, emptyPageTree } from "@/lib/funnels/tree/schema"
import { segmentsOf } from "@/lib/funnels/tree/types"

function tree(layout: string, columnCount: number) {
  return {
    v: 1,
    engine: "tree",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "s1",
        style: {},
        rows: [
          {
            id: "r1",
            style: {},
            layout,
            columns: Array.from({ length: columnCount }, (_, index) => ({
              id: `c${index + 1}`,
              style: {},
              elements: [],
            })),
          },
        ],
      },
    ],
  }
}

describe("pageTreeSchema", () => {
  it("accepts a row whose column count matches its layout", () => {
    expect(pageTreeSchema.safeParse(tree("1-1", 2)).success).toBe(true)
  })

  it("REJECTS a row whose column count contradicts its layout", () => {
    // MUTANT KILLED: omitting the refine. A 3-column row labelled "1-1" would
    // validate, then render two columns and silently drop the third's content.
    expect(pageTreeSchema.safeParse(tree("1-1", 3)).success).toBe(false)
  })

  it("REJECTS too few columns for the layout too", () => {
    // MUTANT KILLED: a refine written as `>=` instead of `===`, which catches
    // the extra-column case and misses the missing-column one.
    expect(pageTreeSchema.safeParse(tree("1-1-1", 2)).success).toBe(false)
  })

  it("rejects an unknown layout", () => {
    expect(pageTreeSchema.safeParse(tree("1-1-1-1-1", 5)).success).toBe(false)
  })

  it("rejects unknown keys rather than dropping them", () => {
    // MUTANT KILLED: a non-strict object. Silently discarding a field the
    // editor wrote is how a save appears to succeed and loses work.
    const bad = tree("1", 1) as Record<string, unknown>
    bad.somethingElse = true
    expect(pageTreeSchema.safeParse(bad).success).toBe(false)
  })

  it("emptyPageTree() is itself valid", () => {
    // MUTANT KILLED: a starter document the schema refuses — the editor would
    // fail to save the moment it was opened on a brand-new page.
    expect(pageTreeSchema.safeParse(emptyPageTree()).success).toBe(true)
  })
})

describe("segmentsOf", () => {
  it("derives the column count and the flex ratios", () => {
    expect(segmentsOf("1-2")).toEqual([1, 2])
    expect(segmentsOf("1-1-1")).toHaveLength(3)
    expect(segmentsOf("1")).toEqual([1])
  })
})
