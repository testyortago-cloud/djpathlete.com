"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Ticket, Plus, Undo2, Link2, Trash2, BadgeCheck, Mail, UserPen } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { SellPackDialog } from "./SellPackDialog"
import type { ClientPackage } from "@/types/database"
import type { PackWithCheckins } from "@/lib/services/client-packs-view"

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

export function ClientPackagesPanel({
  clientUserId,
  initialPacks,
  bare = false,
}: {
  clientUserId: string
  initialPacks: PackWithCheckins[]
  bare?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PackWithCheckins | null>(null)
  const packages = initialPacks

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
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function copyPaymentLink(packId: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/session-packs/${packId}/payment-link`, { method: "POST" })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.url) {
        toast.error(d.error ?? "Could not get payment link")
        return
      }
      try {
        await navigator.clipboard.writeText(d.url as string)
        toast.success(
          d.refreshed
            ? "New payment link copied — the old one had expired. Send it to the client."
            : "Payment link copied — send it to the client.",
        )
      } catch {
        // Clipboard can be blocked (non-HTTPS/permissions) — show the link instead.
        window.prompt("Copy the payment link:", d.url as string)
      }
    } catch {
      toast.error("Network error — could not get the payment link")
    } finally {
      setBusy(false)
    }
  }

  async function emailPaymentLink(packId: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/session-packs/${packId}/email-link`, { method: "POST" })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error ?? "Could not email the payment link")
        return
      }
      toast.success(`Payment link emailed to ${d.sentTo}`)
      router.refresh()
    } catch {
      toast.error("Network error — the link was not emailed")
    } finally {
      setBusy(false)
    }
  }

  async function changeBillTo(packId: string, current: string | null) {
    const next = window.prompt(
      "Email the payment link should be addressed to (leave blank to bill the client). This re-issues the link, so the old one stops working.",
      current ?? "",
    )
    if (next === null) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/session-packs/${packId}/bill-to`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ billToEmail: next.trim() || null }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error ?? "Could not change the billing email")
        return
      }
      toast.success(next.trim() ? `Now billed to ${next.trim()}` : "Now billed to the client")
      router.refresh()
    } catch {
      toast.error("Network error — the billing email was not changed")
    } finally {
      setBusy(false)
    }
  }

  async function markPaid(packId: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/session-packs/${packId}/mark-paid`, { method: "POST" })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error ?? "Could not mark paid")
        return
      }
      toast.success("Pack marked paid")
      router.refresh()
    } catch {
      toast.error("Network error — pack not updated")
    } finally {
      setBusy(false)
    }
  }

  async function deletePack(packId: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/session-packs/${packId}`, { method: "DELETE" })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error ?? "Could not delete pack")
        return
      }
      toast.success("Pack deleted")
      setDeleteTarget(null)
      router.refresh()
    } catch {
      toast.error("Network error — pack not deleted")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={bare ? "" : "bg-white rounded-xl border border-border p-6"}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-primary flex items-center gap-2">
          <Ticket className="size-5" strokeWidth={1.5} />
          Session Packs
        </h2>
        <SellPackDialog
          clientUserId={clientUserId}
          onSold={() => router.refresh()}
          trigger={
            <Button size="sm" variant="outline">
              <Plus className="size-4" />
              Sell pack
            </Button>
          }
        />
      </div>

      {packages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No packs yet. Sell a pack below — once it&apos;s active, a Check in button appears at the top of this page.
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
                    {p.payment_status === "pending" &&
                      (p.payment_method === "stripe" ? (
                        <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-warning/10 text-warning">
                          awaiting payment
                        </span>
                      ) : (
                        <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-error/10 text-error">
                          owes payment
                        </span>
                      ))}
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
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-2xl font-semibold text-primary">
                      {remaining(p)}
                      <span className="text-sm text-muted-foreground font-normal"> / {p.credits_total}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">sessions left</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-muted-foreground hover:text-error"
                    onClick={() => setDeleteTarget(p)}
                    disabled={busy}
                    aria-label="Delete pack"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>

              {p.payment_method === "stripe" && p.payment_status === "pending" && (
                <div className="mt-3">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => copyPaymentLink(p.id)} disabled={busy}>
                      <Link2 className="size-3.5" />
                      Copy payment link
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => emailPaymentLink(p.id)} disabled={busy}>
                      <Mail className="size-3.5" />
                      Email link
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => changeBillTo(p.id, p.bill_to_email)} disabled={busy}>
                      <UserPen className="size-3.5" />
                      Change billing email
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => markPaid(p.id)} disabled={busy}>
                      <BadgeCheck className="size-3.5" />
                      Mark paid (received offline)
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Billed to{" "}
                    <span className="text-foreground">{p.bill_to_email ?? "the client's billing contact"}</span>
                    {p.bill_to_emailed_at ? ` · link emailed ${fmtDate(p.bill_to_emailed_at)}` : ""}. The pack shows as
                    paid automatically once they pay, or mark it paid yourself if the money came another way.
                  </p>
                </div>
              )}

              {p.payment_method !== "stripe" && p.payment_status === "pending" && (
                <div className="mt-3">
                  <Button size="sm" variant="outline" onClick={() => markPaid(p.id)} disabled={busy}>
                    <BadgeCheck className="size-3.5" />
                    Mark paid
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Sessions still work — tap this when the Venmo/cash actually arrives so the debt stops showing.
                  </p>
                </div>
              )}

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

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pack?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  {deleteTarget.session_type} — {remaining(deleteTarget)}/{deleteTarget.credits_total} sessions left.
                  {deleteTarget.checkins.some((c) => !c.voided)
                    ? " Its check-in history is deleted with it."
                    : ""}
                  {deleteTarget.payment_status === "paid"
                    ? " This pack was PAID — deleting removes the purchase record from this page (the Stripe payment itself is untouched; refund separately in Stripe if needed)."
                    : " Any unpaid payment link for this pack stops working."}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep pack</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                if (deleteTarget) void deletePack(deleteTarget.id)
              }}
              disabled={busy}
              variant="destructive"
            >
              Delete pack
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
