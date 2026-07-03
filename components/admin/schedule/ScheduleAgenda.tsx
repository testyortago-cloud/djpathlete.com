"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, X, Ban } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ScheduledSession } from "@/types/database"

export type AgendaSession = ScheduledSession & { clientName: string }

const STATUS_CHIP: Record<string, string> = {
  scheduled: "bg-muted text-muted-foreground",
  attended: "bg-success/10 text-success",
  no_show: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground line-through",
}

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

function fmtTime(t: string): string {
  return t.slice(0, 5)
}

export function ScheduleAgenda({ sessions }: { sessions: AgendaSession[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function act(id: string, body: Record<string, unknown>) {
    setBusy(id)
    try {
      const res = await fetch(`/api/admin/sessions/occurrence/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      router.refresh()
    } catch {
      toast.error("Could not update the session")
    } finally {
      setBusy(null)
    }
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">No sessions scheduled in this range.</p>
      </div>
    )
  }

  // Group by date (input is already ordered by date then time).
  const groups: { date: string; items: AgendaSession[] }[] = []
  for (const s of sessions) {
    const last = groups[groups.length - 1]
    if (last && last.date === s.session_date) last.items.push(s)
    else groups.push({ date: s.session_date, items: [s] })
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.date}>
          <h2 className="mb-2 text-sm font-semibold text-foreground">{fmtDate(g.date)}</h2>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-white shadow-sm">
            {g.items.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{s.clientName}</p>
                  <p className="text-xs text-muted-foreground">{fmtTime(s.start_time)}</p>
                </div>
                {s.status === "scheduled" ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="sm" variant="outline" disabled={busy === s.id} onClick={() => act(s.id, { action: "attended" })}>
                      <Check className="size-4" /> Attended
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy === s.id} onClick={() => act(s.id, { action: "no_show" })}>
                      <X className="size-4" /> No-show
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy === s.id} onClick={() => act(s.id, { action: "cancel" })}>
                      <Ban className="size-4" /> Cancel
                    </Button>
                  </div>
                ) : (
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_CHIP[s.status] ?? ""}`}>
                    {s.status.replace("_", " ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
