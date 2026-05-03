"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Pencil, Trash2, Loader2, ExternalLink, Search } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { LeadMagnet } from "@/types/database"
import { LeadMagnetFormDialog } from "./LeadMagnetFormDialog"

interface LeadMagnetListProps {
  initialMagnets: LeadMagnet[]
}

export function LeadMagnetList({ initialMagnets }: LeadMagnetListProps) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<LeadMagnet | null>(null)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const filtered = initialMagnets.filter((m) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      m.title.toLowerCase().includes(q) ||
      m.slug.toLowerCase().includes(q) ||
      m.tags.some((t) => t.toLowerCase().includes(q))
    )
  })

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/admin/lead-magnets/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete")
      toast.success("Lead magnet deleted")
      router.refresh()
    } catch {
      toast.error("Failed to delete lead magnet")
    } finally {
      setDeletingId(null)
      setConfirmId(null)
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, slug, tag..."
            className="pl-8 pr-3 py-2 rounded-lg border border-border bg-white text-sm w-64 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="size-4" />
          New magnet
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">{search ? "No matches." : "No lead magnets yet. Create your first one."}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Slug</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Tags</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Status</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0 hover:bg-surface/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-primary line-clamp-1">{m.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5 md:hidden">{m.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">{m.slug}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {m.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface text-muted-foreground border border-border">
                          {tag}
                        </span>
                      ))}
                      {m.tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{m.tags.length - 3}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className={cn(
                      "inline-block px-2 py-0.5 rounded-full text-xs font-medium",
                      m.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
                    )}>
                      {m.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={m.asset_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        title="Preview asset"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                      <button
                        type="button"
                        onClick={() => setEditing(m)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="size-4" />
                      </button>
                      {confirmId === m.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(m.id)}
                            disabled={deletingId === m.id}
                            className="px-2 py-1 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                          >
                            {deletingId === m.id ? <Loader2 className="size-3 animate-spin" /> : "Delete"}
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:bg-surface transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmId(m.id)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <LeadMagnetFormDialog
          magnet={editing}
          open={creating || !!editing}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false)
              setEditing(null)
            }
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
