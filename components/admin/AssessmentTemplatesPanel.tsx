"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Layers, Users, Trash2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

export interface TemplateItem {
  id: string
  title: string
  template_name: string | null
  exerciseCount: number
}

export interface TemplateClient {
  id: string
  first_name: string
  last_name: string
  email: string
}

export function AssessmentTemplatesPanel({
  templates,
  clients,
}: {
  templates: TemplateItem[]
  clients: TemplateClient[]
}) {
  const router = useRouter()
  const [assignTarget, setAssignTarget] = useState<TemplateItem | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [assigning, setAssigning] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function openAssign(t: TemplateItem) {
    setAssignTarget(t)
    setSelected(new Set())
    setSearch("")
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleAssign() {
    if (!assignTarget || selected.size === 0) return
    setAssigning(true)
    try {
      const res = await fetch(`/api/admin/performance-assessments/${assignTarget.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_user_ids: [...selected] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to assign")
      toast.success(`Created ${data.created} draft assessment(s) — share each from its detail page.`)
      setAssignTarget(null)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign template")
    } finally {
      setAssigning(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/admin/performance-assessments/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed")
      toast.success("Template deleted")
      router.refresh()
    } catch {
      toast.error("Failed to delete template")
    } finally {
      setDeletingId(null)
    }
  }

  const filteredClients = search
    ? clients.filter((c) =>
        `${c.first_name} ${c.last_name} ${c.email}`.toLowerCase().includes(search.toLowerCase()),
      )
    : clients

  if (templates.length === 0) return null

  return (
    <div className="mb-6 rounded-xl border border-border bg-white">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Layers className="size-4 text-primary" />
        <h2 className="text-sm font-semibold text-primary">Reusable templates ({templates.length})</h2>
      </div>
      <ul className="divide-y divide-border">
        {templates.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{t.template_name || t.title}</p>
              <p className="text-xs text-muted-foreground">
                {t.exerciseCount} exercise{t.exerciseCount === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => openAssign(t)}>
                <Users className="mr-1.5 size-3.5" /> Assign to athletes
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={deletingId === t.id}
                onClick={() => handleDelete(t.id)}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                title="Delete template"
              >
                {deletingId === t.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={!!assignTarget} onOpenChange={(o) => !o && setAssignTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign template to athletes</DialogTitle>
            <DialogDescription>
              Creates a draft assessment from &ldquo;{assignTarget?.template_name || assignTarget?.title}&rdquo; for
              each selected athlete. Open each one to review and share with the client.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Search athletes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9"
          />
          <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {filteredClients.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No athletes found.</p>
            ) : (
              filteredClients.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface/50">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="rounded border-border"
                  />
                  <span className="text-sm">
                    <span className="font-medium text-foreground">
                      {c.first_name} {c.last_name}
                    </span>
                    <span className="block text-xs text-muted-foreground">{c.email}</span>
                  </span>
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)} disabled={assigning}>
              Cancel
            </Button>
            <Button onClick={handleAssign} disabled={assigning || selected.size === 0}>
              {assigning ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Assign{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
