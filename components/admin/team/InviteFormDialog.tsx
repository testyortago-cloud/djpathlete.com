"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { PermissionPicker } from "./PermissionPicker"
import { PRESETS, getPreset, type PermissionMap } from "@/lib/permissions/registry"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

const DEFAULT_PRESET = "coach"

export function InviteFormDialog({ open, onOpenChange, onCreated }: Props) {
  const [email, setEmail] = useState("")
  const [presetKey, setPresetKey] = useState(DEFAULT_PRESET)
  const [permissions, setPermissions] = useState<PermissionMap>(
    () => ({ ...(getPreset(DEFAULT_PRESET)?.permissions ?? {}) }),
  )
  const [submitting, setSubmitting] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

  const preset = getPreset(presetKey)
  const isEditorInvite = preset?.invitedRole === "editor"

  /**
   * A preset is a starting template, not a binding — picking one refills the
   * checkboxes, and anything ticked after that is what actually gets stored.
   */
  function choosePreset(key: string) {
    setPresetKey(key)
    setPermissions({ ...(getPreset(key)?.permissions ?? {}) })
  }

  function reset() {
    setEmail("")
    setPresetKey(DEFAULT_PRESET)
    setPermissions({ ...(getPreset(DEFAULT_PRESET)?.permissions ?? {}) })
    setEmailError(null)
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
      const res = await fetch("/api/admin/team/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          role: isEditorInvite ? "editor" : "staff",
          staffRole: presetKey,
          permissions: isEditorInvite ? {} : permissions,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error ?? "Failed to send invite")
        return
      }
      toast.success(`Invite sent to ${trimmed}`)
      reset()
      onCreated()
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            They&apos;ll get an email with a link to set their password. The link expires in 7 days.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? "invite-email-error" : undefined}
            />
            {emailError && (
              <p id="invite-email-error" className="text-xs text-error">
                {emailError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-preset">Role</Label>
            <select
              id="invite-preset"
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

          {isEditorInvite ? (
            <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              Video editors get the <span className="font-medium">/editor</span> portal only — they upload
              videos and read your feedback. They never see the admin panel, so there&apos;s nothing to
              configure here.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">Permissions</p>
              <p className="text-xs text-muted-foreground">
                Filled in from the role above. Tick or untick anything before sending.
              </p>
              <PermissionPicker value={permissions} onChange={setPermissions} disabled={submitting} />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Sending..." : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
