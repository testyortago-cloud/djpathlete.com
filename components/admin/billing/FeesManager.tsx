"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SessionFeeCharge } from "@/types/database"

type Config = { noShowFeeCents: number; lateCancelFeeCents: number; cancelWindowHours: number }

const STATUS_CHIP: Record<string, string> = {
  succeeded: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
  pending: "bg-warning/10 text-warning",
  waived: "bg-muted text-muted-foreground",
}

export function FeesManager({ config: initial, charges }: { config: Config; charges: SessionFeeCharge[] }) {
  const router = useRouter()
  const [noShow, setNoShow] = useState(String(initial.noShowFeeCents / 100))
  const [late, setLate] = useState(String(initial.lateCancelFeeCents / 100))
  const [windowH, setWindowH] = useState(String(initial.cancelWindowHours))
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/sessions/fees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          noShowFeeCents: Math.round(Number(noShow) * 100),
          lateCancelFeeCents: Math.round(Number(late) * 100),
          cancelWindowHours: Math.round(Number(windowH)),
        }),
      })
      if (!res.ok) throw new Error()
      toast.success("Fee settings saved")
    } catch {
      toast.error("Could not save settings")
    } finally {
      setBusy(false)
    }
  }

  async function act(id: string, action: "retry" | "waive") {
    const res = await fetch(`/api/admin/sessions/fees/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    })
    if (!res.ok) return toast.error("Action failed")
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-2xl border border-border bg-white p-5 shadow-sm">
        <h2 className="font-medium text-foreground">Fee settings</h2>
        <p className="text-xs text-muted-foreground">
          Set an amount to 0 to disable that fee. Fees only charge when the Session fees flag is on and the client has a
          card on file.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>No-show fee (USD)</Label>
            <Input type="number" value={noShow} onChange={(e) => setNoShow(e.target.value)} />
          </div>
          <div>
            <Label>Late-cancel fee (USD)</Label>
            <Input type="number" value={late} onChange={(e) => setLate(e.target.value)} />
          </div>
          <div>
            <Label>Cancel window (hours)</Label>
            <Input type="number" value={windowH} onChange={(e) => setWindowH(e.target.value)} />
          </div>
        </div>
        <Button onClick={save} disabled={busy}>
          Save settings
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-medium text-foreground">Recent fee charges</h2>
        {charges.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fee charges yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {charges.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-foreground">
                  {c.kind === "no_show" ? "No-show" : "Late cancel"} · ${(c.amount_cents / 100).toFixed(2)}
                </span>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[c.status] ?? ""}`}>
                    {c.status}
                  </span>
                  {c.status === "failed" && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => act(c.id, "retry")}>
                        Retry
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => act(c.id, "waive")}>
                        Waive
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
