"use client"

// components/admin/funnels/builder/PreviewPane.tsx — the live draft preview.
//
// A same-origin iframe of `/funnel-preview/[stepId]`, which compiles the DRAFT
// with the same `reassemble -> compileFunnelStep` pair publish runs. So this
// is what publish will actually ship, not a second rendering of it.
//
// ---------------------------------------------------------------------------
// SCALE FOR DESKTOP, NARROW FOR MOBILE — the technique and the reasoning are
// PreviewCard.tsx:40-46's. The iframe is laid out at the DEVICE's width and
// the ELEMENT is scaled, so the page's own breakpoints fire at the width the
// visitor would have. Loading a 390-wide preview narrow is the entire point of
// a mobile preview; loading a desktop preview narrow would be a lie.
//
// The one departure: `scale` is `min(1, paneWidth / deviceWidth)` for EVERY
// device rather than a constant. Scaling a 390px-wide iframe down on a small
// laptop does not change its CSS viewport — it is still 390px and still fires
// the mobile breakpoints — it only stops the frame being clipped by a pane
// narrower than the device. `min(1, ...)` also means desktop is the only
// device that is normally scaled at all (1280 into a ~800px pane ≈ 0.62), and
// nothing is ever scaled UP into a blurry approximation.
//
// ---------------------------------------------------------------------------
// DOUBLE-BUFFERED, AND THE BUFFERS ARE POSITIONAL, NOT KEYED.
// ---------------------------------------------------------------------------
// Every accepted turn rewrites the draft, so the iframe must reload — and a
// naive reload throws the owner back to the top of a page they were reading
// halfway down, on every single turn. So: two iframe slots, A and B. The one
// in front is visible; the new document loads into the one behind, and when it
// fires `load` the outgoing frame's `scrollY` is copied into it and the two
// swap with a 150ms cross-fade.
//
// The slots are rendered from a fixed two-element array with STABLE keys and
// only their `src` changes. Keying a frame by its document (the obvious
// version) makes React unmount the outgoing iframe the instant it stops being
// current — which both kills the cross-fade and remounts the incoming one,
// reloading the document that was just loaded.

import { useCallback, useEffect, useRef, useState } from "react"
import { bindCanvasEditing, type CanvasHandlers } from "./canvas-editing"

export type PreviewDevice = "desktop" | "tablet" | "mobile"

/** Layout width each device previews at. Mobile/tablet are 1:1 where they fit. */
export const PREVIEW_DEVICE_WIDTH: Record<PreviewDevice, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 390,
}

export const PREVIEW_CROSSFADE_MS = 150

/**
 * `allow-same-origin` so the parent can read `contentWindow.scrollY` (the
 * double buffer needs it) and so the preview's own islands hydrate.
 * `allow-scripts` so those islands run.
 *
 * DELIBERATELY NOT `allow-forms` — the draft preview must never submit a lead
 * or start a checkout — and DELIBERATELY NOT `allow-top-navigation`, so a link
 * in the page cannot navigate the admin app out from under the owner.
 */
export const PREVIEW_SANDBOX = "allow-same-origin allow-scripts"

interface PreviewPaneProps {
  stepId: string
  device: PreviewDevice
  /**
   * Bumped when the draft changes. The preview route reads the document from
   * the database, so a new query string is all it takes to re-read it.
   */
  revision: number
  className?: string
  /** Accessible name; distinguishes this frame from the review's mobile one. */
  title?: string
  /**
   * Render with editing anchors and bind the click-to-edit gestures.
   *
   * Part of the SRC, not just a listener: the anchors are stamped server-side
   * by `reassemble`, so turning edit mode on and off reloads the document. That
   * is deliberate — a canvas whose markup disagreed with what publish ships is
   * the failure this whole approach exists to avoid.
   */
  editable?: boolean
  onSelect?: CanvasHandlers["onSelect"]
  onCommit?: CanvasHandlers["onCommit"]
  onPickImage?: CanvasHandlers["onPickImage"]
}

function previewSrc(stepId: string, revision: number, editable: boolean): string {
  return `/funnel-preview/${stepId}?rev=${revision}${editable ? "&edit=1" : ""}`
}

/** Same-origin, but a cross-origin error here must not take the pane down. */
function readScrollY(frame: HTMLIFrameElement | null): number {
  try {
    return frame?.contentWindow?.scrollY ?? 0
  } catch {
    return 0
  }
}

function writeScrollY(frame: HTMLIFrameElement | null, y: number) {
  if (y <= 0) return
  try {
    frame?.contentWindow?.scrollTo(0, y)
  } catch {
    /* the frame is not readable; the owner just lands at the top */
  }
}

