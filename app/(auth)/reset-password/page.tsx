import type { Metadata } from "next"
import { Suspense } from "react"
import { ResetPasswordForm } from "./ResetPasswordForm"

export const metadata: Metadata = {
  title: "Reset Password",
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading...</div>}>
      <ResetPasswordForm />
    </Suspense>
  )
}
