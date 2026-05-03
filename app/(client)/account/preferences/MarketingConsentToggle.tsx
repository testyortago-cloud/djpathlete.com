"use client"

import { useState } from "react"
import { toast } from "sonner"

interface Props {
  initialGranted: boolean
}

export function MarketingConsentToggle({ initialGranted }: Props) {
  const [granted, setGranted] = useState(initialGranted)
  const [pending, setPending] = useState(false)

  async function toggle(next: boolean) {
    if (pending) return
    setPending(true)
    const prev = granted
    setGranted(next) // optimistic

    try {
      const res = await fetch("/api/account/preferences/marketing-consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ granted: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success(next ? "Marketing emails enabled." : "Marketing emails disabled.")
    } catch (err) {
      setGranted(prev) // rollback
      toast.error("Couldn't update — please try again.")
      console.error("[MarketingConsentToggle]", err)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-start gap-3 p-4 border border-border rounded-lg">
      <input
        type="checkbox"
        id="marketing-consent"
        checked={granted}
        onChange={(e) => toggle(e.target.checked)}
        disabled={pending}
        className="mt-1 size-4 accent-accent shrink-0"
      />
      <div className="flex-1">
        <label htmlFor="marketing-consent" className="font-medium text-sm cursor-pointer">
          Marketing emails &amp; personalized advertising
        </label>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          When enabled, we may send you marketing emails and use your hashed email for personalized
          advertising on Google. Hashed means the email itself is never sent — only an irreversible
          fingerprint that Google uses to match you across services. You can disable this any time.
        </p>
      </div>
    </div>
  )
}
