"use client"

import { useEffect } from "react"
import { ErrorState } from "@/components/shared/ErrorState"

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
