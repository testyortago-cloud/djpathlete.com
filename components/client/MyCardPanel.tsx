"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CreditCard } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ClientPackage, UserPaymentMethod } from "@/types/database"

type AutoRenewPack = Pick<ClientPackage, "id" | "session_type" | "credits_total" | "price_cents" | "auto_renew">

/** The athlete's own card-on-file management (on /client/sessions). Also
 *  surfaces auto-renew consent, since "auto_renew" lives on the pack, not the
 *  user — a client could have it armed on more than one pack over time. */
export function MyCardPanel({ card, packs = [] }: { card: UserPaymentMethod | null; packs?: AutoRenewPack[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [turningOffId, setTurningOffId] = useState<string | null>(null)
  const armedPacks = packs.filter((p) => p.auto_renew)

  async function turnOffAutoRenew(packId: string) {
    setTurningOffId(packId)
    try {
      const res = await fetch(`/api/client/session-packs/${packId}/auto-renew`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoRenew: false }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error ?? "Could not turn off auto-renew")
        return
      }
      toast.success("Auto-renew turned off")
      router.refresh()
    } catch {
      toast.error("Network error — auto-renew not updated")
    } finally {
      setTurningOffId(null)
    }
  }

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

      {armedPacks.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Auto-renew</p>
          {armedPacks.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-foreground">
                On for your {p.session_type} pack — buys another {p.credits_total}-session pack ($
                {(p.price_cents / 100).toFixed(0)}) on this card when it runs out.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => turnOffAutoRenew(p.id)}
                disabled={turningOffId === p.id}
              >
                Turn off
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
