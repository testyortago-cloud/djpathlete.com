"use client"

// components/funnels/PreviewPill.tsx — the only chrome the full-screen draft
// preview adds to the page it is previewing.
//
// ---------------------------------------------------------------------------
// WHY IT EXISTS AT ALL, WHEN THE SIBLING PREVIEW DELIBERATELY HAS NONE
// ---------------------------------------------------------------------------
// The builder's iframe preview renders bare, and its own comment says why: "the
// preview is supposed to look exactly like the published page". That is right
// INSIDE the builder, where the surrounding app already says where you are.
//
// Full screen in its own browser tab, the same decision inverts: the page
// becomes indistinguishable from the live site, and an indistinguishable draft
// is one someone sends a client by mistake. So the page keeps its exact layout
// and gains one small, dismissible marker.
//
// A PILL AND NOT A BANNER. A bar across the top pushes the fold and changes the
// very layout being judged — the owner is here to decide whether the page is
// finished, and moving everything down by 60px makes that judgement about the
// wrong page.

import { useEffect, useState } from "react"
import { Eye, X } from "lucide-react"

const DISMISS_KEY = "djp-preview-pill-dismissed"

/**
 * Every storage access is guarded. A private window THROWS on access rather
 * than returning null, and an unguarded read here would take down the one
 * element whose job is to say "this is not live" — failing to the dangerous
 * side.
 */
function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1"
  } catch {
    return false
  }
}

export function PreviewPill({
  funnelName,
  stepName,
  isLive,
  livePath,
}: {
  funnelName: string
  stepName: string
  /** There is a published version of THIS page to compare against. */
  isLive: boolean
  livePath: string
}) {
  // Starts visible and hides after mount if it was dismissed, never the
  // reverse: the opposite order flashes the pill's ABSENCE on the one screen
  // whose entire job is to say "not live", and the server render would disagree
  // with the client's first paint.
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    if (readDismissed()) setHidden(true)
  }, [])

  if (hidden) return null

  return (
    <div
      data-djp-preview-pill
      role="status"
      className="fixed bottom-4 right-4 z-[9999] flex max-w-[min(22rem,calc(100vw-2rem))] items-start gap-3 rounded-xl border border-border bg-white p-3 shadow-lg"
    >
      <Eye className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-heading text-sm text-foreground">Preview — not published</p>
        <p className="font-body mt-0.5 text-xs text-muted-foreground">
          This is “{stepName}” in {funnelName}. Only you can see it. Anything you send from this page is a
          test — it is not saved.
        </p>
        {isLive ? (
          <a
            className="font-body mt-2 inline-block text-xs underline"
            href={livePath}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open the live page
          </a>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Hide this note"
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-surface"
        onClick={() => {
          setHidden(true)
          try {
            window.sessionStorage.setItem(DISMISS_KEY, "1")
          } catch {
            /* a private window: it simply reappears on the next page */
          }
        }}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
