"use client"

import { useEffect } from "react"
import { ErrorState } from "@/components/shared/ErrorState"

export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[marketing] Unhandled error:", error)
  }, [error])

  return (
    <ErrorState
      variant="error"
      title="This page didn't load properly"
      description="An unexpected error stopped this page from loading. Please try again, or head back to the homepage to continue browsing."
      onReset={reset}
      homeHref="/"
      homeLabel="Back to home"
      digest={error.digest}
    />
  )
}
