"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Copy,
  Folder,
  FolderInput,
  FolderPlus,
  Library,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DataTable,
  DataTableCard,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableToolbar,
} from "@/components/ui/data-table"
import { ProgramFormDialog } from "@/components/admin/ProgramFormDialog"
import { FolderNameDialog } from "@/components/admin/library/FolderNameDialog"
import { GiveToClientDialog } from "@/components/admin/library/GiveToClientDialog"
import { cn } from "@/lib/utils"
import type { Program, ProgramFolder, User } from "@/types/database"

interface LibraryViewProps {
  folders: ProgramFolder[]
  programs: Program[]
  initialFolderId?: string
}

function formatPrice(cents: number | null): string {
  return cents == null ? "Free" : `$${(cents / 100).toFixed(2)}`
}

export function LibraryView({ folders, programs, initialFolderId }: LibraryViewProps) {
  const router = useRouter()
  const [folderId, setFolderId] = useState<string | null>(
    initialFolderId && folders.some((f) => f.id === initialFolderId) ? initialFolderId : (folders[0]?.id ?? null),
  )
  const [clients, setClients] = useState<User[]>([])
  const [folderDialog, setFolderDialog] = useState<{ folder: ProgramFolder | null } | null>(null)
  const [deleteFolder, setDeleteFolder] = useState<ProgramFolder | null>(null)
  const [giveTarget, setGiveTarget] = useState<Program | null>(null)
  const [moveTarget, setMoveTarget] = useState<Program | null>(null)
  const [moveTo, setMoveTo] = useState("")
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Program | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Program | null>(null)
  const [busy, setBusy] = useState(false)

  // Keep the selection valid after a folder is created or deleted (router.refresh()).
  useEffect(() => {
    if (!folders.some((f) => f.id === folderId)) setFolderId(folders[0]?.id ?? null)
  }, [folders, folderId])

  useEffect(() => {
    let cancelled = false
    fetch("/api/admin/users?role=client")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setClients(data.users ?? data ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const countByFolder = new Map<string, number>()
  for (const p of programs) {
    if (p.folder_id) countByFolder.set(p.folder_id, (countByFolder.get(p.folder_id) ?? 0) + 1)
  }
  const current = folders.find((f) => f.id === folderId) ?? null
  const rows = programs.filter((p) => p.folder_id === folderId)

  async function send(url: string, init: RequestInit, success: string): Promise<boolean> {
    setBusy(true)
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? "Something went wrong. Please try again.")
        return false
      }
      toast.success(success)
      router.refresh()
      return true
    } finally {
      setBusy(false)
    }
  }

  if (folders.length === 0) {
    return (
      <div>
        <EmptyState
          icon={Library}
          heading="Your library is empty"
          description="Make a folder, then save a program into it or build a new one. Programs in your library are never shown to clients. You give each client their own copy."
        />
        <div className="flex justify-center">
          <Button size="sm" onClick={() => setFolderDialog({ folder: null })}>
            <FolderPlus className="size-4" />
            New folder
          </Button>
        </div>
        <FolderNameDialog
          open={!!folderDialog}
          onOpenChange={(o) => !o && setFolderDialog(null)}
          folder={null}
          onSaved={(f) => setFolderId(f.id)}
        />
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <aside className="rounded-xl border border-border bg-white p-2 shadow-sm h-fit" aria-label="Library folders">
        <ul className="space-y-0.5">
          {folders.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => setFolderId(f.id)}
                aria-current={f.id === folderId ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm",
                  f.id === folderId ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-surface/50",
                )}
              >
                <Folder className="size-4 shrink-0" />
                <span className="truncate flex-1">{f.name}</span>
                <span className="text-xs text-muted-foreground">{countByFolder.get(f.id) ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-start"
          onClick={() => setFolderDialog({ folder: null })}
        >
          <FolderPlus className="size-4" />
          New folder
        </Button>
      </aside>

      <DataTableCard>
        <DataTableToolbar className="sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="font-heading text-sm font-semibold text-foreground truncate">{current?.name}</h2>
            {current && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label="Folder options">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => setFolderDialog({ folder: current })}>
                    <Pencil className="size-3.5" /> Rename folder
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={(countByFolder.get(current.id) ?? 0) > 0}
                    onSelect={() => setDeleteFolder(current)}
                    className="text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    {(countByFolder.get(current.id) ?? 0) > 0
                      ? "Delete (move or delete its programs first)"
                      : "Delete folder"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            disabled={!current}
          >
            <Plus className="size-4" />
            New program
          </Button>
        </DataTableToolbar>

        <DataTable>
          <DataTableHeader>
            <DataTableHead>Name</DataTableHead>
            <DataTableHead className="hidden md:table-cell">Length</DataTableHead>
            <DataTableHead className="hidden md:table-cell">Sessions/wk</DataTableHead>
            <DataTableHead className="hidden lg:table-cell">Price</DataTableHead>
            <DataTableHead align="right">Actions</DataTableHead>
          </DataTableHeader>
          <tbody>
            {rows.map((p) => (
              <DataTableRow key={p.id}>
                <DataTableCell className="font-medium">
                  <Link href={`/admin/programs/${p.id}`} className="hover:underline">
                    {p.name}
                  </Link>
                </DataTableCell>
                <DataTableCell muted className="hidden md:table-cell">
                  {p.duration_weeks} week{p.duration_weeks !== 1 ? "s" : ""}
                </DataTableCell>
                <DataTableCell muted className="hidden md:table-cell">
                  {p.sessions_per_week}x
                </DataTableCell>
                <DataTableCell muted className="hidden lg:table-cell">
                  {formatPrice(p.price_cents)}
                </DataTableCell>
                <DataTableCell align="right">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => setGiveTarget(p)}>
                      <Send className="size-3.5" />
                      Give to client
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={`More actions for ${p.name}`}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditing(p)
                            setFormOpen(true)
                          }}
                        >
                          <Pencil className="size-3.5" /> Edit details
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={busy}
                          onSelect={() =>
                            send(
                              `/api/admin/programs/${p.id}/save-to-library`,
                              {
                                method: "POST",
                                body: JSON.stringify({ folder_id: p.folder_id, name: `${p.name} (copy)` }),
                              },
                              "Copy made in this folder",
                            )
                          }
                        >
                          <Copy className="size-3.5" /> Make a copy
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={folders.length < 2}
                          onSelect={() => {
                            setMoveTarget(p)
                            setMoveTo(folders.find((f) => f.id !== p.folder_id)?.id ?? "")
                          }}
                        >
                          <FolderInput className="size-3.5" /> Move to folder
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteTarget(p)}>
                          <Trash2 className="size-3.5" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </DataTableCell>
              </DataTableRow>
            ))}
            {rows.length === 0 && (
              <DataTableEmpty colSpan={5}>
                No programs in this folder yet. Use “New program”, or “Save to library” on a client program.
              </DataTableEmpty>
            )}
          </tbody>
        </DataTable>
      </DataTableCard>

      <FolderNameDialog
        open={!!folderDialog}
        onOpenChange={(o) => !o && setFolderDialog(null)}
        folder={folderDialog?.folder ?? null}
        onSaved={(f) => setFolderId(f.id)}
      />
      <GiveToClientDialog
        open={!!giveTarget}
        onOpenChange={(o) => !o && setGiveTarget(null)}
        program={giveTarget}
        clients={clients}
      />
      <ProgramFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        program={editing}
        folderId={editing ? undefined : (current?.id ?? undefined)}
      />

      <Dialog open={!!moveTarget} onOpenChange={(o) => !o && setMoveTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Move “{moveTarget?.name}”</DialogTitle>
          </DialogHeader>
          <select
            aria-label="Folder"
            value={moveTo}
            onChange={(e) => setMoveTo(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground"
          >
            {folders
              .filter((f) => f.id !== moveTarget?.folder_id)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={busy || !moveTo}
              onClick={async () => {
                if (!moveTarget) return
                const ok = await send(
                  `/api/admin/programs/${moveTarget.id}/folder`,
                  { method: "PATCH", body: JSON.stringify({ folder_id: moveTo }) },
                  "Program moved",
                )
                if (ok) setMoveTarget(null)
              }}
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{deleteTarget?.name}”?</DialogTitle>
            <DialogDescription>
              This removes it from your library. Copies you already gave to clients are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!deleteTarget) return
                const ok = await send(`/api/admin/programs/${deleteTarget.id}`, { method: "DELETE" }, "Program deleted")
                if (ok) setDeleteTarget(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteFolder} onOpenChange={(o) => !o && setDeleteFolder(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete the folder “{deleteFolder?.name}”?</DialogTitle>
            <DialogDescription>The folder is empty, so nothing else is removed.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFolder(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!deleteFolder) return
                const ok = await send(
                  `/api/admin/programs/folders/${deleteFolder.id}`,
                  { method: "DELETE" },
                  "Folder deleted",
                )
                if (ok) setDeleteFolder(null)
              }}
            >
              Delete folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
