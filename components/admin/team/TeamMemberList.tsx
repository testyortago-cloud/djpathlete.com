"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { EditPermissionsDialog } from "./EditPermissionsDialog"
import { AssignClientsDialog } from "./AssignClientsDialog"
import { describePermissions, getPreset } from "@/lib/permissions/registry"
import type { TeamMember } from "@/lib/db/team-members"

interface ClientOption {
  id: string
  name: string
  email: string
}

export function TeamMemberList({
  initialMembers,
  clients,
}: {
  initialMembers: TeamMember[]
  clients: ClientOption[]
}) {
  const [members, setMembers] = useState(initialMembers)
  const [editing, setEditing] = useState<TeamMember | null>(null)
  const [assigning, setAssigning] = useState<TeamMember | null>(null)
  const [pending, startTransition] = useTransition()

  async function refresh() {
    const res = await fetch("/api/admin/team/members")
    if (res.ok) setMembers((await res.json()).members)
  }

  function toggleStatus(member: TeamMember) {
    const next = member.status === "suspended" ? "active" : "suspended"
    startTransition(async () => {
      const res = await fetch(`/api/admin/team/members/${member.id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      })
      if (res.ok) {
        await refresh()
        toast.success(next === "suspended" ? "Member suspended" : "Member reactivated")
      } else {
        toast.error("Failed to update member")
      }
    })
  }

  if (members.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No team members yet. Send an invite and they&apos;ll appear here once they set their password.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3">
        {members.map((member) => {
          const preset = member.staff_role ? getPreset(member.staff_role) : null
          const suspended = member.status === "suspended"

          return (
            <div
              key={member.id}
              className={cn("rounded-lg border p-4", suspended && "bg-muted/40 opacity-75")}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">
                      {member.first_name} {member.last_name}
                    </p>
                    {preset && (
                      <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-foreground">
                        {preset.label}
                      </span>
                    )}
                    {suspended && (
                      <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Suspended
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{member.email}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(member)}>
                    Edit permissions
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAssigning(member)}>
                    Assign clients ({member.assigned_client_count})
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggleStatus(member)}>
                    {suspended ? "Reactivate" : "Suspend"}
                  </Button>
                </div>
              </div>

              <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                {describePermissions(member.permissions)}
              </p>
            </div>
          )
        })}
      </div>

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
    </>
  )
}
