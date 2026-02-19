"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Mail, X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface EmailVerificationBannerProps {
  userId: string
}

export function EmailVerificationBanner({ userId }: EmailVerificationBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  const [isSending, setIsSending] = useState(false)

  if (dismissed) return null

  async function handleResend() {
    setIsSending(true)
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to resend verification email")
      }

      toast.success("Verification email sent!")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send verification email"
      )
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="bg-warning/10 border border-warning/20 rounded-xl p-4 mb-6">
      <div className="flex items-start gap-3 sm:items-center">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning/20">
          <Mail className="size-4 text-warning" />
        </div>

        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground">
            Please verify your email address. Check your inbox for a verification link.
          </p>

          <Button
            variant="outline"
            size="sm"
            onClick={handleResend}
            disabled={isSending}
            className="w-fit shrink-0 border-warning/30 text-warning hover:bg-warning/10"
          >
            {isSending ? "Sending..." : "Resend Email"}
          </Button>
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-warning/10 hover:text-foreground transition-colors"
          aria-label="Dismiss"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
