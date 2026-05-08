"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { ArrowRight, X } from "lucide-react"

const HIDE_ON_PATHS = ["/contact", "/online", "/in-person", "/assessment"]
const HIDE_ON_PATH_PREFIXES = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/shop/cart", "/shop/checkout", "/coming-soon", "/unsubscribe"]
const SHOW_AFTER_SCROLL_PX = 800
const DISMISS_KEY = "djp.stickyCta.dismissed"

/**
 * Floating "Apply" CTA. Appears on marketing pages after the user has scrolled
 * past the hero, on every route except those that already host an apply form
 * (so we don't duplicate). One-tap dismissable per session via sessionStorage.
 */
export function StickyApplyCTA() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)

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
  if (!visible) return null

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1")
    setDismissed(true)
  }

  return (
    <div
      role="region"
      aria-label="Apply for coaching"
      className="fixed bottom-4 right-4 left-4 sm:left-auto sm:bottom-6 sm:right-6 z-50 max-w-md ml-auto sm:ml-0"
    >
      <div className="flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-primary-foreground/10 backdrop-blur-sm px-2 py-2 sm:py-2 sm:pl-5 sm:pr-2">
        <span className="hidden sm:inline text-sm font-medium pr-2">
          Limited 1-on-1 capacity.
        </span>
        <Link
          href="/online#apply"
          className="inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-full bg-accent text-primary px-5 py-2.5 text-sm font-semibold hover:bg-accent/90 transition-colors group"
        >
          Apply for coaching
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
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
  )
}
