"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Repeat } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ClientMembership, MembershipPlan } from "@/types/database"

export function MembershipPanel({
  clientUserId,
  membership,
  plans,
}: {
  clientUserId: string
  membership: ClientMembership | null
  plans: MembershipPlan[]
}) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "")
  const [busy, setBusy] = useState(false)

  async function subscribe() {
    if (!planId) return
    setBusy(true)
    try {
      const res = await fetch("/api/admin/memberships/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: clientUserId, planId }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error()
      window.location.href = data.url
    } catch {
      toast.error("Could not start membership")
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-white p-6">
      <div className="mb-4 flex items-center gap-2">
        <Repeat className="size-5 text-primary" strokeWidth={1.5} />
        <h3 className="font-medium text-foreground">Membership (auto-withdrawal)</h3>
      </div>

      {membership && ["active", "trialing", "past_due"].includes(membership.status) ? (
        <p className="text-sm text-foreground">
          <span className="capitalize">{membership.status.replace("_", " ")}</span>
          {membership.current_period_end
            ? ` · renews ${new Date(membership.current_period_end).toLocaleDateString()}`
            : ""}
          {membership.cancel_at_period_end ? " · cancels at period end" : ""}
        </p>
      ) : plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No membership plans yet. Create some under Memberships → Plans.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            className="h-9 rounded-md border border-border bg-white px-2 text-sm"
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — ${(p.price_cents / 100).toFixed(0)}/{p.billing_interval}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={subscribe} disabled={busy}>
            Start membership
          </Button>
        </div>
      )}
    </div>
  )
}
