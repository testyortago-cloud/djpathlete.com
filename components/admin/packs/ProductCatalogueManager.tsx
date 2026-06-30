"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { SessionPackProduct } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const EMPTY_FORM = { name: "", sessionType: "", credits: "10", price: "", validityDays: "" }

export function ProductCatalogueManager({ initialProducts }: { initialProducts: SessionPackProduct[] }) {
  const [products, setProducts] = useState(initialProducts)
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/session-packs/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          sessionType: form.sessionType,
          credits: Number(form.credits),
          priceCents: Math.round(Number(form.price) * 100),
          validityDays: form.validityDays ? Number(form.validityDays) : null,
        }),
      })
      if (!res.ok) throw new Error()
      const { product } = await res.json()
      setProducts((p) => [product, ...p])
      setForm(EMPTY_FORM)
      toast.success("Product added")
    } catch {
      toast.error("Could not add product")
    } finally {
      setBusy(false)
    }
  }

  async function toggle(p: SessionPackProduct) {
    const res = await fetch(`/api/admin/session-packs/products/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !p.is_active }),
    })
    if (!res.ok) {
      toast.error("Update failed")
      return
    }
    const { product } = await res.json()
    setProducts((list) => list.map((x) => (x.id === product.id ? product : x)))
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products yet — add one below.</p>
        ) : (
          <ul className="divide-y divide-border">
            {products.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-foreground">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.credits} × {p.session_type} · ${(p.price_cents / 100).toFixed(2)}
                    {p.validity_days ? ` · ${p.validity_days}d` : ""} · {p.is_active ? "Active" : "Archived"}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => toggle(p)}>
                  {p.is_active ? "Deactivate" : "Activate"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3 rounded-2xl border border-border bg-white p-5 shadow-sm">
        <h2 className="font-medium text-foreground">New product</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Session type</Label>
            <Input value={form.sessionType} onChange={(e) => setForm({ ...form, sessionType: e.target.value })} />
          </div>
          <div>
            <Label>Credits</Label>
            <Input type="number" value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} />
          </div>
          <div>
            <Label>Price (USD)</Label>
            <Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </div>
          <div>
            <Label>Validity days (optional)</Label>
            <Input
              type="number"
              value={form.validityDays}
              onChange={(e) => setForm({ ...form, validityDays: e.target.value })}
            />
          </div>
        </div>
        <Button onClick={add} disabled={busy || !form.name || !form.sessionType || !form.price}>
          Add product
        </Button>
      </div>
    </div>
  )
}
