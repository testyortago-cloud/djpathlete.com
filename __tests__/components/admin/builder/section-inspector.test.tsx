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
import { render, screen, fireEvent, within } from "@testing-library/react"
import { SectionInspector, nextSectionId } from "@/components/admin/funnels/builder/SectionInspector"
import { ConnectionsProvider } from "@/components/admin/funnels/connections-context"
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

/**
 * The inspector as it renders INSIDE the funnel edit layout, which is the only
 * place it can offer other pages as destinations.
 *
 * `mount()` above deliberately keeps rendering it bare, because that is also a
 * real configuration — the landing-page editor and the preview harness — and
 * the picker has to degrade there rather than throw.
 */
function mountInFunnel(overrides: Partial<Parameters<typeof SectionInspector>[0]> = {}) {
  const pages = [
    { id: "s1", name: "Opt-in", slug: "index", position: 0, isEntry: true, published: true, live: true },
    { id: "s2", name: "Thanks", slug: "thanks", position: 1, isEntry: false, published: false, live: false },
  ]
  return render(
    <ConnectionsProvider
      funnelId="f1"
      funnelSlug="camp"
      funnelKind="funnel"
      pages={pages}
      initialDocs={pages.map((page) => ({ ...page, doc: null }))}
    >
      <SectionInspector
        doc={aDoc()}
        selectedId="h1"
        selectedPath={null}
        onOps={onOps}
        busy={false}
        {...overrides}
      />
    </ConnectionsProvider>,
  )
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

  it("lists repeating items by their own text, and points wording edits at the page", () => {
    // HOW MANY and IN WHAT ORDER belong here; WHAT EACH SAYS belongs on the
    // canvas, where the item already carries its anchors and its layout.
    mount({ selectedId: "b1" })
    expect(screen.getByText("Program")).toBeInTheDocument()
    expect(screen.getByText("Numbers")).toBeInTheDocument()
    expect(screen.getByText(/double-click an item on the page/i)).toBeInTheDocument()
  })

  it("adds an item the schema will accept", () => {
    mount({ selectedId: "b1" })
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }))

    const [ops] = onOps.mock.calls[0]
    expect(ops[0].op).toBe("update_section")
    // The WHOLE array, because applyOps merges props shallow per top-level key.
    expect(ops[0].props.items).toHaveLength(3)
    // MUTANT KILLED: appending `{}`. `bulletItemSchema.title` is min(1), so an
    // empty item is refused and the owner is told a field they never saw is
    // invalid. `blankItemFor` is proven against the real validator in
    // fields.test.ts; this checks the panel actually uses it.
    expect(ops[0].props.items[2].title).toEqual(expect.any(String))
    expect(ops[0].props.items[2].title.length).toBeGreaterThan(0)
  })

  it("reorders an item without touching its content", () => {
    mount({ selectedId: "b1" })
    fireEvent.click(screen.getByRole("button", { name: /move items 2 up/i }))

    const [ops] = onOps.mock.calls[0]
    expect(ops[0].props.items.map((i: { title: string }) => i.title)).toEqual(["Numbers", "Program"])
  })

  it("removes an item", () => {
    const doc = aDoc()
    doc.sections[1].props.items = [
      { title: "One" },
      { title: "Two" },
      { title: "Three" },
    ] as never
    mount({ doc, selectedId: "b1" })

    fireEvent.click(screen.getByRole("button", { name: /remove items 2/i }))
    const [ops] = onOps.mock.calls[0]
    expect(ops[0].props.items.map((i: { title: string }) => i.title)).toEqual(["One", "Three"])
  })

  it("refuses to remove past the schema's own lower bound", () => {
    // `bulletsPropsSchema.items` is min(2). Removing a third would produce a
    // document applyOps refuses, so the row would vanish from the page and come
    // straight back.
    mount({ selectedId: "b1" })
    expect(screen.getByRole("button", { name: /remove items 1/i })).toBeDisabled()
  })

  it("refuses to add past the schema's upper bound", () => {
    const doc = aDoc()
    doc.sections[1].props.items = Array.from({ length: 6 }, (_, i) => ({ title: `B${i}` })) as never
    mount({ doc, selectedId: "b1" })
    expect(screen.getByRole("button", { name: /^add$/i })).toBeDisabled()
  })

  it("withholds Add where a generated blank could collide, and says why", () => {
    // `funnelFormFieldSchema.name` is `^[a-z0-9_]+$` and not unique-checked, so
    // two generated fields both named `name` would submit one value — the
    // second silently eating the first's lead data. Reorder and remove stay.
    const doc = aDoc()
    doc.sections.push({
      id: "fm1",
      kind: "form",
      variant: "boxed",
      style: {},
      props: {
        formKey: "trial",
        fields: [
          { name: "email", label: "Email", type: "email", required: true },
          { name: "phone", label: "Phone", type: "tel", required: false },
        ],
      },
    } as never)
    mount({ doc, selectedId: "fm1" })

    // Scoped to the Fields group: a form ALSO has `proofPoints`, which is a
    // plain string list and stays freely growable. An unscoped query here found
    // that one and passed for the wrong reason.
    const fields = within(screen.getByRole("group", { name: "Fields" }))
    expect(fields.queryByRole("button", { name: /^add$/i })).not.toBeInTheDocument()
    expect(fields.getByText(/unique name/i)).toBeInTheDocument()
    expect(fields.getByRole("button", { name: /move fields 2 up/i })).not.toBeDisabled()

    // The other list on the same section is unaffected.
    expect(
      within(screen.getByRole("group", { name: /reassurance/i })).getByRole("button", { name: /^add$/i }),
    ).toBeInTheDocument()
  })

  it("disables every control while a turn is in flight", () => {
    mount({ busy: true })
    expect(screen.getByLabelText(/headline/i)).toBeDisabled()
    expect(screen.getByRole("button", { name: /delete section/i })).toBeDisabled()
  })

  // -------------------------------------------------------------------------
  // The CTA control.
  //
  // `fieldsForSection` reports a CTA as ONE field of type "cta", and this panel
  // had no branch for it: the value fell through to the plain text input at the
  // bottom of `FieldControl`, which reads `typeof value === "string"`, found an
  // OBJECT, and rendered an empty box labelled "Primary CTA". Blurring that box
  // wrote a bare string over `{label, target}` — an op `applyOps` refuses, so
  // the only thing the control could do was produce "that change could not be
  // applied". It shipped that way with a green suite because no test opened it.
  // -------------------------------------------------------------------------

  it("shows the CTA's real label rather than an empty box", () => {
    mount()
    expect(screen.getByLabelText(/primary cta/i)).toHaveValue("Start")
  })

  it("edits the CTA's LABEL, never the whole CTA", () => {
    // MUTANT KILLED: `onChange(field.path, value)`. That replaces
    // `{label, target}` with a string and loses where the button goes.
    mount()
    editField(/primary cta/i, "Start my free week")
    expect(onOps).toHaveBeenCalledWith([
      {
        op: "update_section",
        id: "h1",
        props: { primaryCta: { label: "Start my free week", target: { kind: "url", href: "/signup" } } },
      },
    ])
  })

  it("refuses to clear a CTA label instead of sending an op that must fail", () => {
    // `ctaWithLabelSchema.label` is `min(1)`. Sending "" earns a server refusal
    // reported as "that change could not be applied", which names no rule and
    // reads like a bug in the editor.
    mount()
    const input = editField(/primary cta/i, "   ")
    expect(onOps).not.toHaveBeenCalled()
    expect(input).toHaveValue("Start")
  })

  it("still says where the button goes, UNDER the picker rather than instead of it", () => {
    // This test used to assert "ask in the chat to send this button somewhere
    // else" — the panel's old refusal to edit a destination at all. That
    // sentence is gone for pickable targets, deliberately: the owner's
    // complaint was that connecting two pages required describing a button in
    // prose while looking straight at it.
    //
    // The plain-English sentence survives BECAUSE it does a different job from
    // the picker. The picker says what may be chosen; this says what the button
    // does right now, in one line, including for the offer targets the picker
    // will not touch.
    mount()
    expect(screen.getByText(/goes to \/signup/i)).toBeInTheDocument()
  })

  it("offers the funnel's other pages as destinations", () => {
    mountInFunnel()
    // SCOPED to the one control. A hero lists `primaryCta` AND `secondaryCta`,
    // so an unscoped option query would find whichever rendered first and pass
    // for the wrong reason — the exact trap this repo has hit twice.
    const picker = screen.getByLabelText(/goes to/i)
    expect(within(picker).getByRole("option", { name: "Thanks" })).toBeInTheDocument()
  })

  it("writes a page destination as a TARGET OBJECT through the ops path", () => {
    // MUTANT KILLED: sending the slug as a bare string. `applyOps` refuses a
    // string where a CTA object belongs, and the owner is told their change
    // "could not be applied" for a rule they were never shown — which is the
    // exact failure the CTA branch of this panel was written to close.
    mountInFunnel()
    fireEvent.change(screen.getByLabelText(/goes to/i), { target: { value: "step:thanks" } })
    expect(onOps).toHaveBeenCalledWith([
      {
        op: "update_section",
        id: "h1",
        props: { primaryCta: { label: "Start", target: { kind: "step", stepSlug: "thanks" } } },
      },
    ])
  })

  it("offers this page's own sections as scroll destinations", () => {
    mountInFunnel()
    const picker = screen.getByLabelText(/goes to/i)
    // `b1` is the bullets section in `aDoc`. In-PAGE anchors come from the
    // whole document, not from the selected section.
    expect(within(picker).getByRole("option", { name: "b1" })).toBeInTheDocument()
  })

  it("will not pick a destination for an offer button — that is still the chat's job", () => {
    // The old refusal's REASON survives even though its blanket application
    // does not: a program ref only means anything once `resolve.ts` matches it
    // against live rows, so a picker here would be a second, weaker resolver.
    const doc = aDoc()
    ;(doc.sections[0].props as Record<string, unknown>).primaryCta = {
      label: "Buy",
      target: { kind: "program", ref: "Comeback Code" },
    }
    mountInFunnel({ doc })
    expect(screen.queryByLabelText(/goes to/i)).toBeNull()
    expect(screen.getByText(/ask in the chat to send this button somewhere else/i)).toBeInTheDocument()
  })

  it("offers no label box for an optional CTA the section does not have", () => {
    // MUTANT KILLED: rendering the label input regardless. `fieldsForSection`
    // lists `secondaryCta` whether or not the hero has one, so an input there
    // sends `{secondaryCta: {label}}` with no `target` — refused by `applyOps`,
    // and reported to the owner as "that change could not be applied" for a
    // rule nothing showed them.
    mount()
    expect(screen.queryByLabelText(/secondary cta/i)).toBeNull()
    expect(screen.getByText(/no secondary cta\. ask in the chat/i)).toBeInTheDocument()
  })

  it("describes an island-backed target by what it does", () => {
    const doc = aDoc()
    doc.sections[0].props = {
      ...doc.sections[0].props,
      primaryCta: { label: "Reserve a spot", target: { kind: "program", ref: "Summer Speed Camp" } },
    }
    mount({ doc })
    expect(screen.getByText(/buys the program "Summer Speed Camp"/i)).toBeInTheDocument()
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
