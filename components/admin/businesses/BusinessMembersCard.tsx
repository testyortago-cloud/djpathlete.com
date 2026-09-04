"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableToolbar,
  type DataTableBadgeTone,
} from "@/components/ui/data-table"
import { PermissionPicker } from "@/components/admin/team/PermissionPicker"
import { AccessOutcomeNote } from "@/components/admin/team/AccessOutcomeNote"
import { PRESETS, getPreset, type PermissionMap } from "@/lib/permissions/registry"
import type { BusinessMember, BusinessMemberRole } from "@/lib/db/business-members"

const ROLE_LABELS: Record<BusinessMemberRole, string> = {
  owner: "Owner",
  coach: "Coach",
  staff: "Staff",
}

const ROLE_TONES: Record<BusinessMemberRole, DataTableBadgeTone> = {
  owner: "info",
  coach: "success",
  staff: "neutral",
}

const BUSINESS_ROLE_OPTIONS: { value: BusinessMemberRole; label: string; description: string }[] = [
  { value: "coach", label: "Coach", description: "Whose calendar the bookings land on." },
  { value: "staff", label: "Staff", description: "Works in this business, isn't a host." },
  { value: "owner", label: "Owner", description: "Full access to this business." },
]

const DEFAULT_PRESET = "coach"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
}

function memberName(m: BusinessMember): string {
  return `${m.first_name} ${m.last_name}`.trim() || m.email
}

/**
 * Invite a coach into this business. A separate control from `/admin/team`'s
 * invite dialog: that one names no business at all, and grants a PLATFORM
 * role (staff | editor) derived from permissions. This one ALSO names a
 * `businessRole` -- what `business_members.role` the accept path grants --
 * which is a different axis from the permission checkboxes below it.
 */
