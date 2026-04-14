"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus, Search, Pencil, Trash2, Loader2, Eye } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { Newsletter } from "@/types/database"

interface NewsletterListProps {
  newsletters: Newsletter[]
}

const statusTabs = ["All", "Draft", "Sent"] as const
type StatusTab = (typeof statusTabs)[number]

export function NewsletterList({ newsletters }: NewsletterListProps) {
  const router = useRouter()
  const [tab, setTab] = useState<StatusTab>("All")
  const [search, setSearch] = useState("")
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const filtered = newsletters.filter((n) => {
    if (tab === "Draft" && n.status !== "draft") return false
    if (tab === "Sent" && n.status !== "sent") return false
    if (search) {
      const q = search.toLowerCase()
      return n.subject.toLowerCase().includes(q) || n.preview_text.toLowerCase().includes(q)
    }
    return true
  })

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/admin/newsletter/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete")
      toast.success("Newsletter deleted")
      router.refresh()
    } catch {
      toast.error("Failed to delete newsletter")
    } finally {
      setDeletingId(null)
      setConfirmId(null)
    }
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return "—"
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1 bg-surface rounded-lg p-1">
          {statusTabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                tab === t ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search newsletters..."
              className="pl-8 pr-3 py-2 rounded-lg border border-border bg-white text-sm w-48 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <Link
            href="/admin/newsletter/new"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="size-4" />
            New Newsletter
          </Link>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">
            {search
              ? "No newsletters match your search."
              : tab === "All"
                ? "No newsletters yet. Create your first one!"
                : `No ${tab.toLowerCase()} newsletters.`}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Subject</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Sent</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Date</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((nl) => (
                  <tr
                    key={nl.id}
                    className="border-b border-border last:border-0 hover:bg-surface/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-primary line-clamp-1">{nl.subject}</p>
                        {nl.preview_text && (
                          <p className="text-xs text-muted-foreground line-clamp-1">{nl.preview_text}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span
                        className={cn(
                          "inline-block px-2 py-0.5 rounded-full text-xs font-medium",
                          nl.status === "sent" ? "bg-success/10 text-success" : "bg-warning/10 text-warning",
                        )}
                      >
                        {nl.status === "sent" ? "Sent" : "Draft"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                      {nl.status === "sent"
                        ? `${nl.sent_count} delivered${nl.failed_count ? `, ${nl.failed_count} failed` : ""}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                      {formatDate(nl.sent_at ?? nl.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/admin/newsletter/${nl.id}/edit`}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          title={nl.status === "sent" ? "View" : "Edit"}
                        >
                          {nl.status === "sent" ? <Eye className="size-4" /> : <Pencil className="size-4" />}
                        </Link>
                        {confirmId === nl.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(nl.id)}
                              disabled={deletingId === nl.id}
                              className="px-2 py-1 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                            >
                              {deletingId === nl.id ? <Loader2 className="size-3 animate-spin" /> : "Delete"}
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
                            onClick={() => setConfirmId(nl.id)}
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
        </div>
      )}
    </div>
  )
}
