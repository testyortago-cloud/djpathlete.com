"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { InviteFormDialog } from "./InviteFormDialog"
import { inviteStatus } from "@/lib/db/team-invites"
import type { TeamInvite, TeamInviteStatus } from "@/types/database"

const STATUS_STYLES: Record<TeamInviteStatus, string> = {
  pending: "bg-warning/10 text-warning border-warning/30",
  accepted: "bg-success/10 text-success border-success/30",
  expired: "bg-muted text-muted-foreground border-border",
}

export function InviteList({ initialInvites }: { initialInvites: TeamInvite[] }) {
  const [invites, setInvites] = useState(initialInvites)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  async function refresh() {
    const res = await fetch("/api/admin/team/invites")
    if (res.ok) {
      const json = await res.json()
      setInvites(json.invites)
    }
  }

  function revoke(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/admin/team/invites/${id}/revoke`, { method: "POST" })
      if (res.ok) {
        toast.success("Invite revoked")
        refresh()
      } else toast.error("Failed to revoke invite")
    })
  }

  function resend(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/admin/team/invites/${id}/resend`, { method: "POST" })
      if (res.ok) {
        toast.success("Invite re-sent")
        refresh()
      } else toast.error("Failed to resend invite")
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialogOpen(true)}>Invite member</Button>
      </div>

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Sent</th>
              <th className="px-4 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invites.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-muted-foreground" colSpan={5}>
                  No invites yet. Click &quot;Invite member&quot; to send the first one.
                </td>
              </tr>
            )}
            {invites.map((inv) => {
              const status = inviteStatus(inv)
              return (
                <tr key={inv.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-mono">{inv.email}</td>
                  <td className="px-4 py-3 capitalize">{inv.role}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLES[status]}`}>
                      {status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(inv.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => resend(inv.id)}
                        >
                          Resend
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => revoke(inv.id)}
                        >
                          Revoke
                        </Button>
                      </>
                    )}
                    {status === "expired" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => resend(inv.id)}
                      >
                        Resend
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <InviteFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={refresh}
      />
    </div>
  )
}
