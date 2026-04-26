"use client"

import { useEffect } from "react"
import { ErrorState } from "@/components/shared/ErrorState"

export default function ClientError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[client] Unhandled error:", error)
  }, [error])

  return (
    <div className="p-4 sm:p-6">
      <ErrorState
        variant="error"
        title="We hit a snag loading your dashboard"
        description="Don't worry — your training data is safe. Try again, and if this keeps happening let your coach know."
        onReset={reset}
        homeHref="/client/dashboard"
        homeLabel="Back to dashboard"
        digest={error.digest}
        fullPage={false}
      />
    </div>
  )
}
