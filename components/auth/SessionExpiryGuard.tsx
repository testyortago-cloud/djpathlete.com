"use client"

import { useEffect, useRef } from "react"
import { useSession, getSession } from "next-auth/react"
import { hardNavigate } from "@/lib/hard-navigate"

/** How often to compare the known session expiry against the local clock. */
const RECHECK_INTERVAL_MS = 60_000
/**
 * Grace before redirecting on an unauthenticated status. A deliberate
 * signOut({ callbackUrl }) flips the status right as its own navigation
 * starts — the pause lets that navigation win so an intentional logout
 * doesn't get rerouted to the expired-session login screen.
 */
const REDIRECT_GRACE_MS = 400

export function loginRedirectUrl(pathname: string, search: string): string {
  return `/login?expired=1&callbackUrl=${encodeURIComponent(pathname + search)}`
}

/**
 * Watches the NextAuth session from inside the protected shells (admin,
 * client, editor) and sends the browser to /login the moment the session is
 * gone — instead of letting a stale tab keep firing 401'ing fetches until it
 * crashes into the route error boundary.
 *
 * Two triggers:
 * - SessionProvider refetches the session when a backgrounded tab regains
 *   focus. If the cookie expired while the tab was parked, the status flips
 *   to "unauthenticated" and we redirect before the user clicks anything.
 * - A visible-tab interval covers tabs that sit open past the 24h JWT
 *   lifetime without ever losing focus: once the last-known expiry passes we
 *   confirm with the server (activity elsewhere may have rolled the cookie)
 *   and only redirect when the session is really dead.
 */
export function SessionExpiryGuard() {
  const { data: session, status } = useSession()
  const redirectingRef = useRef(false)
  const expiresAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (!session?.expires) return
    const expiresAt = new Date(session.expires).getTime()
    if (!Number.isNaN(expiresAt)) expiresAtRef.current = expiresAt
  }, [session?.expires])

  useEffect(() => {
    if (status === "authenticated") {
      redirectingRef.current = false
      return
    }
    if (status !== "unauthenticated" || redirectingRef.current) return
    redirectingRef.current = true
    const timer = setTimeout(() => {
      // Hard navigation (not router.push) so middleware runs, the stale
      // session cookie gets cleared, and all client state resets.
      hardNavigate(loginRedirectUrl(window.location.pathname, window.location.search))
    }, REDIRECT_GRACE_MS)
    return () => clearTimeout(timer)
  }, [status])

  useEffect(() => {
    const check = async () => {
      if (redirectingRef.current) return
      if (document.visibilityState !== "visible") return
      const expiresAt = expiresAtRef.current
      if (!expiresAt || Date.now() < expiresAt) return

      const fresh = await getSession()
      if (fresh?.expires) {
        const refreshed = new Date(fresh.expires).getTime()
        if (!Number.isNaN(refreshed)) expiresAtRef.current = refreshed
        return
      }
      if (redirectingRef.current) return
      redirectingRef.current = true
      hardNavigate(loginRedirectUrl(window.location.pathname, window.location.search))
    }
    const interval = setInterval(() => void check(), RECHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  return null
}
