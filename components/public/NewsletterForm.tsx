"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export function NewsletterForm() {
  const [email, setEmail] = useState("")
  const [consent, setConsent] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    if (!consent) {
      toast.error("Please confirm you'd like to receive marketing emails before subscribing.")
      return
    }
    setIsSubmitting(true)

    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, consent_marketing: consent }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const message =
          (typeof data?.error === "string" && data.error) ||
          (response.status === 409
            ? "That email is already subscribed."
            : response.status >= 500
              ? "Our server hit an error. Please try again in a moment."
              : "We couldn't subscribe you. Please check your email and try again.")
        toast.error(message)
        setIsSubmitting(false)
        return
      }

      setSubmitted(true)
      toast.success("You're subscribed!")
    } catch {
      toast.error("We couldn't reach our server. Please check your connection and try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitted) {
    return <p className="text-primary-foreground/70 text-sm">Thanks for subscribing! You'll hear from us soon.</p>
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-md mx-auto">
      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          type="email"
          placeholder="Your email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-12 bg-white/10 border-white/20 text-primary-foreground placeholder:text-primary-foreground/50 focus-visible:border-accent focus-visible:ring-accent/30"
          required
          disabled={isSubmitting}
          aria-label="Email address"
        />
        <Button
          type="submit"
          disabled={isSubmitting}
          className="h-12 px-8 bg-accent text-primary hover:bg-accent/90 rounded-md font-semibold shrink-0"
        >
          {isSubmitting ? "Subscribing..." : "Subscribe"}
        </Button>
      </div>
      <label className="flex items-start gap-2 text-xs text-primary-foreground/70 leading-relaxed cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={isSubmitting}
          className="mt-0.5 size-4 accent-accent shrink-0"
          required
        />
        <span>
          I consent to receiving marketing emails from DJP Athlete, including the use of my hashed
          email for personalized advertising on Google. I can opt out at any time.
        </span>
      </label>
    </form>
  )
}
