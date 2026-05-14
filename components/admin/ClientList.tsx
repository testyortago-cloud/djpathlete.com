"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Search, ChevronLeft, ChevronRight, Send, Pencil, Loader2, Activity } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { EditClientDialog } from "@/components/admin/EditClientDialog"
import type { User, UserStatus } from "@/types/database"

const PAGE_SIZE_OPTIONS = [10, 25, 50]

function getStatusClasses(status: UserStatus): string {
  switch (status) {
    case "active":
      return "bg-success/10 text-success"
    case "lead":
      return "bg-accent/15 text-accent"
    case "inactive":
      return "bg-muted text-muted-foreground"
    case "suspended":
      return "bg-destructive/10 text-destructive"
    default:
      return "bg-muted text-muted-foreground"
  }
}

export function ClientList({ users }: { users: User[] }) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [sendingInviteId, setSendingInviteId] = useState<string | null>(null)
  const [editingClient, setEditingClient] = useState<User | null>(null)

  async function handleSendInvite(client: User) {
    setSendingInviteId(client.id)
    try {
      const res = await fetch(`/api/admin/clients/${client.id}/send-invite`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Failed to send invite")
        return
      }
      toast.success(`Invite sent to ${client.email}`)
    } catch {
      toast.error("An unexpected error occurred")
    } finally {
      setSendingInviteId(null)
    }
  }

  const filtered = users.filter((c) => {
    const matchesSearch =
      !search ||
      c.first_name.toLowerCase().includes(search.toLowerCase()) ||
      c.last_name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase())
    const matchesRole = roleFilter === "all" || c.role === roleFilter
    const matchesStatus = statusFilter === "all" || c.status === statusFilter
    return matchesSearch && matchesRole && matchesStatus
  })

  const totalPages = Math.ceil(filtered.length / perPage)
  const paginated = filtered.slice((page - 1) * perPage, page * perPage)

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm">
      {/* Toolbar */}
      <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search clients..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value)
              setPage(1)
            }}
            className="h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground"
          >
            <option value="all">All Roles</option>
            <option value="admin">Admin</option>
            <option value="client">Client</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
            className="h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="lead">Lead</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface/50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Joined</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((client) => (
              <tr
                key={client.id}
                className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
              >
                <td className="px-4 py-3">
                  <Link href={`/admin/clients/${client.id}`} className="font-medium text-primary hover:underline">
                    {client.first_name} {client.last_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{client.email}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary capitalize">
                    {client.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${getStatusClasses(client.status)}`}
                  >
                    {client.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{new Date(client.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {client.status === "lead" && (
                      <button
                        type="button"
                        onClick={() => handleSendInvite(client)}
                        disabled={sendingInviteId === client.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50 px-2.5 py-1 text-xs font-medium transition-colors"
                        title="Send registration invite"
                      >
                        {sendingInviteId === client.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Send className="size-3" />
                        )}
                        Invite
                      </button>
                    )}
                    <Link
                      href={`/admin/clients/${client.id}/performance`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/15 px-2.5 py-1 text-xs font-medium transition-colors"
                      title="Open performance database"
                    >
                      <Activity className="size-3" />
                      Performance
                    </Link>
                    <button
                      type="button"
                      onClick={() => setEditingClient(client)}
                      className="inline-flex items-center justify-center rounded-lg border border-border bg-white hover:bg-surface size-7 transition-colors"
                      title="Edit client"
                    >
                      <Pencil className="size-3.5 text-muted-foreground" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  No clients found matching your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="p-4 border-t border-border flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>Rows per page:</span>
          <select
            value={perPage}
            onChange={(e) => {
              setPerPage(Number(e.target.value))
              setPage(1)
            }}
            className="h-8 rounded border border-border bg-white px-2 text-sm"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span className="ml-2">
            {filtered.length === 0 ? "0" : `${(page - 1) * perPage + 1}-${Math.min(page * perPage, filtered.length)}`}{" "}
            of {filtered.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
            className="p-1.5 rounded-lg hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page >= totalPages}
            className="p-1.5 rounded-lg hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {editingClient && (
        <EditClientDialog
          open={!!editingClient}
          onOpenChange={(o) => {
            if (!o) {
              setEditingClient(null)
              router.refresh()
            }
          }}
          client={editingClient}
        />
      )}
    </div>
  )
}
