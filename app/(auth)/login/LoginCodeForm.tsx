"use client"

import { useEffect, useState } from "react"
import { signIn } from "next-auth/react"
import { MailCheck } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"

// Mirrors LOGIN_CODE_COOLDOWN_SECONDS in lib/db/login-codes.ts (server-only module):
// inside it the server keeps the code already sent, so the button waits too.
const RESEND_WAIT_SECONDS = 60

const PRIMARY =
  "w-full rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
const TEXT_BUTTON =
  "text-xs font-medium text-muted-foreground hover:text-primary transition-colors disabled:opacity-50 disabled:pointer-events-none"

interface LoginCodeFormProps {
  initialEmail: string
  onSignedIn: () => Promise<void>
  onUsePassword: (email: string) => void
}

export function LoginCodeForm({ initialEmail, onSignedIn, onUsePassword }: LoginCodeFormProps) {
  const [email, setEmail] = useState(initialEmail)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [waitSeconds, setWaitSeconds] = useState(0)

  useEffect(() => {
    if (waitSeconds <= 0) return
    const t = setTimeout(() => setWaitSeconds((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [waitSeconds])

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    setIsLoading(true)
    try {
      const res = await fetch("/api/auth/login-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "We couldn't send a code right now. Please try again in a minute.")
        return
      }
      setSentTo(email.trim())
      setCode("")
      setWaitSeconds(RESEND_WAIT_SECONDS)
    } catch {
      setError("We couldn't reach the server. Please check your connection and try again.")
    } finally {
      setIsLoading(false)
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsLoading(true)
    const result = await signIn("email-code", { email: sentTo, code, redirect: false })
    if (result?.error) {
      setIsLoading(false)
      setError(
        "That code didn't work. Use the code in our newest email, or send a new one. Each code lasts 10 minutes.",
      )
      return
    }
    await onSignedIn()
  }

  return (
    <>
      <div className="mb-4">
        <FormErrorBanner message={error} />
      </div>

      {sentTo === null ? (
        <form onSubmit={sendCode} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code-email" className="text-sm font-medium text-primary">
              Email
            </Label>
            <Input
              id="code-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
              className="h-11 rounded-lg border-border focus:border-primary focus:ring-primary"
            />
          </div>
          <button type="submit" disabled={isLoading} className={PRIMARY}>
            {isLoading ? "Sending..." : "Send me a code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <div
            role="status"
            className="flex items-start gap-2 rounded-xl border border-border bg-surface/50 p-4 text-sm"
          >
            <MailCheck className="size-4 mt-0.5 shrink-0 text-primary" />
            <p>
              If <span className="font-medium text-primary break-all">{sentTo}</span> has an account, we&apos;ve emailed
              it a 6-digit code. It works for 10 minutes. Can&apos;t see it? Check your spam folder.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="login-code" className="text-sm font-medium text-primary">
              6-digit code
            </Label>
            <Input
              id="login-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
              required
              disabled={isLoading}
              className="h-12 rounded-lg border-border text-center font-mono text-xl tracking-[0.5em] focus:border-primary focus:ring-primary"
            />
          </div>
          <button type="submit" disabled={isLoading || code.length !== 6} className={PRIMARY}>
            {isLoading ? "Signing in..." : "Sign in"}
          </button>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => sendCode()}
              disabled={isLoading || waitSeconds > 0}
              className={TEXT_BUTTON}
            >
              {waitSeconds > 0 ? `Send a new code in ${waitSeconds}s` : "Send a new code"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSentTo(null)
                setError(null)
              }}
              className={TEXT_BUTTON}
            >
              Use a different email
            </button>
          </div>
        </form>
      )}

      <p className="mt-6 text-center">
        <button type="button" onClick={() => onUsePassword(email)} className={TEXT_BUTTON}>
          Use my password instead
        </button>
      </p>
    </>
  )
}
