"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { ProgramFolder } from "@/types/database"

interface FolderNameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Rename this folder; omit to create a new one. */
  folder?: ProgramFolder | null
  onSaved?: (folder: ProgramFolder) => void
}

export function FolderNameDialog({ open, onOpenChange, folder, onSaved }: FolderNameDialogProps) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setName(folder?.name ?? "")
  }, [open, folder])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch(folder ? `/api/admin/programs/folders/${folder.id}` : "/api/admin/programs/folders", {
        method: folder ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't save the folder.")
        return
      }
      toast.success(folder ? "Folder renamed" : "Folder created")
      onSaved?.(body.folder)
      onOpenChange(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{folder ? "Rename folder" : "New folder"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="folder-name">Folder name</Label>
            <Input
              id="folder-name"
              value={name}
              maxLength={80}
              placeholder="e.g. 12-week strength"
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || name.trim().length === 0}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
