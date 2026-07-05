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
  assignments,
  bare = false,
}: {
  clientUserId: string
  slots: RecurringSession[]
  /** Client's active program assignments — enables the per-slot "Advances program" link. */
  assignments?: { id: string; label: string }[]
  bare?: boolean
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

  async function link(id: string, assignmentId: string | null) {
    const prev = slots
    setSlots((s) => s.map((x) => (x.id === id ? { ...x, assignment_id: assignmentId } : x)))
    try {
      const res = await fetch(`/api/admin/sessions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignmentId }),
      })
      if (!res.ok) throw new Error()
      router.refresh()
    } catch {
      setSlots(prev)
      toast.error("Could not update the program link")
    }
  }

  return (
    <div className={bare ? "" : "rounded-xl border border-border bg-white p-6"}>
      <div className="mb-4 flex items-center gap-2">
        <CalendarClock className="size-5 text-primary" strokeWidth={1.5} />
        <h3 className="font-medium text-foreground">Standing sessions</h3>
      </div>

      {slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">No standing sessions yet.</p>
      ) : (
        <ul className="mb-4 divide-y divide-border">
          {slots.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="text-foreground">
                {DAYS[s.day_of_week]} · {s.start_time.slice(0, 5)}
                {s.status === "paused" ? " · paused" : ""}
              </span>
              <span className="flex items-center gap-1.5">
                {assignments && assignments.length > 0 && (
                  <select
                    aria-label="Advances program"
                    title="Marking this slot's session attended advances the linked program"
                    value={s.assignment_id ?? ""}
                    onChange={(e) => link(s.id, e.target.value || null)}
                    className="h-8 max-w-44 rounded-md border border-border bg-white px-2 text-xs"
                  >
                    <option value="">None</option>
                    {s.assignment_id && !assignments.some((a) => a.id === s.assignment_id) && (
                      <option value={s.assignment_id}>Linked program</option>
                    )}
                    {assignments.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                )}
                <Button variant="ghost" size="sm" onClick={() => remove(s.id)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </span>
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
