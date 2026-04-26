"use client"
import { useState } from "react"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { summarizeApiError } from "@/lib/errors/humanize"

export function FreePdfForm({ productId }: { productId: string }) {
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const f = new FormData(e.currentTarget)
    try {
      const res = await fetch("/api/shop/leads", {
        method: "POST",
        body: JSON.stringify({
          email: String(f.get("email") ?? ""),
          product_id: productId,
          website: String(f.get("website") ?? ""),
        }),
      })
      setSubmitting(false)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const { message } = summarizeApiError(res, data, "We couldn't send your download link. Please try again.")
        setError(message)
        return
      }
      setDone(true)
    } catch {
      setSubmitting(false)
      setError("We couldn't reach the server. Please check your connection and try again.")
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl bg-accent/10 p-6 text-primary">
        <p className="font-heading text-lg">Check your email.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent the download link to your inbox. Didn&apos;t arrive? Re-submit below.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <FormErrorBanner message={error} />
      <label className="block">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Email
        </span>
        <input
          name="email"
          type="email"
          required
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      {/* Honeypot: hidden from humans */}
      <label aria-hidden="true" style={{ position: "absolute", left: "-9999px" }}>
        website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-primary px-6 py-3 font-mono text-sm uppercase tracking-widest text-primary-foreground disabled:opacity-50"
      >
        {submitting ? "Sending\u2026" : "Get free download"}
      </button>
    </form>
  )
}
