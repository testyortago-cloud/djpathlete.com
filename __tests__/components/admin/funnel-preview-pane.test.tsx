// __tests__/components/admin/funnel-preview-pane.test.tsx — Stage 1.9's preview.
//
// EVERY TEST HERE NAMES THE MUTANT IT KILLS. This repo's dominant defect class
// is tests that cannot fail, and this file exists because review found the
// opposite failure: `PreviewPane` shipped with NO test at all, so a mutant
// adding `allow-forms` to the sandbox passed the whole suite.
//
// Three properties are covered, in the order of how badly they fail:
//
//  1. THE SANDBOX ALLOWLIST. `allow-same-origin allow-scripts` on a same-origin
//     frame is already the widest thing this preview may be given; the two
//     tokens the file's own doc comment forbids (`allow-forms`, so a draft
//     cannot submit a lead or start a checkout, and `allow-top-navigation`, so
//     a link cannot navigate the admin app out from under the owner) are
//     asserted absent BY NAME. Widening this string is a one-word diff that
//     nobody notices.
//  2. THE DOUBLE BUFFER. The new document loads into a second, hidden frame and
//     the swap happens on `load`, carrying the outgoing frame's scroll with it.
//     Without it every turn throws the owner back to the top of a page they
//     were reading halfway down.
//  3. THE DEVICE WIDTH. The frame is NARROWED to the device width and the
//     ELEMENT is scaled. A mobile preview rendered at the pane's width fires
//     the desktop breakpoints, which defeats the entire point of it.
//
// WHAT JSDOM CANNOT DO: it does not load iframe documents. Nothing here proves
// the preview route renders, that `frame-src 'self'` permits the sandboxed
// frame, that the 150ms cross-fade looks like a cross-fade, or that a REAL
// `contentWindow.scrollY` survives the swap — the scroll test drives a stubbed
// `contentWindow`, which pins the wiring (read the outgoing frame, write the
// incoming one, in that order) and not the browser. Those need a real engine.
//
// Technique follows the repo's existing jsdom-iframe precedent,
// __tests__/components/report/report-preview.test.tsx:10-42: assert the
// element's attributes and the component's own state transitions.
//
// `fireEvent`, not `@testing-library/user-event` (not a dependency of this
// repo), same deviation as funnel-builder.test.tsx:16-19. No fake timers:
// `shouldAdvanceTime` starves `waitFor`, and nothing here needs a clock.

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, fireEvent } from "@testing-library/react"
import {
  PreviewPane,
  PREVIEW_CROSSFADE_MS,
  PREVIEW_DEVICE_WIDTH,
  PREVIEW_SANDBOX,
  type PreviewDevice,
} from "@/components/admin/funnels/builder/PreviewPane"

const STEP = "step-1"

/**
 * jsdom reports every element as 0x0, so the pane measures 0 and `scale` falls
 * back to 1 — which would make every scale assertion below vacuously true.
 * Stubbing `clientWidth`/`clientHeight` on the prototype is what gives the
 * component a pane to fit the device into.
 */
function stubPaneSize(width: number, height = 600) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => height,
  })
}

afterEach(() => {
  // Deleting the own definition restores jsdom's inherited Element.prototype one.
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth")
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight")
})

function frames(container: HTMLElement): HTMLIFrameElement[] {
  return Array.from(container.querySelectorAll("iframe"))
}

function onlyFrame(container: HTMLElement): HTMLIFrameElement {
  const list = frames(container)
  expect(list).toHaveLength(1)
  return list[0]
}

// ---------------------------------------------------------------------------
// 1. The sandbox allowlist
// ---------------------------------------------------------------------------

