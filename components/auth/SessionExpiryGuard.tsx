"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { useSession, getSession } from "next-auth/react"
import { hardNavigate } from "@/lib/hard-navigate"
import { SESSION_IDLE_MAX_AGE_MS, SESSION_WARN_BEFORE_MS, shouldWarn } from "@/lib/session-policy"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/**
 * How often to compare the known session expiry against the local clock.
 * Shorter than the warning window, or the dialog would appear with less time
 * left than it promises. This tick NEVER touches the network — see the warning
 * below about why that matters.
 */
const RECHECK_INTERVAL_MS = 15_000
/**
 * Grace before redirecting on an unauthenticated status. A deliberate
 * signOut({ callbackUrl }) flips the status right as its own navigation
 * starts — the pause lets that navigation win so an intentional logout
 * doesn't get rerouted to the expired-session login screen.
 */
const REDIRECT_GRACE_MS = 400
/**
 * How long to wait before asking again once a confirm came back alive.
 *
 * Escalating, because "alive" means two very different things. Usually the
 * first confirm simply lands a second or two before the cookie actually dies —
 * measured: the confirm fired with 2s left and the cookie was gone 2s later —
 * and a flat one-minute backoff would leave a dead tab looking signed in for
 * most of a minute. Occasionally it means the session really was rolled in
 * another tab and has hours left, and re-asking every 15 seconds for hours is
 * waste. Start tight, then relax.
 */
const CONFIRM_BACKOFF_MS = [15_000, 30_000, 60_000]

/** Liveness WITHOUT renewing the session — see app/api/session/alive/route.ts. */
async function isSessionAlive(): Promise<boolean> {
  try {
    const res = await fetch("/api/session/alive", { cache: "no-store" })
    if (!res.ok) return true // a failed request is not proof of a dead session
    return Boolean((await res.json()).alive)
  } catch {
    return true
  }
}

