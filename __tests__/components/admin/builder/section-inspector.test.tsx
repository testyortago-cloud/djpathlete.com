// The inspector emits ops and nothing else. It does not hold the document, does
// not merge, and does not decide whether an edit is legal - `applyOps` on the
// server does all three. So what these tests pin is the SHAPE OF THE OP each
// control produces, plus the two places the panel has to know something the
// canvas cannot: that a cleared optional field means "unset", and that the last
// section cannot be deleted.

// `@testing-library/user-event` is NOT a dependency of this repo, so these use
// `fireEvent`. That is not merely a substitution: the inspector commits on
// BLUR, so a change and a blur have to be fired as two separate events, which
// is exactly the sequence being asserted.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SectionInspector, nextSectionId } from "@/components/admin/funnels/builder/SectionInspector"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

function aDoc(): SectionDoc {
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
          sub: "Full access to the app.",
          primaryCta: { label: "Start", target: { kind: "url", href: "/signup" } },
        },
      },
      {
        id: "b1",
        kind: "bullets",
        variant: "cards",
        style: {},
        props: {
          heading: "What you get",
          items: [
            { title: "Program", body: "Built for you." },
            { title: "Numbers", body: "Tracked." },
          ],
        },
      },
    ],
  }
}

const onOps = vi.fn()

function mount(overrides: Partial<Parameters<typeof SectionInspector>[0]> = {}) {
  const props = {
    doc: aDoc(),
    selectedId: "h1",
    selectedPath: null,
    onOps,
    busy: false,
    ...overrides,
  }
  return render(<SectionInspector {...props} />)
}

beforeEach(() => {
  vi.clearAllMocks()
})

/** Type into a field and leave it, which is when the inspector commits. */
function editField(label: RegExp, value: string) {
  const input = screen.getByLabelText(label)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
  return input
}

describe("SectionInspector", () => {
  it("invites a click on the page when nothing is selected", () => {
    mount({ selectedId: null })
    expect(screen.getByText(/click anything on the page/i)).toBeInTheDocument()
  })

  it("shows the selected section's fields and not another section's", () => {
    mount()
    expect(screen.getByLabelText(/headline/i)).toBeInTheDocument()
    // MUTANT KILLED: rendering fields for the wrong section, or for all of them.
    expect(screen.queryByLabelText(/^heading$/i)).not.toBeInTheDocument()
  })

  it("sends an update_section op when a field is edited", () => {
    mount()
    editField(/headline/i, "A shorter headline")
    expect(onOps).toHaveBeenCalledWith([
      { op: "update_section", id: "h1", props: { headline: "A shorter headline" } },
    ])
  })

  it("unsets an optional field that is cleared, rather than storing an empty string", async () => {
    // `null` is `applyOps`'s explicit delete sentinel and the only way to remove
    // a key over JSON. Storing "" instead would render an empty element where
    // the placeholder should be, and the owner could never get the placeholder
    // back.
    mount()
    editField(/subheading/i, "")
    expect(onOps).toHaveBeenCalledWith([{ op: "update_section", id: "h1", props: { sub: null } }])
  })

  it("sends no op when a field is blurred unchanged", () => {
    // MUTANT KILLED: firing on every blur. Each op is a revision bump, so
    // tabbing through the panel would 409 the owner's other tab for nothing.
    mount()
    fireEvent.blur(screen.getByLabelText(/headline/i))
    expect(onOps).not.toHaveBeenCalled()
  })

  it("changes the layout through the variant the registry allows", () => {
    mount()
    fireEvent.change(screen.getByLabelText(/layout/i), { target: { value: "split" } })
    expect(onOps).toHaveBeenCalledWith([{ op: "update_section", id: "h1", variant: "split" }])
  })

  it("moves a section with move_section, using null for the very top", () => {
    // `after: null` is the ONLY way to express "before everything" - there is
    // no section to sit after.
    mount({ selectedId: "b1" })
    fireEvent.click(screen.getByRole("button", { name: /move section up/i }))
    expect(onOps).toHaveBeenCalledWith([{ op: "move_section", id: "b1", after: null }])
  })

  it("cannot move the first section up or the last one down", () => {
    mount({ selectedId: "h1" })
    expect(screen.getByRole("button", { name: /move section up/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /move section down/i })).not.toBeDisabled()
  })

  it("duplicates a section with a fresh id, right after the original", () => {
    mount()
    fireEvent.click(screen.getByRole("button", { name: /duplicate section/i }))

    const [ops] = onOps.mock.calls[0]
    expect(ops[0].op).toBe("add_section")
    expect(ops[0].after).toBe("h1")
    expect(ops[0].section.id).not.toBe("h1")
    expect(ops[0].section.props.headline).toBe("Free trial week")
  })

  it("refuses to delete the last section", () => {
    // `sectionDocSchema` bounds sections at 1..24, so this save can only fail.
    // Disabling the control is how the owner learns that; letting them click it
    // means the page visibly loses a section and then puts it back.
    const single = aDoc()
    single.sections = [single.sections[0]]
    mount({ doc: single })
    expect(screen.getByRole("button", { name: /delete section/i })).toBeDisabled()
  })

  it("deletes a section when there is more than one", () => {
    mount()
    fireEvent.click(screen.getByRole("button", { name: /delete section/i }))
    expect(onOps).toHaveBeenCalledWith([{ op: "remove_section", id: "h1" }])
  })

  it("points repeating content at the page instead of duplicating it here", () => {
    // Two controls for one value, and the panel's would be the worse of the
    // two: it has no layout context. The items already carry their own anchors
    // on the canvas.
    mount({ selectedId: "b1" })
    expect(screen.getByText(/2 items/i)).toBeInTheDocument()
    expect(screen.getByText(/double-click an item on the page/i)).toBeInTheDocument()
  })

  it("disables every control while a turn is in flight", () => {
    mount({ busy: true })
    expect(screen.getByLabelText(/headline/i)).toBeDisabled()
    expect(screen.getByRole("button", { name: /delete section/i })).toBeDisabled()
  })
})

describe("nextSectionId", () => {
  it("produces an id the schema accepts and the document has not used", () => {
    const doc = aDoc()
    const id = nextSectionId(doc, "hero")
    expect(id).toMatch(/^[a-z][a-z0-9-]{0,39}$/)
    expect(doc.sections.map((s) => s.id)).not.toContain(id)
  })

  it("keeps stepping past ids already taken", () => {
    const doc = aDoc()
    doc.sections[0].id = "he1"
    expect(nextSectionId(doc, "hero")).toBe("he2")
  })
})
