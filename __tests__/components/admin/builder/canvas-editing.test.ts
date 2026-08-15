// The click-to-edit gestures, tested against a plain Document.
//
// No iframe and no React: `bindCanvasEditing` is a function over a Document
// precisely so the gestures can be exercised directly. The markup below is the
// shape `render.ts` emits in editable mode — `data-sec` on the section,
// `data-edit` naming a path within that section's props, `data-edit-empty` on a
// placeholder.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { bindCanvasEditing, asElement } from "@/components/admin/funnels/builder/canvas-editing"

const MARKUP = `
<section id="h1" data-sec="h1">
  <h1 class="djp-hd" data-edit="headline">Free trial week</h1>
  <p class="djp-sub djp-empty" data-edit="sub" data-edit-empty="1">Add a subheading</p>
  <div class="djp-hero-media" data-edit-image="media"><img src="/a.jpg" alt="" /></div>
  <a class="djp-btn" href="/signup" data-edit="primaryCta.label">Start my free week</a>
</section>
<section id="c1" data-sec="c1">
  <h2 class="djp-hd" data-edit="headline">Ready?</h2>
</section>
`

let cleanup: (() => void) | null = null
const onSelect = vi.fn()
const onCommit = vi.fn()
const onPickImage = vi.fn()

function bind() {
  document.body.innerHTML = MARKUP
  cleanup = bindCanvasEditing(document, { onSelect, onCommit, onPickImage })
}

function el(selector: string): HTMLElement {
  const found = document.querySelector(selector)
  if (!(found instanceof HTMLElement)) throw new Error(`no element for ${selector}`)
  return found
}

function click(selector: string) {
  el(selector).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
}

function dblclick(selector: string) {
  el(selector).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))
}

function key(selector: string, k: string, shiftKey = false) {
  el(selector).dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true }))
}

function blur(selector: string) {
  el(selector).dispatchEvent(new FocusEvent("blur", { bubbles: false }))
}

beforeEach(() => {
  vi.clearAllMocks()
  bind()
})

afterEach(() => {
  cleanup?.()
  cleanup = null
  document.body.innerHTML = ""
})

describe("nodes from the canvas's own realm", () => {
  // THE BUG THIS FILE MISSED. The canvas is an iframe, so its `Element` is a
  // DIFFERENT constructor from this window's: `target instanceof Element` is
  // FALSE for every node in the page being edited. The click handler bailed on
  // its first line and the whole editor was inert in production while all 20
  // tests below passed — because jsdom binds and dispatches inside ONE realm,
  // where `instanceof` happens to hold.
  //
  // jsdom cannot hand a test a genuinely foreign node, but the property that
  // actually matters is testable: recognise a thing by what it can DO, never by
  // which window minted it.

  it("recognises an element-like value that is not instanceof Element", () => {
    const foreign = {
      closest: (selector: string) => (selector === "[data-sec]" ? foreign : null),
      getAttribute: (name: string) => (name === "data-sec" ? "hero" : null),
      classList: { add() {}, remove() {}, contains: () => false },
      contains: () => false,
    }
    expect(foreign instanceof Element).toBe(false)
    expect(asElement(foreign)).not.toBeNull()
  })

  it("still recognises a real element", () => {
    document.body.innerHTML = `<div id="x"></div>`
    expect(asElement(document.getElementById("x"))).not.toBeNull()
  })

  it("refuses things that cannot answer closest", () => {
    expect(asElement(null)).toBeNull()
    expect(asElement("a string")).toBeNull()
    expect(asElement({ getAttribute: () => null })).toBeNull()
    expect(asElement(document)).toBeNull()
  })
})

