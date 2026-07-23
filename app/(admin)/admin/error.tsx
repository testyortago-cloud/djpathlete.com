"use client"

import { useEffect } from "react"
import { getSession } from "next-auth/react"
import { ErrorState } from "@/components/shared/ErrorState"
import { loginRedirectUrl } from "@/components/auth/SessionExpiryGuard"
import { hardNavigate } from "@/lib/hard-navigate"

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[admin] Unhandled error:", error)
  }, [error])

  // A stale tab whose session expired can crash into this boundary before the
  // SessionExpiryGuard reacts. If the session is gone, this was never a real
  // page error — send them to log back in instead.
  useEffect(() => {
    let cancelled = false
    getSession()
      .then((session) => {
        if (cancelled || session) return
        hardNavigate(loginRedirectUrl(window.location.pathname, window.location.search))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="p-6">
      <ErrorState
        variant="error"
        title="This admin page hit an error"
        description="Something went wrong loading this page. Try again — if the problem keeps happening, copy the reference below and let support know."
        onReset={reset}
        homeHref="/admin"
        homeLabel="Back to dashboard"
        digest={error.digest}
        fullPage={false}
      />
    </div>
  )
}
