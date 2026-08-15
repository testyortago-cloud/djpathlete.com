// components/admin/funnels/builder/canvas-editing.ts - the click-to-edit canvas.
//
// ---------------------------------------------------------------------------
// THE GOVERNING RULE: THE CANVAS REPORTS INTENT AND NEVER MUTATES CONTENT.
// ---------------------------------------------------------------------------
// A click says "the owner selected `h1.headline`". A commit says "the text is
// now this". Neither knows what a SectionDoc is, whether the field is optional,
// or what op will be sent. The parent owns the document and decides what an
// intent means, so there is exactly one copy of the truth and nothing here can
// diverge from it.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A PLAIN FUNCTION OVER A `Document`, AND NOT AN INJECTED RUNTIME
// ---------------------------------------------------------------------------
// The design this is ported from spends ~700 lines of untyped vanilla JS on a
// script injected into a `srcdoc` iframe, plus a `postMessage` protocol, and
// calls it "the honest cost": no type checking, no syntax highlighting, and no
// backticks anywhere inside the template literal.
//
// We pay none of it, because our canvas is not a `srcdoc` blob: it is a real
// same-origin Next.js route (`/funnel-preview/[stepId]`) in an iframe with
// `allow-same-origin`. The parent already reaches into `contentWindow` (the
// double buffer reads `scrollY` from it), so ordinary typed code in this file
// can bind listeners onto `iframe.contentDocument` directly. No runtime, no
// protocol, no template literal, and jsdom can test all of it against a plain
// Document with no iframe at all.
//
// The stylesheet that pairs with the classes below lives in
// `lib/funnels/sections/edit-css.ts`, so the preview route (a server component)
// can import it without pulling this DOM code into a server bundle.

/** What the canvas saw. Never a document change - see the header. */
export interface CanvasSelection {
  sectionId: string
  /** The prop path under that section, or null when the section itself was hit. */
  path: string | null
}

export interface CanvasCommit {
  sectionId: string
  path: string
  /** Trimmed plain text. Never markup - see `commitText`. */
  value: string
  /** True when the field was showing a placeholder, so "" means "still unset". */
  wasEmpty: boolean
}

export interface CanvasHandlers {
  onSelect?: (selection: CanvasSelection) => void
  onCommit?: (commit: CanvasCommit) => void
  /** An image slot was double-clicked. The parent opens the picker. */
  onPickImage?: (target: { sectionId: string; path: string }) => void
}

const SELECTED_CLASS = "djp-selected"
const EDITING_CLASS = "djp-editing"

// ---------------------------------------------------------------------------
// NEVER `instanceof` A NODE THAT CAME OUT OF THE IFRAME.
// ---------------------------------------------------------------------------
// The canvas is a SEPARATE REALM. Its `Element`, `HTMLElement` and `Node` are
// different constructor objects from this window's, so `target instanceof
// Element` is FALSE for every node in the page being edited — even though it is
// obviously an element.
//
// That is exactly how this shipped broken: the first line of the click handler
// bailed on every click, so the whole canvas was inert in production while all
// 900+ tests passed. jsdom binds the listener and dispatches the event inside
// ONE realm, so `instanceof` holds there and the bug is invisible to every unit
// test that could have been written against it. It took driving a real browser
// to see it.
//
// Duck-typing is not a shortcut here, it is the correct cross-realm check: what
// matters is that the thing can answer `closest`, not which window minted it.

interface ElementLike {
  closest(selector: string): ElementLike | null
  getAttribute(name: string): string | null
  classList: DOMTokenList
  contains(other: unknown): boolean
}

/**
 * Exported ONLY so the realm bug can be regression-tested. jsdom cannot give a
 * test a genuinely foreign-realm node, but it can give it the thing that
 * matters: a value that answers `closest` and is not `instanceof Element`.
 */
export function asElement(value: unknown): ElementLike | null {
  if (value === null || typeof value !== "object") return null
  const candidate = value as Partial<ElementLike>
  return typeof candidate.closest === "function" && typeof candidate.getAttribute === "function"
    ? (candidate as ElementLike)
    : null
}

function closestWithin(start: EventTarget | null, selector: string): HTMLElement | null {
  const element = asElement(start)
  if (!element) return null
  return (element.closest(selector) as HTMLElement | null) ?? null
}

function sectionIdOf(element: HTMLElement | null): string | null {
  const section = asElement(element)?.closest("[data-sec]")
  return section ? section.getAttribute("data-sec") : null
}

/**
 * Attaches the editing gestures to `doc` and returns a cleanup.
 *
 * NOT idempotent per Document: calling it twice attaches twice, so the caller
 * must run the returned cleanup before re-binding. `useCanvasEditing` does, and
 * `canvas-editing.test.ts` pins that an unbound canvas reports nothing - the
 * preview rebinds on every reload, so a leaked listener means one click
 * reported N times.
 */
