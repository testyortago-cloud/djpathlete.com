// The style inspector. `styleToCss` has always compiled roughly seventeen
// properties; before this the inspector offered three of them, so the rest were
// reachable only by hand-editing the stored document. These cover that the
// controls exist, that they are offered ONLY where the compiler honours them,
// and — the one that matters — that turning a control changes what the canvas
// renders rather than only what the panel remembers.
//
// `fireEvent`, not `@testing-library/user-event`: that package is not a
// dependency of this repo. Same deviation, same reason, as
// __tests__/components/admin/funnel-builder.test.tsx:16-19.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { DesignEditor } from "@/components/admin/funnels/design/DesignEditor"
import type { PageTree } from "@/lib/funnels/tree/types"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function treeWith(...elements: PageTree["sections"][0]["rows"][0]["columns"][0]["elements"]): PageTree {
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
            layout: "1",
            columns: [{ id: "c1", style: {}, elements }],
          },
        ],
      },
    ],
  }
}

const headingTree = treeWith({
  id: "e1",
  kind: "heading",
  style: {},
  props: { html: "Canvas headline", level: 2 },
})

const dividerTree = treeWith({ id: "e1", kind: "divider", style: {}, props: {} })

const base = {
  stepId: "s1",
  stepName: "Landing page",
  funnelId: "f1",
  publicUrl: "/go/x",
  initialRevision: 3,
}

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ revision: 4 }),
  })) as unknown as typeof fetch
})

describe("style inspector", () => {
  it("offers every box style group once an element is selected", async () => {
    // MUTANT KILLED: shipping the three controls that already existed and
    // calling the stage done. Padding-top, background colour and align are a
    // fraction of what styleToCss compiles; the rest were unreachable.
    render(<DesignEditor {...base} initialTree={headingTree} />)
    fireEvent.mouseDown(screen.getByText("Canvas headline"))

    // Scoped to the inspector: the palette has its own "Layout" heading for row
    // layouts, so an unscoped query matches two unrelated things.
    const panel = within(screen.getByRole("complementary", { name: /inspector/i }))
    for (const group of ["Spacing", "Background", "Border", "Layout"]) {
      expect(panel.getByText(group)).toBeInTheDocument()
    }
  })

  it("offers all four sides of padding and margin", async () => {
    // MUTANT KILLED: keeping a single "Padding top" input. `sides()` emits
    // longhand precisely so each side is independent, and only a control per
    // side makes that reachable.
    render(<DesignEditor {...base} initialTree={headingTree} />)
    fireEvent.mouseDown(screen.getByText("Canvas headline"))

    const spacing = screen.getByRole("group", { name: /spacing/i })
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(within(spacing).getByLabelText(new RegExp(`padding ${side}`, "i"))).toBeInTheDocument()
      expect(within(spacing).getByLabelText(new RegExp(`margin ${side}`, "i"))).toBeInTheDocument()
    }
  })

  it("offers typography on a heading, whose compile honours it", async () => {
    // MUTANT KILLED: hiding the five TypeStyle fields everywhere, which is the
    // state this stage exists to end.
    render(<DesignEditor {...base} initialTree={headingTree} />)
    fireEvent.mouseDown(screen.getByText("Canvas headline"))

    expect(screen.getByText("Typography")).toBeInTheDocument()
    expect(screen.getByLabelText(/font size/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/line height/i)).toBeInTheDocument()
  })

  it("withholds typography from a divider, whose compile discards it", async () => {
    // MUTANT KILLED: rendering the Typography group unconditionally, giving a
    // divider a font-size box that looks exactly like a working control and is
    // discarded the moment the page is published.
    const { container } = render(<DesignEditor {...base} initialTree={dividerTree} />)
    const divider = container.querySelector('[data-kind="divider"]')
    expect(divider).not.toBeNull()
    fireEvent.mouseDown(divider as Element)

    expect(screen.queryByText("Typography")).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/font size/i)).not.toBeInTheDocument()
  })

  it("writes a style change through to what the canvas renders", async () => {
    // MUTANT KILLED: a control bound to local component state that never
    // reaches Craft. The panel would look correct, the page would not change,
    // and a save would persist the untouched document.
    const { container } = render(<DesignEditor {...base} initialTree={headingTree} />)
    fireEvent.mouseDown(screen.getByText("Canvas headline"))

    fireEvent.change(screen.getByLabelText(/padding left/i), { target: { value: "37px" } })

    // React serialises inline styles with a space after the colon, so this
    // tolerates the whitespace rather than the exact string styleToCss emits.
    const canvas = container.querySelector('[data-kind="heading"]')
    expect(canvas?.innerHTML).toMatch(/padding-left:\s*37px/)
  })

  it("writes a typography change through to what the canvas renders", async () => {
    // MUTANT KILLED: patching props.style with typography values instead of
    // props.type. styleToCss takes TypeStyle as a SECOND argument, so a
    // font-size written into BoxStyle is dropped silently.
    const { container } = render(<DesignEditor {...base} initialTree={headingTree} />)
    fireEvent.mouseDown(screen.getByText("Canvas headline"))

    fireEvent.change(screen.getByLabelText(/font size/i), { target: { value: "73px" } })

    const canvas = container.querySelector('[data-kind="heading"]')
    expect(canvas?.innerHTML).toMatch(/font-size:\s*73px/)
  })
})
