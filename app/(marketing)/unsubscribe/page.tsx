"use client"

import { useState } from "react"
import { toast } from "sonner"

export default function UnsubscribePage() {
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setSubmitting(true)

    try {
      const res = await fetch("/api/newsletter/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) throw new Error("Failed")
      setDone(true)
      toast.success("You've been unsubscribed.")
    } catch {
      toast.error("Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        {done ? (
          <>
            <h1 className="text-2xl font-heading font-semibold text-primary mb-4">Unsubscribed</h1>
            <p className="text-muted-foreground">
              You&apos;ve been removed from our newsletter. You won&apos;t receive any more blog updates.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-heading font-semibold text-primary mb-4">Unsubscribe from Newsletter</h1>
            <p className="text-muted-foreground mb-8">
              Enter your email to stop receiving blog updates from DJP Athlete.
            </p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <input
                type="email"
                placeholder="Your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={submitting}
                className="h-12 px-4 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <button
                type="submit"
                disabled={submitting}
                className="h-12 px-8 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {submitting ? "Unsubscribing..." : "Unsubscribe"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
