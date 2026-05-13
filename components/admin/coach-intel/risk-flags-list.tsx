"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { RiskFlag } from "@/types/database"

const SEVERITY_LABEL: Record<RiskFlag["severity"], string> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
}

const SEVERITY_BG: Record<RiskFlag["severity"], string> = {
  high: "bg-error/10 text-error",
  medium: "bg-warning/10 text-warning",
  low: "bg-muted text-muted-foreground",
}

export function RiskFlagsList({ flags }: { flags: RiskFlag[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function actOn(id: string, action: "acknowledge" | "dismiss") {
    setBusy(id)
    try {
      const res = await fetch(`/api/risk-flags/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success(`Flag ${action}d`)
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (flags.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-12 text-center">
          No risk flags.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ol className="divide-y">
          {flags.map((f) => (
            <li key={f.id} className="flex items-start justify-between gap-4 p-4">
              <div className="flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-bold ${SEVERITY_BG[f.severity]}`}
                  >
                    {SEVERITY_LABEL[f.severity]}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {f.flag_type} · {f.triggered_at}
                  </span>
                </div>
                <p>{f.message}</p>
              </div>
              {f.status === "open" && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === f.id}
                    onClick={() => actOn(f.id, "acknowledge")}
                  >
                    Ack
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === f.id}
                    onClick={() => actOn(f.id, "dismiss")}
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
