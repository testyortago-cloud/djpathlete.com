"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CreditCard } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { UserPaymentMethod } from "@/types/database"

/** The athlete's own card-on-file management (on /client/sessions). */
export function MyCardPanel({ card }: { card: UserPaymentMethod | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function addCard() {
    setBusy(true)
    try {
      const res = await fetch("/api/client/save-card", { method: "POST" })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error()
      window.location.href = data.url // Stripe hosted card page
    } catch {
      toast.error("Could not start card setup")
      setBusy(false)
    }
  }

  async function removeCard() {
    setBusy(true)
    try {
      const res = await fetch("/api/client/save-card", { method: "DELETE" })
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
    <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <CreditCard className="size-5 text-primary" strokeWidth={1.5} />
        <h2 className="font-medium text-foreground">Payment method</h2>
      </div>
      {card ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-foreground">
            <span className="capitalize">{card.brand ?? "Card"}</span> ···· {card.last4 ?? "????"}
            {card.exp_month && card.exp_year ? (
              <span className="text-muted-foreground">
                {" "}
                · exp {String(card.exp_month).padStart(2, "0")}/{String(card.exp_year).slice(-2)}
              </span>
            ) : null}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={addCard} disabled={busy}>
              Update
            </Button>
            <Button variant="ghost" size="sm" onClick={removeCard} disabled={busy}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Add a card so your coach can bill memberships and in-person sessions automatically. Entered securely on
            Stripe.
          </p>
          <Button size="sm" onClick={addCard} disabled={busy}>
            {busy ? "Opening…" : "Add card"}
          </Button>
        </div>
      )}
    </div>
  )
}