describe("<PreviewPane> — the sandbox allowlist", () => {
  it("sandboxes the draft to exactly `allow-same-origin allow-scripts`", () => {
    // MUTANT KILLED: adding `allow-forms` (a draft preview that can submit a
    // real lead or start a real checkout) or `allow-top-navigation` (a link in
    // an AI-written page navigating the admin app away). Before this test the
    // whole suite was green with either one added.
    const { container } = render(<PreviewPane stepId={STEP} device="desktop" revision={5} />)
    const frame = onlyFrame(container)

    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-scripts")

    const tokens = (frame.getAttribute("sandbox") ?? "").split(/\s+/)
    expect(tokens).not.toContain("allow-forms")
    expect(tokens).not.toContain("allow-top-navigation")
    expect(tokens).not.toContain("allow-top-navigation-by-user-activation")
    expect(tokens).not.toContain("allow-popups")
    expect(tokens).not.toContain("allow-modals")
    expect(tokens).not.toContain("allow-downloads")

    // The exported constant and the rendered attribute must be the same string:
    // a mutant that keeps the constant honest and hardcodes a wider attribute on
    // the element would otherwise pass a constant-only assertion.
    expect(PREVIEW_SANDBOX).toBe("allow-same-origin allow-scripts")
  })

  it("sandboxes the frame loading BEHIND the visible one identically", () => {
    // MUTANT KILLED: `sandbox={slot === front ? PREVIEW_SANDBOX : undefined}`.
    // The back slot is where the newest, least-reviewed markup lands, and an
    // un-sandboxed iframe with no `sandbox` attribute at all has every
    // capability. The hole would be open for exactly as long as a load takes.
    const { container, rerender } = render(
      <PreviewPane stepId={STEP} device="desktop" revision={5} />,
    )
    rerender(<PreviewPane stepId={STEP} device="desktop" revision={6} />)

    const list = frames(container)
    expect(list).toHaveLength(2)
    for (const frame of list) {
      expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-scripts")
    }
  })
})

// ---------------------------------------------------------------------------
// 2. The double buffer
// ---------------------------------------------------------------------------

describe("<PreviewPane> — the double buffer", () => {
  it("loads a new revision into a SECOND frame while the first one stays visible", () => {
    // MUTANT KILLED: one iframe whose `src` is reassigned (`<iframe src={wanted}>`).
    // There would only ever be one frame, it would point at rev=6 the instant
    // the turn landed, and the owner reading halfway down the page would be
    // thrown to the top — the failure the brief called make-or-break.
    const { container, rerender } = render(
      <PreviewPane stepId={STEP} device="desktop" revision={5} title="Draft preview" />,
    )

    expect(onlyFrame(container).getAttribute("src")).toBe(`/funnel-preview/${STEP}?rev=5`)
    expect(onlyFrame(container).getAttribute("title")).toBe("Draft preview")

    rerender(<PreviewPane stepId={STEP} device="desktop" revision={6} title="Draft preview" />)

    const [front, back] = frames(container)
    expect(front.getAttribute("src")).toBe(`/funnel-preview/${STEP}?rev=5`)
    expect(front.style.opacity).toBe("1")
    expect(back.getAttribute("src")).toBe(`/funnel-preview/${STEP}?rev=6`)
    expect(back.style.opacity).toBe("0")
    // The loading frame is out of the a11y tree and out of the tab order, so it
    // is not a second copy of the page for a screen reader or keyboard.
    expect(back).toHaveAttribute("aria-hidden", "true")
    expect(back.tabIndex).toBe(-1)
  })

  it("swaps only once the new document has loaded, and carries the scroll across", () => {
    // MUTANT KILLED (two of them): swapping on the `src` change instead of on
    // `load` (the owner watches a blank frame while it loads), and calling
    // `setFront` without the `writeScrollY(readScrollY(...))` pair — the swap
    // itself would then be smooth and STILL land the owner at the top, which is
    // the whole defect the double buffer was built to prevent.
    const { container, rerender } = render(
      <PreviewPane stepId={STEP} device="desktop" revision={5} />,
    )
    rerender(<PreviewPane stepId={STEP} device="desktop" revision={6} />)

    const [outgoing, incoming] = frames(container)
    const scrollTo = vi.fn()
    // jsdom never loads the frames, so their windows are stubbed. This pins the
    // WIRING — read the outgoing frame, write the incoming one — not the browser.
    Object.defineProperty(outgoing, "contentWindow", { configurable: true, value: { scrollY: 420 } })
    Object.defineProperty(incoming, "contentWindow", { configurable: true, value: { scrollTo } })

    // Nothing has loaded yet: the old document is still the visible one.
    expect(outgoing.style.opacity).toBe("1")
    expect(incoming.style.opacity).toBe("0")
    expect(scrollTo).not.toHaveBeenCalled()

    fireEvent.load(incoming)

    expect(scrollTo).toHaveBeenCalledWith(0, 420)
    const [slotA, slotB] = frames(container)
    // Same two elements: the slots are positional. If the swap remounted them,
    // the document that just finished loading would immediately reload.
    expect(slotA).toBe(outgoing)
    expect(slotB).toBe(incoming)
    expect(slotB.style.opacity).toBe("1")
    expect(slotA.style.opacity).toBe("0")
    // MUTANT KILLED: dropping the cross-fade, which turns the swap into a flash.
    expect(slotB.style.transitionDuration).toBe(`${PREVIEW_CROSSFADE_MS}ms`)
  })

  it("re-points the SAME back slot when turns land faster than the frames load", () => {
    // MUTANT KILLED: pushing a new slot per revision (`setSrcs(prev => [...prev,
    // wanted])`). Three quick turns would leave three iframes fetching and
    // hydrating at once, over a preview route that re-compiles the document on
    // every request. There are exactly two slots, forever.
    const { container, rerender } = render(
      <PreviewPane stepId={STEP} device="desktop" revision={5} />,
    )
    for (const revision of [6, 7, 8]) {
      rerender(<PreviewPane stepId={STEP} device="desktop" revision={revision} />)
    }

    const list = frames(container)
    expect(list).toHaveLength(2)
    expect(list[0].getAttribute("src")).toBe(`/funnel-preview/${STEP}?rev=5`)
    expect(list[0].style.opacity).toBe("1")
    expect(list[1].getAttribute("src")).toBe(`/funnel-preview/${STEP}?rev=8`)
  })

  it("loads the next revision into whichever slot is NOT in front", () => {
    // MUTANT KILLED: `next[1] = wanted` — writing slot B unconditionally
    // instead of `next[1 - front]`. It works exactly once. After the first swap
    // slot B is the VISIBLE frame, so the second turn re-points the document the
    // owner is reading and blanks it mid-load: the naive reload, restored.
    const { container, rerender } = render(
      <PreviewPane stepId={STEP} device="desktop" revision={5} />,
    )
    rerender(<PreviewPane stepId={STEP} device="desktop" revision={6} />)
    fireEvent.load(frames(container)[1])
    expect(frames(container)[1].style.opacity).toBe("1")

    rerender(<PreviewPane stepId={STEP} device="desktop" revision={7} />)

    const [slotA, slotB] = frames(container)
    expect(slotB.getAttribute("src")).toBe(`/funnel-preview/${STEP}?rev=6`)
    expect(slotB.style.opacity).toBe("1")
    expect(slotA.getAttribute("src")).toBe(`/funnel-preview/${STEP}?rev=7`)
    expect(slotA.style.opacity).toBe("0")
  })
})

