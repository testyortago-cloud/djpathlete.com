"use client"

// components/public/BookACallButton.tsx — the "Book a call" control on a public
// page. Renders NOTHING when no scheduling page is configured, so a site
// without Calendly connected simply shows its form rather than a dead button.
//
// WHY IT IS A CLIENT COMPONENT. The click ids a booking must carry live in two
// places the server cannot see at render time: the `gclid` cookie that
// CaptureGclid sets on first paint, and the query string of the page the
// visitor actually landed on. Reading both here covers the visitor who arrived
// on this page straight from an ad AND the one who browsed around first.
//
// WHY THE HREF IS BUILT ON CLICK rather than at render. This page is cached,
// and a link baked at build time would carry whatever click ids the BUILD saw
// -- which is to say somebody else's, or none. Building at click time is what
// makes the attribution the visitor's own.

import { useCallback } from "react"
import { CalendarCheck } from "lucide-react"

import { consultHref } from "@/lib/calendly/links"

/** One cookie, read the same way the inquiry forms read it. */
function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * The click ids this visitor arrived with. The URL wins over the cookie: if
 * both are present the visitor is on a fresh ad click, and that click is the
 * one that should be credited.
 */
function clickIds(): { gclid?: string; gbraid?: string; wbraid?: string; fbclid?: string } {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)
  const pick = (key: string) => params.get(key) ?? readCookie(key) ?? undefined
  return {
    gclid: pick("gclid"),
    gbraid: pick("gbraid"),
    wbraid: pick("wbraid"),
    fbclid: pick("fbclid"),
  }
}

export function BookACallButton({ schedulingUrl }: { schedulingUrl: string | null }) {
  const open = useCallback(() => {
    const href = consultHref(schedulingUrl, clickIds())
    if (!href) return
    window.open(href, "_blank", "noopener,noreferrer")
  }, [schedulingUrl])

  // No scheduling page configured -> no control. A button that cannot book is
  // worse than no button: it costs the visitor a click to learn nothing.
  if (!schedulingUrl) return null

  return (
    <button
      type="button"
      onClick={open}
      className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-8 py-3 text-sm font-medium text-accent-foreground transition-all hover:bg-accent/90 hover:shadow-lg active:scale-[0.98] sm:w-auto"
    >
      <CalendarCheck className="size-4" />
      Book a call
    </button>
  )
}
