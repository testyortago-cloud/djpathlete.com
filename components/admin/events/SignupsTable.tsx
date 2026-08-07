"use client"
import {
  DataTable,
  DataTableCard,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table"

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
      prev.map((s) => (s.id === signupId ? { ...s, status: action === "confirm" ? "confirmed" : "cancelled" } : s)),
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
    <DataTableCard>
      <DataTable>
        <DataTableHeader>
          <DataTableHead>Athlete</DataTableHead>
          <DataTableHead>Age</DataTableHead>
          <DataTableHead>Parent</DataTableHead>
          <DataTableHead>Email</DataTableHead>
          <DataTableHead>Phone</DataTableHead>
          <DataTableHead>Sport</DataTableHead>
          <DataTableHead>Type</DataTableHead>
          <DataTableHead>Status</DataTableHead>
          <DataTableHead align="right">Actions</DataTableHead>
        </DataTableHeader>
        <tbody>
          {signups.map((s) => (
            <DataTableRow key={s.id} className="align-top">
              <DataTableCell>
                <div className="font-medium">{s.athlete_name}</div>
                {s.notes && <div className="mt-1 text-xs text-muted-foreground">{s.notes}</div>}
              </DataTableCell>
              <DataTableCell>{s.athlete_age}</DataTableCell>
              <DataTableCell>{s.parent_name}</DataTableCell>
              <DataTableCell>{s.parent_email}</DataTableCell>
              <DataTableCell>{s.parent_phone ?? "—"}</DataTableCell>
              <DataTableCell>{s.sport ?? "—"}</DataTableCell>
              <DataTableCell className="capitalize">{s.signup_type}</DataTableCell>
              <DataTableCell>
                <div className="flex flex-col gap-1">
                  <span
                    className={`inline-block w-fit rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s.status] ?? ""}`}
                  >
                    {s.status}
                  </span>
                  {s.signup_type === "paid" && (
                    <span className="inline-block w-fit rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                      Paid
                    </span>
                  )}
                  {s.stripe_payment_intent_id && (
                    <a
                      href={`https://dashboard.stripe.com/payments/${s.stripe_payment_intent_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-primary"
                      title="Open in Stripe dashboard"
                    >
                      {s.stripe_payment_intent_id.slice(-8)}
                    </a>
                  )}
                </div>
              </DataTableCell>
              <DataTableCell align="right">
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
              </DataTableCell>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>
    </DataTableCard>
  )
}
