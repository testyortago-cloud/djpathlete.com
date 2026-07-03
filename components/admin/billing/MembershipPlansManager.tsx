"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { MembershipPlan } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const EMPTY = { name: "", price: "", interval: "month", sessions: "" }

export function MembershipPlansManager({ initialPlans }: { initialPlans: MembershipPlan[] }) {
  const [plans, setPlans] = useState(initialPlans)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/memberships/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          priceCents: Math.round(Number(form.price) * 100),
          billingInterval: form.interval,
          sessionsPerPeriod: form.sessions ? Number(form.sessions) : null,
        }),
      })
      if (!res.ok) throw new Error()
      const { plan } = await res.json()
      setPlans((p) => [...p, plan])
      setForm(EMPTY)
      toast.success("Plan added")
    } catch {
      toast.error("Could not add plan")
    } finally {
      setBusy(false)
    }
  }

  async function toggle(p: MembershipPlan) {
    const res = await fetch(`/api/admin/memberships/plans/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !p.is_active }),
    })
    if (!res.ok) return toast.error("Update failed")
    const { plan } = await res.json()
    setPlans((list) => list.map((x) => (x.id === plan.id ? plan : x)))
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        {plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No plans yet — add one below.</p>
        ) : (
          <ul className="divide-y divide-border">
            {plans.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-foreground">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    ${(p.price_cents / 100).toFixed(2)} / {p.billing_interval}
                    {p.sessions_per_period ? ` · ${p.sessions_per_period} sessions` : ""} · {p.is_active ? "Active" : "Archived"}
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
        <h2 className="font-medium text-foreground">New membership plan</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Price (USD)</Label>
            <Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </div>
          <div>
            <Label>Billing interval</Label>
            <select
              value={form.interval}
              onChange={(e) => setForm({ ...form, interval: e.target.value })}
              className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
            >
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
          </div>
          <div>
            <Label>Sessions / period (optional)</Label>
            <Input type="number" value={form.sessions} onChange={(e) => setForm({ ...form, sessions: e.target.value })} />
          </div>
        </div>
        <Button onClick={add} disabled={busy || !form.name || !form.price}>
          Add plan
        </Button>
      </div>
    </div>
  )
}
