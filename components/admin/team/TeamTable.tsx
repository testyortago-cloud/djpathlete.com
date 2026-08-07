"use client"

import { useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { InviteFormDialog } from "./InviteFormDialog"
import { EditPermissionsDialog } from "./EditPermissionsDialog"
import { AssignClientsDialog } from "./AssignClientsDialog"
import { buildTeamRows, type TeamRow, type TeamRowStatus } from "@/lib/team/rows"
import type { TeamMember } from "@/lib/db/team-members"
import type { TeamInvite } from "@/types/database"

interface ClientOption {
  id: string
  name: string
  email: string
}

const STATUS_STYLES: Record<TeamRowStatus, string> = {
  active: "bg-success/10 text-success border-success/30",
  suspended: "bg-muted text-muted-foreground border-border",
  pending: "bg-warning/10 text-warning border-warning/30",
  expired: "bg-muted text-muted-foreground border-border",
}

const STATUS_LABELS: Record<TeamRowStatus, string> = {
  active: "Active",
  suspended: "Suspended",
  pending: "Invite pending",
  expired: "Invite expired",
}

/**
 * Everyone on the team in one table — people who have accepted, people who
 * haven't yet, and video editors alike.
 *
 * Splitting these across two tables meant an invite and the member it became
 * were rendered by different components with different controls, and editors
 * had no controls at all. One table, one row shape, one set of actions.
 */
export function TeamTable({
  initialMembers,
  initialInvites,
  clients,
}: {
  initialMembers: TeamMember[]
  initialInvites: TeamInvite[]
  clients: ClientOption[]
}) {
  const [members, setMembers] = useState(initialMembers)
  const [invites, setInvites] = useState(initialInvites)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editing, setEditing] = useState<TeamMember | null>(null)
  const [assigning, setAssigning] = useState<TeamMember | null>(null)
  const [pending, startTransition] = useTransition()

  const rows = useMemo(() => buildTeamRows(members, invites), [members, invites])

  async function refresh() {
    const [memberRes, inviteRes] = await Promise.all([
      fetch("/api/admin/team/members"),
      fetch("/api/admin/team/invites"),
    ])
    if (memberRes.ok) setMembers((await memberRes.json()).members)
    if (inviteRes.ok) setInvites((await inviteRes.json()).invites)
  }

  /** Every mutation refreshes both lists: accepting an invite moves a row between them. */
  function run(request: () => Promise<Response>, okMessage: string, failMessage: string) {
    startTransition(async () => {
      const res = await request()
      if (res.ok) {
        await refresh()
        toast.success(okMessage)
      } else {
        toast.error(failMessage)
      }
    })
  }

  function toggleStatus(member: TeamMember) {
    const next = member.status === "suspended" ? "active" : "suspended"
    run(
      () =>
        fetch(`/api/admin/team/members/${member.id}/status`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: next }),
        }),
      next === "suspended" ? "Member suspended" : "Member reactivated",
      "Failed to update member",
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setInviteOpen(true)}>Invite member</Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Person</th>
              <th className="px-4 py-2 font-medium">Access</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Added</th>
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-muted-foreground" colSpan={5}>
                  No one on the team yet. Send an invite to get started.
                </td>
              </tr>
            )}

            {rows.map((row) => (
              <TeamRowCells
                key={row.key}
                row={row}
                pending={pending}
                onEdit={setEditing}
                onAssign={setAssigning}
                onToggleStatus={toggleStatus}
                onResend={(id) =>
                  run(
                    () => fetch(`/api/admin/team/invites/${id}/resend`, { method: "POST" }),
                    "Invite re-sent",
                    "Failed to resend invite",
                  )
                }
                onRevoke={(id) =>
                  run(
                    () => fetch(`/api/admin/team/invites/${id}/revoke`, { method: "POST" }),
                    "Invite revoked",
                    "Failed to revoke invite",
                  )
                }
              />
            ))}
          </tbody>
        </table>
      </div>

      <InviteFormDialog open={inviteOpen} onOpenChange={setInviteOpen} onCreated={refresh} />

      {editing && (
        <EditPermissionsDialog
          member={editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={async () => {
            await refresh()
            setEditing(null)
          }}
        />
      )}

      {assigning && (
        <AssignClientsDialog
          member={assigning}
          clients={clients}
          open
          onOpenChange={(open) => !open && setAssigning(null)}
          onSaved={async () => {
            await refresh()
            setAssigning(null)
          }}
        />
      )}
    </div>
  )
}

function TeamRowCells({
  row,
  pending,
  onEdit,
  onAssign,
  onToggleStatus,
  onResend,
  onRevoke,
}: {
  row: TeamRow
  pending: boolean
  onEdit: (member: TeamMember) => void
  onAssign: (member: TeamMember) => void
  onToggleStatus: (member: TeamMember) => void
  onResend: (id: string) => void
  onRevoke: (id: string) => void
}) {
  const dimmed = row.status === "suspended" || row.status === "expired"

  return (
    <tr className={cn("border-b last:border-0 align-top", dimmed && "bg-muted/30")}>
      <td className="px-4 py-3">
        {row.name ? (
          <>
            <div className="font-medium">{row.name}</div>
            <div className="text-xs text-muted-foreground">{row.email}</div>
          </>
        ) : (
          <>
            <div className="font-medium">{row.email}</div>
            <div className="text-xs text-muted-foreground">Hasn&apos;t accepted yet</div>
          </>
        )}
      </td>

      <td className="max-w-xs px-4 py-3">
        <span
          className={cn(
            "inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            row.reachesAdminPanel
              ? "border-accent/30 bg-accent/10 text-accent-foreground"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          {row.roleLabel}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">{row.accessSummary}</p>
      </td>

      <td className="px-4 py-3">
        <span className={cn("rounded-full border px-2 py-0.5 text-xs", STATUS_STYLES[row.status])}>
          {STATUS_LABELS[row.status]}
        </span>
      </td>

      <td className="px-4 py-3 text-muted-foreground">
        {new Date(row.date).toLocaleDateString("en-US")}
      </td>

      <td className="space-x-2 whitespace-nowrap px-4 py-3 text-right">
        {row.member && (
          <>
            <Button size="sm" variant="outline" onClick={() => onEdit(row.member!)}>
              Edit access
            </Button>
            {/* Assignments scope the client list, which an editor never sees. */}
            {row.reachesAdminPanel && (
              <Button size="sm" variant="outline" onClick={() => onAssign(row.member!)}>
                Clients ({row.member.assigned_client_count})
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => onToggleStatus(row.member!)}
            >
              {row.status === "suspended" ? "Reactivate" : "Suspend"}
            </Button>
          </>
        )}

        {row.invite && (
          <>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => onResend(row.id)}>
              Resend
            </Button>
            {row.status === "pending" && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => onRevoke(row.id)}>
                Revoke
              </Button>
            )}
          </>
        )}
      </td>
    </tr>
  )
}