// ---------------------------------------------------------------------------
// 3. The device width
// ---------------------------------------------------------------------------

describe("<PreviewPane> — device width", () => {
  const CASES: Array<[PreviewDevice, number, string]> = [
    // 800px pane: only desktop does not fit, so only desktop is scaled.
    ["desktop", 1280, "scale(0.625)"],
    ["tablet", 768, "scale(1)"],
    ["mobile", 390, "scale(1)"],
  ]

  it.each(CASES)(
    "lays the %s preview out at %ipx of CSS width and scales the element to fit",
    (device, width, transform) => {
      // MUTANT KILLED: `width: box.w` — a frame laid out at the PANE's width.
      // The document's own media queries fire at whatever width the frame has,
      // so a "mobile" preview 800px wide renders the desktop layout, which is
      // the entire thing a mobile preview exists to show.
      stubPaneSize(800)
      const { container } = render(<PreviewPane stepId={STEP} device={device} revision={5} />)
      const frame = onlyFrame(container)

      expect(frame.style.width).toBe(`${width}px`)
      expect(frame.style.transform).toBe(transform)
      expect(PREVIEW_DEVICE_WIDTH[device]).toBe(width)
    },
  )

  it("never widens or scales the phone preview UP in a pane bigger than a phone", () => {
    // MUTANT KILLED: `scale = box.w / deviceWidth` without the `min(1, …)`.
    // In the real ~1136px pane that is scale 2.9 — a blurry upscale of a page
    // whose breakpoints the owner is trying to check.
    stubPaneSize(1136)
    const { container } = render(<PreviewPane stepId={STEP} device="mobile" revision={5} />)
    const frame = onlyFrame(container)

    expect(frame.style.width).toBe("390px")
    expect(frame.style.transform).toBe("scale(1)")
  })
})