export function loginRedirectUrl(pathname: string, search: string): string {
  return `/login?expired=1&callbackUrl=${encodeURIComponent(pathname + search)}`
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

/**
 * Watches the NextAuth session from inside the protected shells (admin,
 * client, editor) and sends the browser to /login the moment the session is
 * gone — instead of letting a stale tab keep firing 401'ing fetches until it
 * crashes into the route error boundary. Warns first, so a timeout cannot take
 * a half-finished form with it.
 *
 * Three triggers:
 * - SessionProvider refetches the session when a backgrounded tab regains
 *   focus. If the cookie expired while the tab was parked, the status flips
 *   to "unauthenticated" and we redirect before the user clicks anything.
 * - A visible-tab interval covers tabs that sit open past the idle window
 *   without ever losing focus: once the last-known expiry passes we confirm
 *   with the server (activity elsewhere may have rolled the cookie) and only
 *   redirect when the session is really dead.
 * - The same interval raises the sign-out warning two minutes out.
 *
 * NEVER use getSession() to *check* how long is left. Reading the session
 * re-signs the JWT and re-sets the cookie, which slides the idle window — a
 * poll that asks the server "am I nearly out?" renews the very thing it is
 * measuring. This is not theoretical: with a 60-second window, the poll landed
 * one second before expiry and pushed the cookie back out to 55 seconds, every
 * cycle, and the tab was still signed in after 90 seconds of doing nothing.
 * Liveness goes through /api/session/alive, which deliberately does not renew.
 * getSession() is called in exactly one place — when the user clicks "Stay
 * signed in", where sliding the window is the entire point.
 */
export function SessionExpiryGuard() {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const redirectingRef = useRef(false)
  const expiresAtRef = useRef<number | null>(null)
  const lastPathRef = useRef<string | null>(null)
  const nextConfirmAtRef = useRef(0)
  const confirmsRef = useRef(0)
  const [warning, setWarning] = useState(false)
  const [remainingMs, setRemainingMs] = useState(SESSION_WARN_BEFORE_MS)
  const [extending, setExtending] = useState(false)

  const redirectToLogin = useCallback(() => {
    if (redirectingRef.current) return
    redirectingRef.current = true
    // Hard navigation (not router.push) so middleware runs, the stale
    // session cookie gets cleared, and all client state resets.
    hardNavigate(loginRedirectUrl(window.location.pathname, window.location.search))
  }, [])

  useEffect(() => {
    if (!session?.expires) return
    const expiresAt = new Date(session.expires).getTime()
    if (!Number.isNaN(expiresAt)) expiresAtRef.current = expiresAt
  }, [session?.expires])

  // Mirror the server's slide on CLIENT-SIDE navigation. Every page request
  // goes through proxy.ts, which is the auth() wrapper, and that re-sets the
  // session cookie with a fresh idle window — but a soft navigation does not
  // make useSession refetch, so without this the client's copy of the expiry
  // lags behind the cookie's real one and the warning fires at a user who is
  // demonstrably still working.
  //
  // Deliberately skipped on mount: a fresh page load fetches the session, so
  // the server's own `expires` is both available and authoritative there.
  // Overwriting it with an assumption would throw away the better number.
  useEffect(() => {
    if (status !== "authenticated") return
    if (lastPathRef.current === null || lastPathRef.current === pathname) {
      lastPathRef.current = pathname
      return
    }
    lastPathRef.current = pathname
    expiresAtRef.current = Date.now() + SESSION_IDLE_MAX_AGE_MS
    nextConfirmAtRef.current = 0
    confirmsRef.current = 0
    setWarning(false)
  }, [pathname, status])

  useEffect(() => {
    if (status === "authenticated") {
      redirectingRef.current = false
      return
    }
    if (status !== "unauthenticated" || redirectingRef.current) return
    redirectingRef.current = true
    const timer = setTimeout(() => {
      hardNavigate(loginRedirectUrl(window.location.pathname, window.location.search))
    }, REDIRECT_GRACE_MS)
    return () => clearTimeout(timer)
  }, [status])

  useEffect(() => {
    const check = async () => {
      if (redirectingRef.current) return
      if (document.visibilityState !== "visible") return
      const expiresAt = expiresAtRef.current
      if (!expiresAt) return
      const now = Date.now()

      if (now < expiresAt) {
        const warn = shouldWarn(expiresAt, now)
        setWarning(warn)
        if (warn) setRemainingMs(expiresAt - now)
        return
      }

      // Past our local estimate. Confirm with a read that cannot renew the
      // session — activity in ANOTHER tab may legitimately have rolled the
      // cookie, and signing this tab out for that would be wrong.
      if (now < nextConfirmAtRef.current) return
      setWarning(false)
      const alive = await isSessionAlive()
      if (alive) {
        // Do NOT re-arm the local estimate from this: the real expiry is
        // unknown, and assuming a full fresh window would leave a dead tab
        // looking signed in for hours. Keep asking, progressively less often.
        const step = Math.min(confirmsRef.current, CONFIRM_BACKOFF_MS.length - 1)
        confirmsRef.current += 1
        nextConfirmAtRef.current = Date.now() + CONFIRM_BACKOFF_MS[step]
        return
      }
      redirectToLogin()
    }
    void check()
    const interval = setInterval(() => void check(), RECHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [redirectToLogin])

  // Tick the countdown once a second, but only while the dialog is up.
  useEffect(() => {
    if (!warning) return
    const tick = setInterval(() => {
      const expiresAt = expiresAtRef.current
      if (!expiresAt) return
      setRemainingMs(expiresAt - Date.now())
    }, 1000)
    return () => clearInterval(tick)
  }, [warning])

  const staySignedIn = useCallback(async () => {
    setExtending(true)
    try {
      // Reading the session re-signs the token, which is what extends the idle
      // window. It CANNOT extend the absolute cap: past that, the jwt callback
      // returns null and this comes back empty, so the button correctly fails
      // to save a session that has run out of time.
      const fresh = await getSession()
      const refreshed = fresh?.expires ? new Date(fresh.expires).getTime() : Number.NaN
      if (!Number.isNaN(refreshed)) {
        expiresAtRef.current = refreshed
        setWarning(false)
        return
      }
      redirectToLogin()
    } finally {
      setExtending(false)
    }
  }, [redirectToLogin])

  return (
    <AlertDialog open={warning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>You&apos;re about to be signed out</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;ve been inactive for a while, so we&apos;ll sign you out in{" "}
            <span className="font-mono font-medium text-primary">{formatCountdown(remainingMs)}</span> to keep your
            account safe. Anything you haven&apos;t saved will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={staySignedIn} disabled={extending}>
            {extending ? "Staying signed in…" : "Stay signed in"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
