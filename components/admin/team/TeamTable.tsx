"use client"

import { useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  type DataTableBadgeTone,
} from "@/components/ui/data-table"
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

const STATUS_TONES: Record<TeamRowStatus, DataTableBadgeTone> = {
  active: "success",
  suspended: "neutral",
  pending: "warning",
  expired: "neutral",
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

      <DataTableCard>
        <DataTable>
          <DataTableHeader>
            <DataTableHead>Person</DataTableHead>
            <DataTableHead>Access</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            <DataTableHead>Added</DataTableHead>
            <DataTableHead align="right">Actions</DataTableHead>
          </DataTableHeader>

          <tbody>
            {rows.length === 0 && (
              <DataTableEmpty colSpan={5}>
                No one on the team yet. Send an invite to get started.
              </DataTableEmpty>
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
        </DataTable>
      </DataTableCard>

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
  return (
    <DataTableRow>
      <DataTableCell>
        {row.name ? (
          <>
            <div className="font-medium text-foreground">{row.name}</div>
            <div className="text-xs text-muted-foreground">{row.email}</div>
          </>
        ) : (
          <>
            <div className="font-medium text-foreground">{row.email}</div>
            <div className="text-xs text-muted-foreground">Hasn&apos;t accepted yet</div>
          </>
        )}
      </DataTableCell>

      <DataTableCell className="max-w-xs whitespace-normal">
        <DataTableBadge tone={row.reachesAdminPanel ? "info" : "neutral"}>
          {row.roleLabel}
        </DataTableBadge>
        <p className="mt-1 text-xs text-muted-foreground">{row.accessSummary}</p>
      </DataTableCell>

      <DataTableCell>
        <DataTableBadge tone={STATUS_TONES[row.status]}>{STATUS_LABELS[row.status]}</DataTableBadge>
      </DataTableCell>

      <DataTableCell muted>{new Date(row.date).toLocaleDateString("en-US")}</DataTableCell>

      <DataTableCell align="right" className="whitespace-nowrap">
        <div className="flex justify-end gap-2">
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
        </div>
      </DataTableCell>
    </DataTableRow>
  )
}
