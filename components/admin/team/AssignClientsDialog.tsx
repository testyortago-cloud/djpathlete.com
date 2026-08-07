"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { hasPermission } from "@/lib/permissions/registry"
import type { TeamMember } from "@/lib/db/team-members"

interface ClientOption {
  id: string
  name: string
  email: string
}

interface Props {
  member: TeamMember
  clients: ClientOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void | Promise<void>
}

export function AssignClientsDialog({ member, clients, open, onOpenChange, onSaved }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const canSeeClients = hasPermission(member.permissions, "clients", "view")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/admin/team/members/${member.id}/clients`)
      .then((res) => (res.ok ? res.json() : { clientIds: [] }))
      .then((json) => {
        if (!cancelled) setSelected(new Set<string>(json.clientIds ?? []))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [member.id])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
  }, [clients, query])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/team/members/${member.id}/clients`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientIds: [...selected] }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error ?? "Failed to update assignments")
        return
      }
      toast.success(`${member.first_name} can now see ${selected.size} client${selected.size === 1 ? "" : "s"}`)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Clients for {member.first_name}</DialogTitle>
          <DialogDescription>
            They only see the clients ticked here — everywhere in the app, not just this list.
          </DialogDescription>
        </DialogHeader>

        {!canSeeClients && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
            {member.first_name} doesn&apos;t have the <span className="font-medium">Clients</span> permission
            yet, so these assignments won&apos;t do anything until you grant it under Edit permissions.
          </p>
        )}

        <Input
          placeholder="Search clients..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search clients"
        />

        <div className="max-h-[45vh] space-y-1 overflow-y-auto rounded-md border p-1">
          {loading && <p className="p-4 text-center text-sm text-muted-foreground">Loading...</p>}

          {!loading && filtered.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">
              {clients.length === 0 ? "No clients yet." : "No clients match that search."}
            </p>
          )}

          {!loading &&
            filtered.map((client) => {
              const checked = selected.has(client.id)
              return (
                <label
                  key={client.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors",
                    checked ? "bg-accent/10" : "hover:bg-muted/50",
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--accent)]"
                    checked={checked}
                    onChange={() => toggle(client.id)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{client.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{client.email}</span>
                  </span>
                </label>
              )
            })}
        </div>

        <DialogFooter className="items-center justify-between sm:justify-between">
          <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          <span className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={saving || loading}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
