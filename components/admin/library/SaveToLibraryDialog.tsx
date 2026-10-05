"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Program, ProgramFolder } from "@/types/database"

const NEW_FOLDER = "__new__"

interface SaveToLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  program: Program | null
}

export function SaveToLibraryDialog({ open, onOpenChange, program }: SaveToLibraryDialogProps) {
  const router = useRouter()
  const [folders, setFolders] = useState<ProgramFolder[] | null>(null)
  const [folderId, setFolderId] = useState("")
  const [newFolder, setNewFolder] = useState("")
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(program?.name ?? "")
    setNewFolder("")
    setFolders(null)
    fetch("/api/admin/programs/folders")
      .then((r) => (r.ok ? r.json() : { folders: [] }))
      .then((d: { folders?: ProgramFolder[] }) => {
        const list = d.folders ?? []
        setFolders(list)
        setFolderId(list[0]?.id ?? NEW_FOLDER)
      })
      .catch(() => {
        setFolders([])
        setFolderId(NEW_FOLDER)
      })
  }, [open, program])

  async function submit() {
    if (!program) return
    setSaving(true)
    try {
      let target = folderId
      if (folderId === NEW_FOLDER) {
        const res = await fetch("/api/admin/programs/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newFolder }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(body.error ?? "Couldn't create the folder.")
          return
        }
        target = body.folder.id
        // Keep it selected so a retry after a failed save does not POST the folder again (409).
        setFolders((fs) => [...(fs ?? []), body.folder])
        setFolderId(body.folder.id)
      }
      const res = await fetch(`/api/admin/programs/${program.id}/save-to-library`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: target, name: name.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't save to the library.")
        return
      }
      toast.success("Saved to your library")
      onOpenChange(false)
      router.push(`/admin/programs?tab=library&folder=${target}`)
    } finally {
      setSaving(false)
    }
  }

  const needsNewName = folderId === NEW_FOLDER && newFolder.trim().length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save to library</DialogTitle>
          <DialogDescription>
            A copy goes into your library, ready to give to new clients. This program and anyone on it are not changed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="save-folder">Folder</Label>
            <select
              id="save-folder"
              value={folderId}
              disabled={folders == null}
              onChange={(e) => setFolderId(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground"
            >
              {(folders ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
              <option value={NEW_FOLDER}>+ New folder…</option>
            </select>
            {folderId === NEW_FOLDER && (
              <Input
                aria-label="New folder name"
                placeholder="e.g. 12-week strength"
                maxLength={80}
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="save-name">Name in the library</Label>
            <Input id="save-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || folders == null || needsNewName || name.trim().length === 0}>
            {saving ? "Saving..." : "Save to library"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
