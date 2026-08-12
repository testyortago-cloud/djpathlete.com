// The editor/document boundary. Everything Craft-shaped stops here, so this is
// where a swap of editor library would be absorbed — and where a silent data
// loss would happen if the round trip is lossy.

import { describe, it, expect } from "vitest"
import { treeToCraft, craftToTree, CRAFT_ROOT } from "@/lib/funnels/tree/craft-bridge"
import { pageTreeSchema, emptyPageTree } from "@/lib/funnels/tree/schema"
import type { PageTree } from "@/lib/funnels/tree/types"

const populated: PageTree = {
  v: 1,
  engine: "tree",
  theme: { tone: "dark", accent: "primary", radius: "round" },
  sections: [
    {
      id: "s1",
      style: { background: { color: "#111111" } },
      rows: [
        {
          id: "r1",
          style: {},
          layout: "1-2",
          columns: [
            {
              id: "c1",
              style: {},
              elements: [
                { id: "e1", kind: "heading", style: {}, type: { fontSize: "40px" }, props: { html: "Hi", level: 1 } },
              ],
            },
            {
              id: "c2",
              style: { padding: { top: "8px" } },
              elements: [{ id: "e2", kind: "button", style: {}, props: { label: "Go", href: "/x" } }],
            },
          ],
        },
      ],
    },
  ],
}

describe("round trip", () => {
  it("survives PageTree -> Craft -> PageTree unchanged", () => {
    // MUTANT KILLED: dropping any field in either direction. A lossy bridge
    // deletes the owner's work on the next save and looks like nothing at all
    // went wrong.
    expect(craftToTree(treeToCraft(populated))).toEqual(populated)
  })

  it("round-trips an empty page", () => {
    expect(craftToTree(treeToCraft(emptyPageTree()))).toEqual(emptyPageTree())
  })

  it("produces a document the schema accepts", () => {
    // MUTANT KILLED: a bridge that round-trips its own shape but emits
    // something savePageTree would refuse — the editor would appear to work and
    // fail only on save.
    expect(pageTreeSchema.safeParse(craftToTree(treeToCraft(populated))).success).toBe(true)
  })

  it("keeps node ids stable across two conversions", () => {
    // MUTANT KILLED: generating fresh ids each load, which makes every open
    // look like an edit to anything comparing documents.
    expect(Object.keys(treeToCraft(populated)).sort()).toEqual(
      Object.keys(treeToCraft(populated)).sort(),
    )
  })

  it("preserves the theme", () => {
    expect(craftToTree(treeToCraft(populated)).theme).toEqual(populated.theme)
  })
})

describe("craft node shape", () => {
  it("puts sections under ROOT and marks containers as canvases", () => {
    // MUTANT KILLED: isCanvas false on a container — Craft would refuse to let
    // anything be dropped into it, and the builder would not build.
    const nodes = treeToCraft(populated)
    expect(nodes[CRAFT_ROOT].nodes).toEqual(["s:s1"])
    expect(nodes["s:s1"].isCanvas).toBe(true)
    expect(nodes["r:r1"].isCanvas).toBe(true)
    expect(nodes["c:c1"].isCanvas).toBe(true)
  })

  it("marks leaf elements as non-canvas", () => {
    // MUTANT KILLED: making a heading a canvas, which would let the owner drop
    // a section inside a heading.
    expect(treeToCraft(populated)["e:e1"].isCanvas).toBe(false)
  })

  it("records each node's parent", () => {
    const nodes = treeToCraft(populated)
    expect(nodes["e:e1"].parent).toBe("c:c1")
    expect(nodes["c:c1"].parent).toBe("r:r1")
    expect(nodes["r:r1"].parent).toBe("s:s1")
    expect(nodes["s:s1"].parent).toBe(CRAFT_ROOT)
  })
})

describe("repairing what dragging can break", () => {
  it("pads columns up to what the layout requires", () => {
    // MUTANT KILLED: emitting the columns as-is. Craft lets a user delete a
    // column; the schema then refuses the whole document and the owner cannot
    // save anything until they guess what is wrong.
    const nodes = treeToCraft(populated)
    nodes["r:r1"].nodes = ["c:c1"] // a column was dragged out
    const repaired = craftToTree(nodes)
    expect(repaired.sections[0].rows[0].columns).toHaveLength(2)
    expect(pageTreeSchema.safeParse(repaired).success).toBe(true)
  })

  it("trims columns down to what the layout requires", () => {
    const nodes = treeToCraft(populated)
    nodes["c:c3"] = { ...nodes["c:c1"], props: { columnId: "c3", style: {} }, nodes: [] }
    nodes["r:r1"].nodes = ["c:c1", "c:c2", "c:c3"]
    const repaired = craftToTree(nodes)
    expect(repaired.sections[0].rows[0].columns).toHaveLength(2)
  })

  it("skips an unrecognised element kind rather than losing the page", () => {
    // MUTANT KILLED: throwing on an unknown node. One stray node from a newer
    // client would cost the owner the entire document.
    const nodes = treeToCraft(populated)
    nodes["e:e1"].props.kind = "carousel"
    const result = craftToTree(nodes)
    expect(result.sections[0].rows[0].columns[0].elements).toHaveLength(0)
    expect(result.sections[0].rows[0].columns[1].elements).toHaveLength(1)
  })

  it("falls back to an empty page when ROOT is missing", () => {
    expect(craftToTree({})).toEqual(emptyPageTree())
  })

  it("defaults an unknown layout to a single column", () => {
    const nodes = treeToCraft(populated)
    nodes["r:r1"].props.layout = "9-9-9"
    const result = craftToTree(nodes)
    expect(result.sections[0].rows[0].layout).toBe("1")
    expect(result.sections[0].rows[0].columns).toHaveLength(1)
  })
})
