"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Trash2, CalendarClock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { RecurringSession } from "@/types/database"

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export function StandingSlotsPanel({
  clientUserId,
  slots: initialSlots,
}: {
  clientUserId: string
  slots: RecurringSession[]
}) {
  const router = useRouter()
  const [slots, setSlots] = useState(initialSlots)
  const [day, setDay] = useState("1")
  const [time, setTime] = useState("05:45")
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientUserId, dayOfWeek: Number(day), startTime: time, durationMinutes: 60 }),
      })
      if (!res.ok) throw new Error()
      const { slot } = await res.json()
      setSlots((s) => [...s, slot])
      toast.success("Standing session added")
      router.refresh()
    } catch {
      toast.error("Could not add the slot")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/admin/sessions/${id}`, { method: "DELETE" })
    if (!res.ok) {
      toast.error("Could not remove the slot")
      return
    }
    setSlots((s) => s.filter((x) => x.id !== id))
    router.refresh()
  }

  return (
    <div className="rounded-xl border border-border bg-white p-6">
      <div className="mb-4 flex items-center gap-2">
        <CalendarClock className="size-5 text-primary" strokeWidth={1.5} />
        <h3 className="font-medium text-foreground">Standing sessions</h3>
      </div>

      {slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">No standing sessions yet.</p>
      ) : (
        <ul className="mb-4 divide-y divide-border">
          {slots.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-foreground">
                {DAYS[s.day_of_week]} · {s.start_time.slice(0, 5)}
                {s.status === "paused" ? " · paused" : ""}
              </span>
              <Button variant="ghost" size="sm" onClick={() => remove(s.id)}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
        <select
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="h-9 rounded-md border border-border bg-white px-2 text-sm"
        >
          {DAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
        <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-9 w-32" />
        <Button size="sm" onClick={add} disabled={busy}>
          <Plus className="size-4" /> Add
        </Button>
      </div>
    </div>
  )
}
