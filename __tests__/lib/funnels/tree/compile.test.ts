// Turning a tree into the published node format. The interesting cases are the
// ones where a wrong answer still LOOKS like a page: equal columns for every
// layout, or a single bad element taking the whole publish down.

import { describe, it, expect } from "vitest"
import { compilePageTree } from "@/lib/funnels/tree/compile"
import { emptyPageTree } from "@/lib/funnels/tree/schema"
import type { PageTree, RowLayout } from "@/lib/funnels/tree/types"

function treeWithRow(layout: RowLayout, columnCount: number): PageTree {
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

function treeWithElement(kind: string, props: Record<string, unknown>): PageTree {
  const tree = treeWithRow("1", 1)
  tree.sections[0].rows[0].columns[0].elements = [
    { id: "e1", kind: kind as never, style: {}, props },
  ]
  return tree
}

describe("compilePageTree", () => {
  it("compiles an empty tree to no nodes and no problems", () => {
    const { nodes, problems } = compilePageTree(emptyPageTree())
    expect(nodes).toEqual([])
    expect(problems).toEqual([])
  })

  it("emits a section wrapper per section", () => {
    const { nodes } = compilePageTree(treeWithRow("1", 1))
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ t: "el" })
  })

  it("gives a 1-2 row columns with flex 1 and flex 2", () => {
    // MUTANT KILLED: emitting equal columns for every layout, which makes the
    // whole layout picker decorative — every row would look like "1-1" and the
    // owner would have no way to tell why.
    const { nodes } = compilePageTree(treeWithRow("1-2", 2))
    const flat = JSON.stringify(nodes)
    expect(flat).toContain("flex:1")
    expect(flat).toContain("flex:2")
  })

  it("gives a 1-1 row two equal columns", () => {
    const { nodes } = compilePageTree(treeWithRow("1-1", 2))
    const matches = JSON.stringify(nodes).match(/flex:1/g) ?? []
    expect(matches).toHaveLength(2)
  })

  it("compiles an element inside its column", () => {
    const { nodes, problems } = compilePageTree(
      treeWithElement("heading", { html: "Hello", level: 2 }),
    )
    expect(problems).toEqual([])
    expect(JSON.stringify(nodes)).toContain("Hello")
  })

  it("reports an unknown element kind instead of throwing", () => {
    // MUTANT KILLED: letting a bad node take publish down with a stack trace. A
    // page with one broken element must still tell the owner WHICH element,
    // because "publish failed" with no name is unactionable.
    const { problems } = compilePageTree(treeWithElement("carousel", {}))
    expect(problems.join(" ")).toMatch(/carousel/)
  })

  it("reports an element whose props its schema rejects", () => {
    // MUTANT KILLED: trusting stored props because they were stored. A tree can
    // be edited by an older or newer client, and a heading with no html would
    // otherwise compile to an empty tag with no explanation.
    const { problems } = compilePageTree(treeWithElement("heading", { level: 99 }))
    expect(problems.length).toBeGreaterThan(0)
  })

  it("still compiles the good elements around a bad one", () => {
    // MUTANT KILLED: abandoning the whole page at the first problem, which
    // would make a single typo look like total data loss.
    const tree = treeWithRow("1", 1)
    tree.sections[0].rows[0].columns[0].elements = [
      { id: "e1", kind: "heading" as never, style: {}, props: { html: "Good", level: 2 } },
      { id: "e2", kind: "carousel" as never, style: {}, props: {} },
    ]
    const { nodes, problems } = compilePageTree(tree)
    expect(JSON.stringify(nodes)).toContain("Good")
    expect(problems).toHaveLength(1)
  })

  it("carries section styles onto the section wrapper", () => {
    const tree = treeWithRow("1", 1)
    tree.sections[0].style = { background: { color: "#eeeeee" } }
    expect(JSON.stringify(compilePageTree(tree).nodes)).toContain("background-color:#eeeeee")
  })
})
