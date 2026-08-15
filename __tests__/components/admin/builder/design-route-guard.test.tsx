// Which editor a step opens in is decided by the COLUMNS, and until now the
// designer route only ever read ONE of them. `page_tree` is null on every page
// the AI builder has ever made, so the route fell through to `emptyPageTree()`
// and an owner who clicked "design this page" got a blank canvas over a page
// full of content.
//
// That is not merely a confusing screen. Both editors bump the same
// `funnel_steps.doc_revision` (one lock, two writers, deliberately), so the
// first Save on that blank canvas writes an empty tree AND advances the
// revision — after which the AI chat 409s against a page it can still see.
//
// These tests pin the decision table: the designer opens only on a document it
// would actually be editing.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock("@/lib/db/funnels", () => ({
  getFunnelById: vi.fn(),
  getStep: vi.fn(),
}))
vi.mock("@/lib/db/funnel-page-tree", () => ({ getPageTree: vi.fn() }))
vi.mock("@/lib/db/funnel-builder", () => ({ getDraft: vi.fn() }))

const { getFunnelById, getStep } = await import("@/lib/db/funnels")
const { getPageTree } = await import("@/lib/db/funnel-page-tree")
const { getDraft } = await import("@/lib/db/funnel-builder")
const { default: DesignPage } = await import(
  "@/app/(admin)/admin/funnels/[id]/edit/[stepId]/design/page"
)

function aSectionDoc(): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "h1",
        kind: "hero",
        variant: "centered",
        style: {},
        props: {
          headline: "Free trial week",
          primaryCta: { label: "Start", target: { kind: "url", href: "/signup" } },
        },
      },
    ],
  }
}

const params = Promise.resolve({ id: "f1", stepId: "s1" })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getFunnelById).mockResolvedValue({
    id: "f1",
    slug: "free-trial-week",
    name: "Free Trial Week",
  } as never)
  vi.mocked(getStep).mockResolvedValue({
    id: "s1",
    funnel_id: "f1",
    name: "Landing page",
    slug: "landing",
    is_entry: true,
  } as never)
})

describe("the designer route's decision table", () => {
  it("refuses to open a blank canvas over a page the AI built", async () => {
    vi.mocked(getPageTree).mockResolvedValue({ tree: null, revision: 4, treeInvalid: false })
    vi.mocked(getDraft).mockResolvedValue({ doc: aSectionDoc(), docInvalid: false, revision: 4 })

    render(await DesignPage({ params }))

    // The refusal names the real situation rather than showing a canvas.
    expect(screen.getByText(/built in the page builder/i)).toBeInTheDocument()
    // MUTANT KILLED: opening the palette here is the whole defect.
    expect(screen.queryByText("Section")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /open the page builder/i })).toHaveAttribute(
      "href",
      "/admin/funnels/f1/edit/s1",
    )
  })

  it("still opens an empty canvas for a step that holds nothing at all", async () => {
    // Arriving at this URL with no document either way IS the decision to
    // build the page visually. That path must keep working.
    vi.mocked(getPageTree).mockResolvedValue({ tree: null, revision: 0, treeInvalid: false })
    vi.mocked(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 0 })

    render(await DesignPage({ params }))

    expect(screen.getByText("Section")).toBeInTheDocument()
    expect(screen.queryByText(/built in the page builder/i)).not.toBeInTheDocument()
  })

  it("opens the canvas when the step really does have a tree", async () => {
    vi.mocked(getPageTree).mockResolvedValue({
      tree: {
        v: 1,
        engine: "tree",
        theme: { tone: "light", accent: "accent", radius: "soft" },
        sections: [],
      },
      revision: 7,
      treeInvalid: false,
    })
    // A tree page may ALSO carry a stale project_data from before it was
    // converted; the tree wins, because it is what this editor edits.
    vi.mocked(getDraft).mockResolvedValue({ doc: aSectionDoc(), docInvalid: false, revision: 7 })

    render(await DesignPage({ params }))

    expect(screen.getByText("Section")).toBeInTheDocument()
  })

  it("refuses a step whose stored document cannot be read", async () => {
    // Legacy GrapesJS state, or corruption. Opening blank here would let the
    // owner save over a page they still have.
    vi.mocked(getPageTree).mockResolvedValue({ tree: null, revision: 2, treeInvalid: false })
    vi.mocked(getDraft).mockResolvedValue({ doc: null, docInvalid: true, revision: 2 })

    render(await DesignPage({ params }))

    expect(screen.getByText(/cannot be read/i)).toBeInTheDocument()
    expect(screen.queryByText("Section")).not.toBeInTheDocument()
  })

  it("refuses when the stored TREE is the unreadable one", async () => {
    vi.mocked(getPageTree).mockResolvedValue({ tree: null, revision: 2, treeInvalid: true })
    vi.mocked(getDraft).mockResolvedValue({ doc: null, docInvalid: false, revision: 2 })

    render(await DesignPage({ params }))

    expect(screen.getByText(/cannot be read/i)).toBeInTheDocument()
    expect(screen.queryByText("Section")).not.toBeInTheDocument()
  })

  it("does not let a draft-read failure take the designer down", async () => {
    // A page_tree that parses is editable whether or not project_data can be
    // read at all. Losing the designer because the OTHER column's read threw
    // would be a worse outcome than ignoring it.
    vi.mocked(getPageTree).mockResolvedValue({
      tree: {
        v: 1,
        engine: "tree",
        theme: { tone: "light", accent: "accent", radius: "soft" },
        sections: [],
      },
      revision: 3,
      treeInvalid: false,
    })
    vi.mocked(getDraft).mockRejectedValue(new Error("postgrest exploded"))

    render(await DesignPage({ params }))

    expect(screen.getByText("Section")).toBeInTheDocument()
  })
})
