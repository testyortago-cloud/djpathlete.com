"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import type { EventSignup } from "@/types/database"

interface SignupsTableProps {
  initialSignups: EventSignup[]
  eventId: string
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  confirmed: "bg-success/15 text-success",
  cancelled: "bg-destructive/15 text-destructive",
  refunded: "bg-destructive/10 text-destructive",
}

export function SignupsTable({ initialSignups, eventId }: SignupsTableProps) {
  const [signups, setSignups] = useState(initialSignups)
  const [pending, setPending] = useState<Record<string, boolean>>({})

  async function act(signupId: string, action: "confirm" | "cancel") {
    if (action === "cancel" && !confirm("Cancel this signup?")) return

    setPending((p) => ({ ...p, [signupId]: true }))

    // Optimistic update
    const previous = signups
    setSignups((prev) =>
      prev.map((s) =>
        s.id === signupId
          ? { ...s, status: action === "confirm" ? "confirmed" : "cancelled" }
          : s,
      ),
    )

    try {
      const res = await fetch(`/api/admin/events/${eventId}/signups/${signupId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSignups(previous) // rollback
        toast.error(data.error ?? `Failed to ${action} signup`)
        return
      }
      setSignups((prev) => prev.map((s) => (s.id === signupId ? data.signup : s)))
      toast.success(`Signup ${action === "confirm" ? "confirmed" : "cancelled"}`)
    } catch (err) {
      setSignups(previous)
      toast.error((err as Error).message)
    } finally {
      setPending((p) => ({ ...p, [signupId]: false }))
    }
  }

  if (signups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
        <p className="font-medium">No signups yet</p>
        <p className="text-sm text-muted-foreground">Public signups will appear here.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Athlete</th>
            <th className="px-4 py-3">Age</th>
            <th className="px-4 py-3">Parent</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Phone</th>
            <th className="px-4 py-3">Sport</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {signups.map((s) => (
            <tr key={s.id} className="border-t border-border align-top">
              <td className="px-4 py-3">
                <div className="font-medium">{s.athlete_name}</div>
                {s.notes && (
                  <div className="mt-1 text-xs text-muted-foreground">{s.notes}</div>
                )}
              </td>
              <td className="px-4 py-3">{s.athlete_age}</td>
              <td className="px-4 py-3">{s.parent_name}</td>
              <td className="px-4 py-3">{s.parent_email}</td>
              <td className="px-4 py-3">{s.parent_phone ?? "—"}</td>
              <td className="px-4 py-3">{s.sport ?? "—"}</td>
              <td className="px-4 py-3 capitalize">{s.signup_type}</td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s.status] ?? ""}`}>
                  {s.status}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex justify-end gap-2">
                  {s.status === "pending" && (
                    <Button size="sm" disabled={pending[s.id]} onClick={() => act(s.id, "confirm")}>
                      Confirm
                    </Button>
                  )}
                  {(s.status === "pending" || s.status === "confirmed") && (
                    <Button size="sm" variant="outline" disabled={pending[s.id]} onClick={() => act(s.id, "cancel")}>
                      Cancel
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
