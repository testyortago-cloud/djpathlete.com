"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, X, Ban } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { ScheduledSession } from "@/types/database"

export type CalendarSession = ScheduledSession & { clientName: string }

const CHIP_STYLE: Record<string, string> = {
  scheduled: "border-primary/25 bg-primary/10 text-primary hover:bg-primary/20",
  attended: "border-success/25 bg-success/10 text-success hover:bg-success/20",
  no_show: "border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/20",
  cancelled: "border-border bg-muted text-muted-foreground line-through hover:bg-muted/70",
}

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

/**
 * One session rendered as a clickable chip (month cells) or block (week
 * time-grid). Clicking opens a dialog with the same Attended / No-show /
 * Cancel actions as the agenda list.
 */
export function SessionChip({ session, variant = "chip" }: { session: CalendarSession; variant?: "chip" | "block" }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function act(action: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/sessions/occurrence/${session.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error()
      setOpen(false)
      router.refresh()
    } catch {
      toast.error("Could not update the session")
    } finally {
      setBusy(false)
    }
  }

  const style = CHIP_STYLE[session.status] ?? CHIP_STYLE.scheduled

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "block" ? (
          <button
            type="button"
            className={`flex h-full w-full flex-col items-start overflow-hidden rounded-md border px-1.5 py-1 text-left text-xs leading-tight transition-colors ${style}`}
          >
            <span className="w-full truncate font-medium">{session.clientName}</span>
            <span className="w-full truncate opacity-80">{fmtTime(session.start_time)}</span>
          </button>
        ) : (
          <button
            type="button"
            className={`flex w-full items-baseline gap-1 overflow-hidden rounded border px-1.5 py-0.5 text-left text-xs leading-tight transition-colors ${style}`}
          >
            <span className="shrink-0 font-mono text-[10px] opacity-80">{fmtTime(session.start_time)}</span>
            <span className="truncate font-medium">{session.clientName}</span>
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{session.clientName}</DialogTitle>
          <DialogDescription>
            {fmtDate(session.session_date)} · {fmtTime(session.start_time)} · {session.duration_minutes} min
          </DialogDescription>
        </DialogHeader>
        {session.notes ? <p className="text-sm text-muted-foreground">{session.notes}</p> : null}
        {session.status === "scheduled" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act("attended")}>
              <Check className="size-4" /> Attended
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act("no_show")}>
              <X className="size-4" /> No-show
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("cancel")}>
              <Ban className="size-4" /> Cancel session
            </Button>
          </div>
        ) : (
          <span
            className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_CHIP[session.status] ?? ""}`}
          >
            {session.status.replace("_", " ")}
          </span>
        )}
      </DialogContent>
    </Dialog>
  )
}