export function bindCanvasEditing(doc: Document, handlers: CanvasHandlers): () => void {
  /** The element currently in `contentEditable`, and what it said before. */
  let editing: { element: HTMLElement; original: string; wasEmpty: boolean } | null = null

  function stopEditing(element: HTMLElement) {
    element.contentEditable = "false"
    element.classList.remove(EDITING_CLASS)
    editing = null
  }

  /**
   * Commits `textContent`, NEVER `innerHTML`.
   *
   * A `contenteditable` will happily accept a paste full of markup, and a
   * `SectionDoc` stores plain strings - the renderer owns every tag on the
   * page. Taking innerHTML here would put author-controlled markup into a prop
   * that is later escaped, so the owner would see their own tags rendered as
   * visible text and never understand why.
   */
  function commitText() {
    if (!editing) return
    const { element, original, wasEmpty } = editing
    const value = (element.textContent ?? "").trim()
    stopEditing(element)

    if (value === original.trim()) return
    // A placeholder left untouched is not an edit. Without this, pressing
    // Enter on "Add a subheading" would commit those literal words as copy.
    if (wasEmpty && value === "") return

    const path = element.dataset.edit
    const sectionId = sectionIdOf(element)
    if (!path || !sectionId) return

    handlers.onCommit?.({ sectionId, path, value, wasEmpty })
  }

  function cancelEditing() {
    if (!editing) return
    const { element, original } = editing
    element.textContent = original
    stopEditing(element)
  }

  function selectContents(element: HTMLElement) {
    const selection = doc.defaultView?.getSelection?.()
    if (!selection) return
    const range = doc.createRange()
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  function startEditing(element: HTMLElement) {
    if (editing?.element === element) return
    if (editing) commitText()

    const wasEmpty = element.dataset.editEmpty !== undefined
    const original = element.textContent ?? ""
    editing = { element, original, wasEmpty }

    // A PLACEHOLDER STARTS EMPTY. Selecting its contents and letting the owner
    // type over them looks the same until they press Enter without typing, at
    // which point "Add a subheading" becomes their copy. `original` is kept so
    // Escape can put it back.
    if (wasEmpty) element.textContent = ""

    element.contentEditable = "true"
    element.classList.add(EDITING_CLASS)
    element.focus()

    if (!wasEmpty) selectContents(element)
  }

  const onClick = (event: MouseEvent) => {
    // A link inside the page must not navigate the editor away from itself.
    // `preventDefault` rather than stripping the href: the href is part of what
    // the owner is editing, and it must stay visible and inspectable.
    const link = closestWithin(event.target, "a[href]")
    if (link) event.preventDefault()

    // `contains` rather than an `instanceof Node` guard, for the realm reason
    // above: a node from the canvas is not `instanceof` this window's `Node`.
    if (editing && event.target !== null && editing.element.contains(event.target as Node)) return
    if (editing) commitText()

    const field = closestWithin(event.target, "[data-edit]")
    const sectionId = sectionIdOf(field ?? closestWithin(event.target, "[data-sec]"))
    if (!sectionId) return

    for (const marked of Array.from(doc.querySelectorAll(`.${SELECTED_CLASS}`))) {
      marked.classList.remove(SELECTED_CLASS)
    }
    const section = (field ?? (event.target as HTMLElement)).closest("[data-sec]")
    section?.classList.add(SELECTED_CLASS)

    handlers.onSelect?.({ sectionId, path: field?.dataset.edit ?? null })
  }

  const onDoubleClick = (event: MouseEvent) => {
    // TEXT WINS OVER AN ENCLOSING IMAGE SLOT, and the order is the whole point.
    // The design this is ported from shipped image-first and made a full-bleed
    // hero unselectable: the hero is one image slot, so every pixel of the
    // first screen opened the picker instead of editing the headline lying on
    // top of it.
    const field = closestWithin(event.target, "[data-edit]")
    if (field) {
      event.preventDefault()
      startEditing(field)
      return
    }

    const slot = closestWithin(event.target, "[data-edit-image]")
    const path = slot?.dataset.editImage
    const sectionId = sectionIdOf(slot)
    if (slot && path && sectionId) {
      event.preventDefault()
      handlers.onPickImage?.({ sectionId, path })
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!editing) return
    if (event.key === "Escape") {
      event.preventDefault()
      cancelEditing()
      return
    }
    // Enter commits. Shift+Enter is left alone so a multi-line field can still
    // take a line break; the value is trimmed text either way.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      commitText()
    }
  }

  const onBlur = () => {
    if (editing) commitText()
  }

  doc.addEventListener("click", onClick, true)
  doc.addEventListener("dblclick", onDoubleClick, true)
  doc.addEventListener("keydown", onKeyDown, true)
  // Capture, because `blur` does not bubble.
  doc.addEventListener("blur", onBlur, true)

  return () => {
    doc.removeEventListener("click", onClick, true)
    doc.removeEventListener("dblclick", onDoubleClick, true)
    doc.removeEventListener("keydown", onKeyDown, true)
    doc.removeEventListener("blur", onBlur, true)
    if (editing) stopEditing(editing.element)
  }
}
