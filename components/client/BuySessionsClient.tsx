"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { SessionPackProduct } from "@/types/database"
import { Button } from "@/components/ui/button"

export function BuySessionsClient({ products }: { products: SessionPackProduct[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  // Consent checkbox: save my own card and auto-buy a replacement pack on
  // depletion. Default OFF, per-product (a client may tick it for one
  // product and not another before hitting Buy).
  const [autoRenewByProduct, setAutoRenewByProduct] = useState<Record<string, boolean>>({})

  if (products.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">No sessions available to buy right now. Check back soon.</p>
      </div>
    )
  }

  async function buy(p: SessionPackProduct) {
    setBusy(p.id)
    try {
      const res = await fetch("/api/client/session-packs/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: p.id, autoRenew: autoRenewByProduct[p.id] ?? false }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error()
      window.location.href = data.url
    } catch {
      toast.error("Could not start checkout")
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {products.map((p) => (
        <div key={p.id} className="flex flex-col rounded-2xl border border-border bg-white p-5 shadow-sm">
          <p className="font-medium text-foreground">{p.name}</p>
          <p className="text-xs text-muted-foreground">
            {p.credits} × {p.session_type}
            {p.validity_days ? ` · valid ${p.validity_days} days` : ""}
          </p>
          <p className="my-3 text-2xl font-semibold text-primary">${(p.price_cents / 100).toFixed(0)}</p>
          <label htmlFor={`autoRenew-${p.id}`} className="mb-3 flex items-start gap-2 text-xs text-muted-foreground">
            <input
              id={`autoRenew-${p.id}`}
              type="checkbox"
              checked={autoRenewByProduct[p.id] ?? false}
              onChange={(e) =>
                setAutoRenewByProduct((prev) => ({ ...prev, [p.id]: e.target.checked }))
              }
              className="mt-0.5 size-4 rounded border-border"
            />
            <span>
              Save my card and automatically buy another {p.credits}-session pack (${(p.price_cents / 100).toFixed(0)}
              ) when this one runs out. The saved card may also be used for any no-show or late-cancellation fees.
              Cancel any time.
            </span>
          </label>
          <Button className="mt-auto" onClick={() => buy(p)} disabled={busy === p.id}>
            {busy === p.id ? "Starting…" : "Buy"}
          </Button>
        </div>
      ))}
    </div>
  )
}
