"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { CheckCircle2, Mail } from "lucide-react"

export function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token")

  const [status, setStatus] = useState<"loading" | "success" | "error" | "invalid">(
    token ? "loading" : "invalid"
  )
  const [errorMessage, setErrorMessage] = useState<string>("")

  useEffect(() => {
    if (!token) return

    async function verifyEmail() {
      try {
        const response = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || "Verification failed")
        }

        setStatus("success")
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "Something went wrong. Please try again."
        )
        setStatus("error")
      }
    }

    verifyEmail()
  }, [token])

  if (status === "loading") {
    return (
      <div className="text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 mb-4 mx-auto">
          <Mail className="size-6 text-primary animate-pulse" />
        </div>
        <h1 className="text-2xl font-semibold text-primary tracking-tight">
          Verifying your email...
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Please wait while we verify your email address.
        </p>
      </div>
    )
  }

  if (status === "success") {
    return (
      <div className="text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-success/10 mb-4 mx-auto">
          <CheckCircle2 className="size-6 text-success" />
        </div>
        <h1 className="text-2xl font-semibold text-primary tracking-tight">
          Email verified!
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your email address has been successfully verified. You can now access all features.
        </p>
        <Link
          href="/client/dashboard"
          className="mt-6 w-full inline-flex items-center justify-center rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-lg"
        >
          Go to Dashboard
        </Link>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div className="text-center">
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
        <h1 className="text-2xl font-semibold text-primary tracking-tight mb-2">
          Verification failed
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          The verification link may have expired or already been used.
        </p>
        <Link
          href="/client/dashboard"
          className="text-sm font-medium text-primary hover:underline"
        >
          Request new link
        </Link>
      </div>
    )
  }

  // status === "invalid"
  return (
    <div className="text-center">
      <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        No verification token found in the URL.
      </div>
      <h1 className="text-2xl font-semibold text-primary tracking-tight mb-2">
        Invalid link
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        This verification link appears to be invalid. Please check your email for the correct link.
      </p>
      <Link
        href="/client/dashboard"
        className="text-sm font-medium text-primary hover:underline"
      >
        Go to Dashboard
      </Link>
    </div>
  )
}