export function PreviewPane({
  stepId,
  device,
  revision,
  className,
  title,
  editable = false,
  onSelect,
  onCommit,
  onPickImage,
}: PreviewPaneProps) {
  const wanted = previewSrc(stepId, revision, editable)

  const boxRef = useRef<HTMLDivElement | null>(null)
  const frames = useRef<Array<HTMLIFrameElement | null>>([null, null])
  const [front, setFront] = useState(0)
  const [srcs, setSrcs] = useState<Array<string | null>>(() => [wanted, null])
  const [box, setBox] = useState({ w: 0, h: 0 })

  // Point the BACK slot at the new document. The front slot keeps showing the
  // old one until the new one has actually loaded.
  useEffect(() => {
    setSrcs((prev) => {
      if (prev[front] === wanted || prev[1 - front] === wanted) return prev
      const next = [...prev]
      next[1 - front] = wanted
      return next
    })
  }, [wanted, front])

  // Bumped on every frame load so the binding effect re-runs against the
  // document that is now in front. A `load` is a NEW Document object, so a
  // binding made against the previous one is attached to a detached tree and
  // reports nothing — silently, which is the worst way for an editor to fail.
  const [loadGeneration, setLoadGeneration] = useState(0)

  const handleLoad = useCallback(
    (slot: number) => {
      setLoadGeneration((n) => n + 1)
      // The front slot firing `load` is the first paint, not a swap.
      if (slot === front) return
      if (srcs[slot] !== wanted) return
      writeScrollY(frames.current[slot], readScrollY(frames.current[front]))
      setFront(slot)
    },
    [front, srcs, wanted],
  )

  // Handlers are held in a ref so a parent that re-creates its callbacks on
  // every render does not tear down and re-attach the listeners underneath the
  // owner's pointer.
  const handlers = useRef<CanvasHandlers>({})
  handlers.current = { onSelect, onCommit, onPickImage }

  // ---------------------------------------------------------------------------
  // BINDING THE CANVAS. THE `load` LISTENER IS ON THE IFRAME, NOT REACT'S onLoad.
  // ---------------------------------------------------------------------------
  // An iframe starts life holding `about:blank` and gets a BRAND NEW Document
  // when its src finishes loading, so a binding made on mount is attached to a
  // document that is about to be thrown away.
  //
  // The first version leaned on React's `onLoad` to re-run this effect, and it
  // did not work — verified in a real browser, where the canvas was completely
  // inert: every anchor was present in the DOM and not one click did anything.
  // Against a local dev server the frame can finish loading BEFORE hydration
  // attaches React's handler, so the event is missed outright and the effect
  // never re-runs. Nothing throws. There is no console error. The feature is
  // simply dead, which is why no test caught it: jsdom never loads the frame,
  // so every unit test exercised `bindCanvasEditing` directly and passed.
  //
  // So this attaches its OWN listener to the element, and binds immediately as
  // well — covering both orders, whichever way the race falls:
  //
  //   already loaded  -> `attach()` binds now
  //   loads later     -> the element's own `load` fires and rebinds
  //   reloads (a turn) -> same listener rebinds again
  useEffect(() => {
    if (!editable) return
    const frame = frames.current[front]
    if (!frame) return

    let unbind: (() => void) | null = null

    const attach = () => {
      unbind?.()
      unbind = null
      // Same-origin, but an unreadable frame must not throw: the `load`
      // listener below will simply try again.
      let doc: Document | null = null
      try {
        doc = frame.contentDocument
      } catch {
        return
      }
      if (!doc) return
      unbind = bindCanvasEditing(doc, {
        onSelect: (selection) => handlers.current.onSelect?.(selection),
        onCommit: (commit) => handlers.current.onCommit?.(commit),
        onPickImage: (target) => handlers.current.onPickImage?.(target),
      })
    }

    attach()
    frame.addEventListener("load", attach)
    return () => {
      frame.removeEventListener("load", attach)
      unbind?.()
    }
  }, [editable, front, loadGeneration])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    // jsdom has no ResizeObserver, and neither do a few older browsers. A
    // resize listener is a strictly worse but always-available fallback.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure)
      return () => window.removeEventListener("resize", measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const deviceWidth = PREVIEW_DEVICE_WIDTH[device]
  const scale = box.w > 0 ? Math.min(1, box.w / deviceWidth) : 1

  return (
    <div ref={boxRef} className={className}>
      <div
        className="relative mx-auto overflow-hidden"
        style={{ width: deviceWidth * scale, height: box.h > 0 ? box.h : "100%" }}
      >
        {srcs.map((src, slot) =>
          src === null ? null : (
            <iframe
              key={slot === 0 ? "preview-slot-a" : "preview-slot-b"}
              ref={(node) => {
                frames.current[slot] = node
              }}
              src={src}
              title={slot === front ? (title ?? "Page preview") : "Loading the updated page"}
              sandbox={PREVIEW_SANDBOX}
              onLoad={() => handleLoad(slot)}
              aria-hidden={slot === front ? undefined : true}
              tabIndex={slot === front ? undefined : -1}
              className="absolute left-0 top-0 origin-top-left border-0 bg-white transition-opacity"
              style={{
                width: deviceWidth,
                height: box.h > 0 ? box.h / scale : "100%",
                transform: `scale(${scale})`,
                opacity: slot === front ? 1 : 0,
                pointerEvents: slot === front ? "auto" : "none",
                transitionDuration: `${PREVIEW_CROSSFADE_MS}ms`,
              }}
            />
          ),
        )}
      </div>
    </div>
  )
}
