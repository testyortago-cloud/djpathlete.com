"use client"

import { useEffect } from "react"
import { ErrorState } from "@/components/shared/ErrorState"

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[auth] Unhandled error:", error)
  }, [error])

  return (
    <div className="py-12">
      <ErrorState
        variant="error"
        title="We couldn't load this page"
        description="Something went wrong on our end. Try again, or head to the login page to start fresh."
        onReset={reset}
        homeHref="/login"
        homeLabel="Go to login"
        digest={error.digest}
        fullPage={false}
      />
    </div>
  )
}
