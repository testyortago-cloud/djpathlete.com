"use client"

import { useState } from "react"
import { ArrowRight, CheckCircle } from "lucide-react"
import { Input } from "@/components/ui/input"

export function WaitlistForm() {
  const [email, setEmail] = useState("")
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!email.trim()) return

    setIsSubmitting(true)

    // Simulate submission delay for UX
    setTimeout(() => {
      setIsSubmitted(true)
      setIsSubmitting(false)
    }, 600)
  }

  if (isSubmitted) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-full bg-accent/20">
          <CheckCircle className="size-6 text-accent" />
        </div>
        <p className="text-lg font-medium text-primary-foreground">You&apos;re on the list.</p>
        <p className="text-sm text-primary-foreground/70">We will be in touch when early access opens.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-md mx-auto">
      <Input
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        disabled={isSubmitting}
        className="h-12 rounded-full bg-white/10 border-white/20 text-primary-foreground placeholder:text-primary-foreground/50 focus:border-accent focus:ring-accent"
      />
      <button
        type="submit"
        disabled={isSubmitting}
        className="shrink-0 inline-flex items-center gap-2 bg-accent text-primary px-6 py-3 rounded-full text-sm font-medium hover:bg-accent/90 transition-all hover:shadow-md disabled:opacity-50 disabled:pointer-events-none"
      >
        {isSubmitting ? "Submitting..." : "Get Early Notification"}
        {!isSubmitting && <ArrowRight className="size-4" />}
      </button>
    </form>
  )
}
