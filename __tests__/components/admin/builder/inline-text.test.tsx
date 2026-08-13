// Inline text editing. Until now the only way to change a heading was a
// <Textarea> in the sidebar, which is the one place the builder did not feel
// like the tool it is imitating.
//
// The first test is a MOUNT test, for the same reason craft-mounts.test.tsx
// exists: TipTap is used elsewhere in this app but has never been mounted under
// jsdom here, and building an editing mode on a library that cannot mount in
// the test environment would leave every later test unable to fail honestly.
//
// `fireEvent`, not `@testing-library/user-event`: that package is not a
// dependency of this repo. Same deviation, same reason, as
// __tests__/components/admin/funnel-builder.test.tsx:16-19.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { InlineText } from "@/components/admin/funnels/design/InlineText"
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
        rows: [{ id: "r1", style: {}, layout: "1", columns: [{ id: "c1", style: {}, elements }] }],
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

describe("<InlineText>", () => {
  it("mounts a contenteditable surface under jsdom", () => {
    // MUTANT KILLED: assuming TipTap mounts here because it mounts in the blog
    // editor. If it cannot mount, every test below would pass vacuously by
    // finding nothing and asserting nothing.
    const { container } = render(<InlineText html="<p>Hello</p>" onCommit={vi.fn()} />)
    expect(container.querySelector('[contenteditable="true"]')).not.toBeNull()
  })

  it("shows the html it was given", () => {
    // MUTANT KILLED: mounting an empty editor, which on blur would commit ""
    // and silently erase the element's text.
    render(<InlineText html="<p>Existing copy</p>" onCommit={vi.fn()} />)
    expect(screen.getByText("Existing copy")).toBeInTheDocument()
  })

  it("commits its html on blur", () => {
    // MUTANT KILLED: an editor that renders and is never read back, so typing
    // on the page changes nothing once you click away.
    const onCommit = vi.fn()
    const { container } = render(<InlineText html="<p>Draft</p>" onCommit={onCommit} />)
    fireEvent.blur(container.querySelector('[contenteditable="true"]') as Element)
    expect(onCommit).toHaveBeenCalledWith(expect.stringContaining("Draft"))
  })

  it("does not wrap bare text in a paragraph it did not arrive with", () => {
    // MUTANT KILLED: committing TipTap's getHTML() verbatim. A heading stores
    // BARE text and `heading.compile` drops it straight inside <h{level}>, so a
    // returned <p> yields <h2><p>…</p></h2> — invalid nesting, and the
    // paragraph's own margins visibly break the heading's spacing.
    const onCommit = vi.fn()
    const { container } = render(<InlineText html="Bare headline" onCommit={onCommit} />)
    fireEvent.blur(container.querySelector('[contenteditable="true"]') as Element)

    expect(onCommit).toHaveBeenCalledWith(expect.stringContaining("Bare headline"))
    expect(onCommit).toHaveBeenCalledWith(expect.not.stringContaining("<p>"))
  })

  it("keeps the paragraph on content that already had one", () => {
    // MUTANT KILLED: stripping <p> unconditionally, which would flatten the
    // text element — whose default IS a paragraph — into bare inline content
    // and lose the block structure the compiler expects.
    const onCommit = vi.fn()
    const { container } = render(<InlineText html="<p>Body copy</p>" onCommit={onCommit} />)
    fireEvent.blur(container.querySelector('[contenteditable="true"]') as Element)

    expect(onCommit).toHaveBeenCalledWith(expect.stringContaining("<p>"))
  })
})

describe("inline editing on the canvas", () => {
  it("opens an editor when a heading is double-clicked", () => {
    // MUTANT KILLED: leaving text editable only from the sidebar, which is the
    // gap this task exists to close.
    const { container } = render(<DesignEditor {...base} initialTree={headingTree} />)
    fireEvent.doubleClick(screen.getByText("Canvas headline"))
    expect(container.querySelector('[contenteditable="true"]')).not.toBeNull()
  })

  it("leaves a divider alone, because it declares no richtext field", () => {
    // MUTANT KILLED: making every element editable, so double-clicking a
    // divider opens an editor bound to a prop that does not exist.
    const { container } = render(<DesignEditor {...base} initialTree={dividerTree} />)
    fireEvent.doubleClick(container.querySelector('[data-kind="divider"]') as Element)
    expect(container.querySelector('[contenteditable="true"]')).toBeNull()
  })

  it("stops the block being draggable while its text is being edited", () => {
    // MUTANT KILLED: leaving Craft's drag connector attached, so dragging to
    // select a word picks the whole block up and drops it somewhere else.
    const { container } = render(<DesignEditor {...base} initialTree={headingTree} />)
    const wrapper = container.querySelector('[data-kind="heading"]') as HTMLElement
    expect(wrapper.getAttribute("draggable")).toBe("true")

    fireEvent.doubleClick(screen.getByText("Canvas headline"))
    expect(
      (container.querySelector('[data-kind="heading"]') as HTMLElement).getAttribute("draggable"),
    ).not.toBe("true")
  })

  it("returns to the compiled output once editing ends", () => {
    // MUTANT KILLED: leaving the editor mounted after blur. The canvas would
    // keep showing TipTap's rendering instead of the compiler's, quietly
    // suspending the WYSIWYG guarantee for the rest of the session.
    const { container } = render(<DesignEditor {...base} initialTree={headingTree} />)
    fireEvent.doubleClick(screen.getByText("Canvas headline"))
    fireEvent.blur(container.querySelector('[contenteditable="true"]') as Element)

    expect(container.querySelector('[contenteditable="true"]')).toBeNull()
    expect(screen.getByText("Canvas headline")).toBeInTheDocument()
  })

  it("never lets editing state reach the saved document", () => {
    // MUTANT KILLED: persisting the editing flag. `craftToTree` reads five
    // named props and would ignore it, but a future change that spreads props
    // would write session state into the document and this catches it there.
    const { container } = render(<DesignEditor {...base} initialTree={headingTree} />)
    fireEvent.doubleClick(screen.getByText("Canvas headline"))
    fireEvent.blur(container.querySelector('[contenteditable="true"]') as Element)
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))

    const body = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body
    expect(String(body)).not.toContain("editing")
  })
})
