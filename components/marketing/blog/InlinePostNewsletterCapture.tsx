"use client"

import { useState } from "react"
import { Loader2, Check, AlertCircle } from "lucide-react"

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
      className="not-prose my-12 relative border border-border/70 bg-white/70 p-6 sm:p-8"
    >
      <span
        aria-hidden
        className="absolute -top-3 left-6 djp-issue-no text-[10.5px] uppercase tracking-[0.22em] text-accent bg-[oklch(0.985_0.008_80)] px-2"
      >
        ─ Subscribe
      </span>

      <div className="grid sm:grid-cols-[1fr_auto] gap-5 items-end">
        <div>
          <h3
            className="font-heading font-semibold text-primary leading-[1.1] tracking-[-0.01em]"
            style={{ fontSize: "clamp(1.125rem, 2vw, 1.5rem)" }}
          >
            Liked this article? Get the next one in your inbox.
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            One email when a new piece lands. No fluff. Unsubscribe anytime.
          </p>
        </div>
      </div>

      {status === "success" ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-success">
          <Check className="size-4" aria-hidden />
          <span>Subscribed — check your inbox to confirm.</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={status === "submitting"}
            aria-label="Email address"
            className="flex-1 px-4 py-3 border border-border/70 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={status === "submitting" || email.trim().length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-6 py-3 bg-primary text-primary-foreground text-sm font-semibold tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {status === "submitting" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {status === "submitting" ? "Subscribing…" : "Subscribe"}
          </button>
        </form>
      )}

      {status === "error" && errorMsg && (
        <div className="mt-3 flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="size-3.5" aria-hidden />
          <span>{errorMsg}</span>
        </div>
      )}
    </aside>
  )
}
