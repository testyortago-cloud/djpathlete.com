"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Ticket, Check, Plus, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SellPackDialog } from "./SellPackDialog"
import type { ClientPackage, SessionCheckin } from "@/types/database"

type PackWithCheckins = ClientPackage & { checkins: SessionCheckin[]; program_name?: string | null }

const STATUS_COLORS: Record<string, string> = {
  active: "bg-success/10 text-success",
  depleted: "bg-warning/10 text-warning",
  expired: "bg-muted text-muted-foreground",
  refunded: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
}

function remaining(p: ClientPackage) {
  return Math.max(0, p.credits_total - p.credits_used)
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function ClientPackagesPanel({ clientUserId }: { clientUserId: string }) {
  const [packages, setPackages] = useState<PackWithCheckins[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/session-packs?clientUserId=${clientUserId}`)
      const data = await res.json()
      if (res.ok) setPackages(data.packages ?? [])
    } finally {
      setLoading(false)
    }
  }, [clientUserId])

  useEffect(() => {
    void load()
  }, [load])

  async function checkIn() {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/session-packs/checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientUserId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Could not check in")
        return
      }
      if (data.reason === "duplicate") toast.info("Already checked in recently")
      else toast.success(`Checked in — ${data.remaining} left`)
      await load()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  async function voidCheckin(checkinId: string) {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/session-packs/void", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkinId }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error ?? "Could not undo")
        return
      }
      toast.success("Check-in undone, credit restored")
      await load()
    } finally {
      setBusy(false)
    }
  }

  const activePacks = packages.filter((p) => p.status === "active")

  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-primary flex items-center gap-2">
          <Ticket className="size-5" strokeWidth={1.5} />
          Session Packs
        </h2>
        <div className="flex items-center gap-2">
          {activePacks.length > 0 && (
            <Button size="sm" onClick={checkIn} disabled={busy}>
              <Check className="size-4" />
              Check in
            </Button>
          )}
          <SellPackDialog
            clientUserId={clientUserId}
            onSold={load}
            trigger={
              <Button size="sm" variant="outline">
                <Plus className="size-4" />
                Sell pack
              </Button>
            }
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : packages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No packs yet. Sell a pack and check the client in at the end of each session.
        </p>
      ) : (
        <div className="space-y-4">
          {packages.map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="font-medium text-foreground">
                    {p.session_type}
                    <span
                      className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                        STATUS_COLORS[p.status] ?? "bg-muted text-muted-foreground"
                      }`}
                    >
                      {p.status}
                    </span>
                    {p.payment_status === "pending" && (
                      <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-warning/10 text-warning">
                        awaiting payment
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Bought {fmtDate(p.purchased_at)}
                    {p.expires_at ? ` · expires ${fmtDate(p.expires_at)}` : " · no expiry"}
                  </p>
                  {p.program_name && (
                    <p className="text-xs text-accent mt-0.5">
                      → {p.program_name} · advances on check-in
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-primary">
                    {remaining(p)}
                    <span className="text-sm text-muted-foreground font-normal"> / {p.credits_total}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">sessions left</p>
                </div>
              </div>

              {p.checkins.length > 0 && (
                <div className="mt-3 border-t border-border pt-3 space-y-1.5">
                  {p.checkins.slice(0, 6).map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm">
                      <span className={c.voided ? "text-muted-foreground line-through" : "text-foreground"}>
                        {fmtDate(c.checked_in_at)} · {c.method.replace("_", " ")}
                      </span>
                      {!c.voided && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-muted-foreground"
                          onClick={() => voidCheckin(c.id)}
                          disabled={busy}
                        >
                          <Undo2 className="size-3.5" />
                          Undo
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
