// The editor shell. jsdom cannot perform a real drag, so these cover what it
// CAN: that the palette offers what the registry declares, that a stored tree
// renders onto the canvas, and that an unreadable document refuses to open
// rather than opening blank.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { DesignEditor } from "@/components/admin/funnels/design/DesignEditor"
import { ELEMENT_LIST } from "@/lib/funnels/tree/elements"
import { ROW_LAYOUTS } from "@/lib/funnels/tree/types"
import type { PageTree } from "@/lib/funnels/tree/types"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const tree: PageTree = {
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
          layout: "1-1",
          columns: [
            {
              id: "c1",
              style: {},
              elements: [
                { id: "e1", kind: "heading", style: {}, props: { html: "Canvas headline", level: 2 } },
              ],
            },
            { id: "c2", style: {}, elements: [] },
          ],
        },
      ],
    },
  ],
}

const base = {
  stepId: "s1",
  stepName: "Landing page",
  funnelId: "f1",
  publicUrl: "/go/x",
  initialRevision: 3,
  treeInvalid: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ revision: 4 }),
  })) as unknown as typeof fetch
})

describe("<DesignEditor>", () => {
  it("refuses to open a document it cannot read", () => {
    // MUTANT KILLED: falling back to an empty canvas. The owner's next save
    // would write the blank page over content that was still recoverable —
    // a helpful default destroying data.
    render(<DesignEditor {...base} initialTree={tree} treeInvalid />)
    expect(screen.getByText(/cannot be read/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument()
  })

  it("offers every registered element in the palette", () => {
    // MUTANT KILLED: a hand-written palette that drifts from the registry, so
    // an element exists with a compiler and no way to place it.
    render(<DesignEditor {...base} initialTree={tree} />)
    for (const def of ELEMENT_LIST) {
      expect(screen.getByText(def.label)).toBeInTheDocument()
    }
  })

  it("offers every row layout", () => {
    render(<DesignEditor {...base} initialTree={tree} />)
    for (const layout of ROW_LAYOUTS) {
      expect(screen.getByText(layout.replace(/-/g, " / "))).toBeInTheDocument()
    }
  })

  it("renders the stored tree onto the canvas", () => {
    // MUTANT KILLED: mounting an empty Frame and ignoring initialTree, which
    // would look like every page had lost its content.
    render(<DesignEditor {...base} initialTree={tree} />)
    expect(screen.getByText("Canvas headline")).toBeInTheDocument()
  })

  it("scopes the canvas with the published stylesheet's root id", () => {
    // MUTANT KILLED: dropping #djp-funnel-root, which lets page styles escape
    // into the admin app — the exact leak scopeCss exists to prevent.
    const { container } = render(<DesignEditor {...base} initialTree={tree} />)
    expect(container.querySelector("#djp-funnel-root")).not.toBeNull()
  })

  it("prompts to select something when nothing is selected", () => {
    render(<DesignEditor {...base} initialTree={tree} />)
    expect(screen.getByText(/select something on the page/i)).toBeInTheDocument()
  })
})
