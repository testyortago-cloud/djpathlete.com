"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { SessionPackProduct } from "@/types/database"
import { Button } from "@/components/ui/button"

export function BuySessionsClient({ products }: { products: SessionPackProduct[] }) {
  const [busy, setBusy] = useState<string | null>(null)

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
        body: JSON.stringify({ productId: p.id }),
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
          <Button className="mt-auto" onClick={() => buy(p)} disabled={busy === p.id}>
            {busy === p.id ? "Starting…" : "Buy"}
          </Button>
        </div>
      ))}
    </div>
  )
}
