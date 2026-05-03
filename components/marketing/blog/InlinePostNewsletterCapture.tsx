"use client"

import { useState } from "react"
import { Mail, Loader2, Check, AlertCircle } from "lucide-react"

type Status = "idle" | "submitting" | "success" | "error"

export function InlinePostNewsletterCapture() {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (status === "submitting" || status === "success") return
    setStatus("submitting")
    setErrorMsg(null)
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          consent_marketing: true,
          source: "blog_inline",
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Subscription failed")
      }
      setStatus("success")
    } catch (err) {
      setStatus("error")
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong")
    }
  }

  return (
    <aside
      aria-label="Newsletter signup"
      className="my-8 not-prose rounded-xl border border-border bg-white p-5 sm:p-6"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="shrink-0 size-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Mail className="size-4 text-primary" aria-hidden />
        </div>
        <div>
          <p className="font-heading text-primary text-base sm:text-lg leading-snug">
            Liked this? Get the next one in your inbox.
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            One email when a new post lands. No spam.
          </p>
        </div>
      </div>

      {status === "success" ? (
        <div className="flex items-center gap-2 text-sm text-success">
          <Check className="size-4" aria-hidden />
          <span>Subscribed — check your inbox to confirm.</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={status === "submitting"}
            aria-label="Email address"
            className="flex-1 px-3 py-2 rounded-md border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={status === "submitting" || email.trim().length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {status === "submitting" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {status === "submitting" ? "Subscribing..." : "Subscribe"}
          </button>
        </form>
      )}

      {status === "error" && errorMsg && (
        <div className="mt-2 flex items-center gap-2 text-xs text-red-500">
          <AlertCircle className="size-3.5" aria-hidden />
          <span>{errorMsg}</span>
        </div>
      )}
    </aside>
  )
}