describe("selection", () => {
  it("selects the field under the pointer, with the section that owns it", () => {
    click('[data-edit="headline"]')
    expect(onSelect).toHaveBeenCalledWith({ sectionId: "h1", path: "headline" })
  })

  it("selects the section itself when the hit is not on a field", () => {
    click("section#c1")
    expect(onSelect).toHaveBeenCalledWith({ sectionId: "c1", path: null })
  })

  it("never fires a side effect on a single click", () => {
    // Single click selects and NOTHING else. The design this is ported from
    // records the opposite precedence making a full-bleed hero unselectable.
    click('[data-edit-image="media"]')
    expect(onPickImage).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("does not navigate away when a link in the page is clicked", () => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true })
    el("a[href]").dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(onSelect).toHaveBeenCalledWith({ sectionId: "h1", path: "primaryCta.label" })
  })

  it("marks the selected section and unmarks the previous one", () => {
    click('[data-edit="headline"]')
    expect(el("section#h1").classList.contains("djp-selected")).toBe(true)
    click('section#c1 [data-edit="headline"]')
    expect(el("section#h1").classList.contains("djp-selected")).toBe(false)
    expect(el("section#c1").classList.contains("djp-selected")).toBe(true)
  })

  it("stops reporting once unbound", () => {
    // MUTANT KILLED: a cleanup that does not remove its listeners. The preview
    // rebinds on every reload, so a leak means one click reported N times.
    cleanup?.()
    cleanup = null
    click('[data-edit="headline"]')
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe("inline text editing", () => {
  it("makes a field editable on double click", () => {
    dblclick('[data-edit="headline"]')
    expect(el('[data-edit="headline"]').isContentEditable || el('[data-edit="headline"]').contentEditable).toBeTruthy()
  })

  it("commits the new text on Enter", () => {
    dblclick('[data-edit="headline"]')
    el('[data-edit="headline"]').textContent = "A shorter headline"
    key('[data-edit="headline"]', "Enter")
    expect(onCommit).toHaveBeenCalledWith({
      sectionId: "h1",
      path: "headline",
      value: "A shorter headline",
      wasEmpty: false,
    })
  })

  it("commits on blur too", () => {
    dblclick('[data-edit="headline"]')
    el('[data-edit="headline"]').textContent = "Changed"
    blur('[data-edit="headline"]')
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it("cancels on Escape and puts the original text back", () => {
    dblclick('[data-edit="headline"]')
    el('[data-edit="headline"]').textContent = "Half-typed"
    key('[data-edit="headline"]', "Escape")
    expect(onCommit).not.toHaveBeenCalled()
    expect(el('[data-edit="headline"]').textContent).toBe("Free trial week")
  })

  it("does not commit when nothing actually changed", () => {
    // MUTANT KILLED: committing on every blur. Each commit is a revision bump,
    // so clicking through a page would 409 the owner's other tab for nothing.
    dblclick('[data-edit="headline"]')
    blur('[data-edit="headline"]')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("leaves Shift+Enter alone so a line break is still possible", () => {
    dblclick('[data-edit="headline"]')
    const event = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true })
    el('[data-edit="headline"]').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("commits the text and never the markup", () => {
    // A contenteditable will happily accept a paste full of tags, and a
    // SectionDoc stores plain strings — the renderer owns every tag on the
    // page. Committing innerHTML would show the owner their own tags rendered
    // as visible text with no explanation.
    dblclick('[data-edit="headline"]')
    el('[data-edit="headline"]').innerHTML = 'New <b onclick="steal()">copy</b>'
    key('[data-edit="headline"]', "Enter")
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ value: "New copy" }),
    )
  })

  it("commits an edit before starting the next one", () => {
    dblclick('[data-edit="headline"]')
    el('[data-edit="headline"]').textContent = "First"
    dblclick('section#c1 [data-edit="headline"]')
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ sectionId: "h1", value: "First" }))
  })
})

describe("placeholders", () => {
  it("starts empty so the placeholder text cannot become the copy", () => {
    // The single most common "I can't edit this" bug's twin: without this,
    // Enter on an untouched placeholder commits "Add a subheading" as copy.
    dblclick('[data-edit="sub"]')
    expect(el('[data-edit="sub"]').textContent).toBe("")
  })

  it("restores the placeholder on Escape", () => {
    dblclick('[data-edit="sub"]')
    key('[data-edit="sub"]', "Escape")
    expect(el('[data-edit="sub"]').textContent).toBe("Add a subheading")
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("commits nothing when an untouched placeholder is confirmed", () => {
    dblclick('[data-edit="sub"]')
    key('[data-edit="sub"]', "Enter")
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("commits real text typed into a placeholder, flagged as previously empty", () => {
    dblclick('[data-edit="sub"]')
    el('[data-edit="sub"]').textContent = "Full access to the app."
    key('[data-edit="sub"]', "Enter")
    expect(onCommit).toHaveBeenCalledWith({
      sectionId: "h1",
      path: "sub",
      value: "Full access to the app.",
      wasEmpty: true,
    })
  })
})

describe("image slots", () => {
  it("opens the picker on a double-clicked image slot", () => {
    dblclick('[data-edit-image="media"] img')
    expect(onPickImage).toHaveBeenCalledWith({ sectionId: "h1", path: "media" })
  })

  it("lets text win over an enclosing image slot", () => {
    // A headline lying on a hero photo must edit, not swap the photo.
    document.body.innerHTML = `
      <section data-sec="h1">
        <div data-edit-image="media">
          <h1 data-edit="headline">On the photo</h1>
        </div>
      </section>`
    cleanup?.()
    cleanup = bindCanvasEditing(document, { onSelect, onCommit, onPickImage })

    dblclick('[data-edit="headline"]')

    expect(onPickImage).not.toHaveBeenCalled()
    expect(el('[data-edit="headline"]').contentEditable).toBe("true")
  })
})
