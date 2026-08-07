"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { PermissionPicker } from "./PermissionPicker"
import { AccessOutcomeNote } from "./AccessOutcomeNote"
import { PRESETS, getPreset, type PermissionMap } from "@/lib/permissions/registry"
import type { TeamMember } from "@/lib/db/team-members"

interface Props {
  member: TeamMember
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void | Promise<void>
}

/**
 * Every member is editable here, video editors included: "Video Editor" is one
 * of the presets rather than a separate kind of person, so the way to give an
 * editor admin access is to tick what they should reach, and the way to take it
 * away is to untick everything.
 */
export function EditPermissionsDialog({ member, open, onOpenChange, onSaved }: Props) {
  const [permissions, setPermissions] = useState<PermissionMap>({ ...member.permissions })
  // An editor has no stored preset, so fall back to the one that describes them.
  const [presetKey, setPresetKey] = useState(
    member.staff_role ?? (member.role === "editor" ? "editor" : "custom"),
  )
  const [saving, setSaving] = useState(false)

  function choosePreset(key: string) {
    setPresetKey(key)
    // "Custom" is a label for a hand-picked set, so selecting it must not wipe
    // what is already ticked.
    if (key !== "custom") setPermissions({ ...(getPreset(key)?.permissions ?? {}) })
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/team/members/${member.id}/permissions`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permissions, staffRole: presetKey }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error ?? "Failed to update permissions")
        return
      }
      toast.success(`Updated ${member.first_name}'s access`)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {member.first_name} {member.last_name}
          </DialogTitle>
          <DialogDescription>
            Changes take effect on their next page load — they don&apos;t need to sign out and back in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="edit-preset">Start from a role</Label>
            <select
              id="edit-preset"
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
          </div>

          <AccessOutcomeNote permissions={permissions} />

          <PermissionPicker value={permissions} onChange={setPermissions} disabled={saving} />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save permissions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
