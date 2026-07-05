"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Users } from "lucide-react"

export type PayerCandidate = { id: string; name: string }

/** Sets who pays for this client's automatic charges (fees + memberships). */
export function BillingPayerControl({
  clientUserId,
  currentPayerId,
  candidates,
}: {
  clientUserId: string
  currentPayerId: string | null
  candidates: PayerCandidate[]
}) {
  const router = useRouter()
  const [value, setValue] = useState(currentPayerId ?? "")
  const [busy, setBusy] = useState(false)

  async function change(next: string) {
    const prev = value
    setValue(next)
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientUserId}/billing-payer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payerUserId: next || null }),
      })
      if (!res.ok) throw new Error()
      toast.success(next ? "Billing payer set" : "Client now pays for themselves")
      router.refresh()
    } catch {
      setValue(prev)
      toast.error("Could not update billing payer")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Users className="size-4" strokeWidth={1.5} />
        Charges paid by
      </span>
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        disabled={busy}
        className="h-9 rounded-md border border-border bg-white px-2 text-sm"
      >
        <option value="">Themselves</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  )
}