function InviteCoachDialog({
  businessId,
  open,
  onOpenChange,
  onInvited,
}: {
  businessId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onInvited: () => void
}) {
  const [email, setEmail] = useState("")
  const [businessRole, setBusinessRole] = useState<BusinessMemberRole>("coach")
  const [presetKey, setPresetKey] = useState(DEFAULT_PRESET)
  const [permissions, setPermissions] = useState<PermissionMap>(
    () => ({ ...(getPreset(DEFAULT_PRESET)?.permissions ?? {}) }),
  )
  const [submitting, setSubmitting] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const preset = getPreset(presetKey)

  function choosePreset(key: string) {
    setPresetKey(key)
    setPermissions({ ...(getPreset(key)?.permissions ?? {}) })
  }

  function reset() {
    setEmail("")
    setBusinessRole("coach")
    setPresetKey(DEFAULT_PRESET)
    setPermissions({ ...(getPreset(DEFAULT_PRESET)?.permissions ?? {}) })
    setEmailError(null)
    setInviteLink(null)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setEmailError("Enter a valid email address")
      return
    }
    setEmailError(null)
    setSubmitting(true)

    try {
      const res = await fetch(`/api/admin/businesses/${businessId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: trimmed, businessRole, permissions }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error ?? "Failed to send invite")
        return
      }
      const json = await res.json()
      setInviteLink(`${window.location.origin}/invite/${json.invite.token}`)
      toast.success(`Invite created for ${trimmed}`)
      onInvited()
    } finally {
      setSubmitting(false)
    }
  }

  function close(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a coach</DialogTitle>
          <DialogDescription>They&apos;ll get a link that works for 7 days.</DialogDescription>
        </DialogHeader>

        {inviteLink ? (
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              Send this link to <span className="font-medium">{email.trim()}</span>. It works for 7 days.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={inviteLink} onFocus={(e) => e.currentTarget.select()} />
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(inviteLink)
                  toast.success("Link copied")
                }}
              >
                Copy
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => close(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="member-invite-email">Email</Label>
              <Input
                id="member-invite-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!emailError}
                aria-describedby={emailError ? "member-invite-email-error" : undefined}
              />
              {emailError && (
                <p id="member-invite-email-error" className="text-xs text-error">
                  {emailError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="member-invite-business-role">Role in this business</Label>
              <select
                id="member-invite-business-role"
                value={businessRole}
                onChange={(e) => setBusinessRole(e.target.value as BusinessMemberRole)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {BUSINESS_ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {BUSINESS_ROLE_OPTIONS.find((o) => o.value === businessRole)?.description}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="member-invite-preset">Admin panel access</Label>
              <select
                id="member-invite-preset"
                value={presetKey}
                onChange={(e) => choosePreset(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              {preset && <p className="text-xs text-muted-foreground">{preset.description}</p>}
            </div>

            <AccessOutcomeNote permissions={permissions} />

            <div className="space-y-2">
              <p className="text-sm font-medium">Permissions</p>
              <p className="text-xs text-muted-foreground">
                Filled in from the access level above. Tick or untick anything before sending.
              </p>
              <PermissionPicker value={permissions} onChange={setPermissions} disabled={submitting} />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Sending..." : "Send invite"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RemoveMemberButton({
  businessId,
  member,
  onRemoved,
}: {
  businessId: string
  member: BusinessMember
  onRemoved: (userId: string) => void
}) {
  const [removing, setRemoving] = useState(false)

  async function handleRemove() {
    setRemoving(true)
    try {
      const res = await fetch(`/api/admin/businesses/${businessId}/members`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: member.user_id }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error ?? "Failed to remove")
        return
      }
      toast.success(`Removed ${memberName(member)}`)
      onRemoved(member.user_id)
    } finally {
      setRemoving(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
          Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {memberName(member)} from this business?</AlertDialogTitle>
          <AlertDialogDescription>
            They lose access to this business&apos;s clients, pipeline and bookings. Their account itself is
            not deleted -- they may still belong to another business.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRemove}
            disabled={removing}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {removing ? "Removing..." : "Remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function BusinessMembersCard({
  businessId,
  initialMembers,
}: {
  businessId: string
  initialMembers: BusinessMember[]
}) {
  const [members, setMembers] = useState(initialMembers)
  const [inviteOpen, setInviteOpen] = useState(false)

  return (
    <div className="space-y-3">
      <header>
        <h2 className="font-heading text-lg text-primary">Members</h2>
        <p className="font-body text-sm text-muted-foreground">
          Who can work on this business in the admin panel.
        </p>
      </header>

      <DataTableCard>
        <DataTableToolbar className="justify-end">
          <Button onClick={() => setInviteOpen(true)}>Invite a coach</Button>
        </DataTableToolbar>
        <DataTable>
          <DataTableHeader>
            <DataTableHead>Name</DataTableHead>
            <DataTableHead>Email</DataTableHead>
            <DataTableHead>Role</DataTableHead>
            <DataTableHead>Added</DataTableHead>
            <DataTableHead align="right">Actions</DataTableHead>
          </DataTableHeader>
          <tbody>
            {members.map((m) => (
              <DataTableRow key={m.user_id}>
                <DataTableCell>{memberName(m)}</DataTableCell>
                <DataTableCell muted>{m.email}</DataTableCell>
                <DataTableCell>
                  <DataTableBadge tone={ROLE_TONES[m.role]}>{ROLE_LABELS[m.role]}</DataTableBadge>
                </DataTableCell>
                <DataTableCell muted>{formatDate(m.created_at)}</DataTableCell>
                <DataTableCell align="right">
                  <RemoveMemberButton
                    businessId={businessId}
                    member={m}
                    onRemoved={(userId) => setMembers((cur) => cur.filter((x) => x.user_id !== userId))}
                  />
                </DataTableCell>
              </DataTableRow>
            ))}
            {members.length === 0 && (
              <DataTableEmpty colSpan={5}>No members yet. Invite a coach to get started.</DataTableEmpty>
            )}
          </tbody>
        </DataTable>
      </DataTableCard>

      <InviteCoachDialog
        businessId={businessId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={() => {
          // Membership is granted on ACCEPT, not on invite -- the list is
          // unchanged until then, so there is nothing to refetch here.
        }}
      />
    </div>
  )
}
