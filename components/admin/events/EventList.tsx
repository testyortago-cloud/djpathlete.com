"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Search, Pencil, Copy, Trash2, CalendarX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Event, EventStatus, EventType } from "@/types/database"

interface EventListProps {
  initialEvents: Event[]
}

const STATUS_BADGE: Record<EventStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-success/15 text-success",
  cancelled: "bg-destructive/15 text-destructive",
  completed: "bg-primary/10 text-primary",
}

const TYPE_BADGE: Record<EventType, string> = {
  clinic: "bg-primary/10 text-primary",
  camp: "bg-accent/15 text-accent",
}

function formatStart(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function EventList({ initialEvents }: EventListProps) {
  const router = useRouter()
  const [typeFilter, setTypeFilter] = useState<EventType | "all">("all")
  const [statusFilter, setStatusFilter] = useState<EventStatus | "all">("all")
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    return initialEvents.filter((e) => {
      if (typeFilter !== "all" && e.type !== typeFilter) return false
      if (statusFilter !== "all" && e.status !== statusFilter) return false
      if (search && !e.title.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [initialEvents, typeFilter, statusFilter, search])

  async function handleDuplicate(id: string) {
    const res = await fetch(`/api/admin/events/${id}/duplicate`, { method: "POST" })
    if (res.ok) {
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      alert(data.error ?? "Duplicate failed")
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this event? This cannot be undone.")) return
    const res = await fetch(`/api/admin/events/${id}`, { method: "DELETE" })
    if (res.ok) router.refresh()
    else {
      const data = await res.json()
      alert(data.error ?? "Delete failed")
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm">
      {/* Toolbar */}
      <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as EventType | "all")}
            className="h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground"
          >
            <option value="all">All Types</option>
            <option value="clinic">Clinic</option>
            <option value="camp">Camp</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as EventStatus | "all")}
            className="h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground"
          >
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface/50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Start</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Location</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Signups</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <CalendarX className="size-8" />
                    <p className="text-sm">No events match your filters.</p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((e) => {
                const pct = e.capacity > 0 ? Math.min(100, Math.round((e.signup_count / e.capacity) * 100)) : 0
                const full = e.signup_count >= e.capacity
                return (
                  <tr
                    key={e.id}
                    className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/admin/events/${e.id}`} className="font-medium text-primary hover:underline">
                        {e.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${TYPE_BADGE[e.type]}`}
                      >
                        {e.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatStart(e.start_date)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{e.location_name}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 min-w-[9rem]">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full ${full ? "bg-accent" : "bg-primary"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {e.signup_count}/{e.capacity}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[e.status]}`}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="ghost" size="sm" title="Edit">
                          <Link href={`/admin/events/${e.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleDuplicate(e.id)}
                          title="Duplicate"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        {e.signup_count === 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleDelete(e.id)}
                            title="Delete event"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
