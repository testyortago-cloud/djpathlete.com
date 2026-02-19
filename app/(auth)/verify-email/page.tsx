import type { Metadata } from "next"
import { Suspense } from "react"
import { VerifyEmailContent } from "./VerifyEmailContent"

export const metadata: Metadata = {
  title: "Verify Email",
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Verifying...</div>}>
      <VerifyEmailContent />
    </Suspense>
  )
}
