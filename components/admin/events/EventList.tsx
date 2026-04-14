"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus, Pencil, Copy, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
    if (res.ok) router.refresh()
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this draft event?")) return
    const res = await fetch(`/api/admin/events/${id}`, { method: "DELETE" })
    if (res.ok) router.refresh()
    else {
      const data = await res.json()
      alert(data.error ?? "Delete failed")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by title"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as EventType | "all")}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="clinic">Clinic</SelectItem>
            <SelectItem value="camp">Camp</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as EventStatus | "all")}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button asChild><Link href="/admin/events/new"><Plus className="mr-1 h-4 w-4" /> New event</Link></Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Signups</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No events</td></tr>
            ) : filtered.map((e) => (
              <tr key={e.id} className="border-t border-border">
                <td className="px-4 py-3"><Link href={`/admin/events/${e.id}`} className="font-medium hover:text-primary">{e.title}</Link></td>
                <td className="px-4 py-3 capitalize">{e.type}</td>
                <td className="px-4 py-3">{new Date(e.start_date).toLocaleString()}</td>
                <td className="px-4 py-3">{e.location_name}</td>
                <td className="px-4 py-3">{e.signup_count} / {e.capacity}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[e.status]}`}>{e.status}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <Button asChild variant="ghost" size="sm"><Link href={`/admin/events/${e.id}`}><Pencil className="h-4 w-4" /></Link></Button>
                    <Button variant="ghost" size="sm" onClick={() => void handleDuplicate(e.id)}><Copy className="h-4 w-4" /></Button>
                    {e.status === "draft" && e.signup_count === 0 && (
                      <Button variant="ghost" size="sm" onClick={() => void handleDelete(e.id)}><Trash2 className="h-4 w-4" /></Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
