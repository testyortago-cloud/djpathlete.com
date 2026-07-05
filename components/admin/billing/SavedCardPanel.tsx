"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CreditCard } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { UserPaymentMethod } from "@/types/database"

export function SavedCardPanel({
  clientUserId,
  card,
  bare = false,
  payer,
}: {
  clientUserId: string
  card: UserPaymentMethod | null
  bare?: boolean
  /** When set, this client is billed to a payer — show that payer's card read-only. */
  payer?: { name: string; card: UserPaymentMethod | null } | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  function cardLabel(c: UserPaymentMethod): string {
    const exp = c.exp_month && c.exp_year ? ` · exp ${String(c.exp_month).padStart(2, "0")}/${String(c.exp_year).slice(-2)}` : ""
    return `${c.brand ?? "Card"} ···· ${c.last4 ?? "????"}${exp}`
  }

  async function saveCard() {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientUserId}/save-card`, { method: "POST" })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error()
      window.location.href = data.url
    } catch {
      toast.error("Could not start card setup")
      setBusy(false)
    }
  }

  async function removeCard() {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientUserId}/save-card`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success("Card removed")
      router.refresh()
    } catch {
      toast.error("Could not remove the card")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={bare ? "" : "rounded-xl border border-border bg-white p-6"}>
      <div className="mb-4 flex items-center gap-2">
        <CreditCard className="size-5 text-primary" strokeWidth={1.5} />
        <h3 className="font-medium text-foreground">Card on file</h3>
      </div>
      {payer ? (
        <p className="text-sm text-foreground">
          Billed to <span className="font-medium">{payer.name}</span> —{" "}
          {payer.card ? (
            cardLabel(payer.card)
          ) : (
            <span className="text-warning">{payer.name} has no card saved yet</span>
          )}
        </p>
      ) : card ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-foreground">
            <span className="capitalize">{card.brand ?? "card"}</span> ···· {card.last4 ?? "????"}
            {card.exp_month && card.exp_year ? (
              <span className="text-muted-foreground">
                {" "}
                · exp {String(card.exp_month).padStart(2, "0")}/{String(card.exp_year).slice(-2)}
              </span>
            ) : null}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={saveCard} disabled={busy}>
              Update
            </Button>
            <Button variant="ghost" size="sm" onClick={removeCard} disabled={busy}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">No card saved. Needed for auto-withdrawal and no-show fees.</p>
          <Button size="sm" onClick={saveCard} disabled={busy}>
            Add card
          </Button>
        </div>
      )}
    </div>
  )
}
