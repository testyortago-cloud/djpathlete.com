"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { ArrowRight, MessageCircle, X } from "lucide-react"

import { AskPanel } from "@/components/public/AskPanel"

const HIDE_ON_PATHS = ["/contact", "/online", "/in-person", "/assessment"]
const HIDE_ON_PATH_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/shop/cart",
  "/shop/checkout",
  "/coming-soon",
  "/unsubscribe",
]
const SHOW_AFTER_SCROLL_PX = 800
const DISMISS_KEY = "djp.stickyCta.dismissed"

interface StickyApplyCTAProps {
  /**
   * `system_settings.chat_assistant_enabled`, read by the marketing layout —
   * the same key and the same default (`CHAT_ASSISTANT_FLAG_DEFAULT`, false)
   * that `/ask`, `POST /api/ask` and `POST /api/ask/capture` all read. It is a
   * prop rather than a fetch because this is a client component; a launcher
   * that renders while the routes answer 404 is a dead button, and one that
   * renders when nobody has switched the feature on is worse.
   */
  askEnabled?: boolean
  /**
   * `business_settings.display_name`, threaded through to the panel so the
   * details card can ask `hasChatConsentDisplayName` — the same gate
   * `/api/ask/capture` asks before it will file a consent row. `''` in
   * production, and `''` is also what a failed settings read degrades to.
   */
  displayName?: string
}

/**
 * Floating "Apply" CTA. Appears on marketing pages after the user has scrolled
 * past the hero, on every route except those that already host an apply form
 * (so we don't duplicate). One-tap dismissable per session via sessionStorage.
 *
 * Stage 3 adds a SECOND action to this bar rather than a bubble of its own:
 * the bar is `fixed bottom-4 right-4` on desktop and spans `left-4 right-4` on
 * mobile, so the bottom-right corner is already taken — a launcher bubble
 * would collide on one and be completely covered on the other (spec §1.3).
 * The scroll threshold, the dismiss and both hide lists are untouched;
 * __tests__/components/public/StickyApplyCTA.test.tsx pins all three and
 * passed against this file before the launcher existed.
 */
export function StickyApplyCTA({ askEnabled = false, displayName = "" }: StickyApplyCTAProps = {}) {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [askOpen, setAskOpen] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1")
  }, [])

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_SCROLL_PX)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  if (dismissed) return null
  if (HIDE_ON_PATHS.includes(pathname)) return null
  if (HIDE_ON_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return null
  // `askOpen` holds the bar mounted while a conversation is open. Without it,
  // scrolling back up mid-question unmounts the panel and the conversation
  // with it — the visitor's own scrolling would throw their question away.
  if (!visible && !askOpen) return null

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1")
    setDismissed(true)
  }

  return (
    <>
      <div
        role="region"
        aria-label="Apply for coaching"
        className={`fixed bottom-4 right-4 left-4 sm:left-auto sm:bottom-6 sm:right-6 z-50 ml-auto sm:ml-0 ${
          askEnabled ? "max-w-xl" : "max-w-md"
        }`}
      >
        <div className="flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-primary-foreground/10 backdrop-blur-sm px-2 py-2 sm:py-2 sm:pl-5 sm:pr-2">
          <span className={`hidden text-sm font-medium pr-2 ${askEnabled ? "lg:inline" : "sm:inline"}`}>
            Limited 1-on-1 capacity.
          </span>
          <Link
            href="/online#apply"
            className="inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-full bg-accent text-primary px-5 py-2.5 text-sm font-semibold hover:bg-accent/90 transition-colors group"
          >
            Apply for coaching
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          {askEnabled ? (
            <button
              type="button"
              onClick={() => setAskOpen((open) => !open)}
              aria-label="Ask a question"
              aria-expanded={askOpen}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full px-3 py-2.5 text-sm font-semibold text-primary-foreground ring-1 ring-primary-foreground/25 hover:bg-primary-foreground/10 transition-colors"
            >
              <MessageCircle className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Ask a question</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleDismiss}
            className="size-9 inline-flex items-center justify-center rounded-full text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10 transition-colors"
            aria-label="Dismiss"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Docked on desktop, a full-screen sheet on mobile — the bar itself
          spans the width of a phone, so there is no room beside it. */}
      {askEnabled && askOpen ? (
        <div className="fixed inset-0 z-[60] sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(70vh,560px)] sm:w-[380px]">
          <AskPanel variant="panel" displayName={displayName} onClose={() => setAskOpen(false)} />
        </div>
      ) : null}
    </>
  )
}
