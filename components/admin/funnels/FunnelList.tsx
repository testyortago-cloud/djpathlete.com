"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PreviewCard } from "./PreviewCard"
import type { DataTableBadgeTone } from "@/components/ui/data-table"
import type { Funnel, FunnelStatus } from "@/types/database"

const STATUS_TONE: Record<FunnelStatus, DataTableBadgeTone> = {
  draft: "neutral",
  published: "success",
  archived: "warning",
}

interface FunnelListProps {
  initialFunnels: Funnel[]
  /** funnel id -> submission count. */
  leadCounts: Record<string, number>
  /** funnel id -> true when its entry page has a published version to preview. */
  previewable: Record<string, boolean>
}

export function FunnelList({ initialFunnels, leadCounts, previewable }: FunnelListProps) {
  const router = useRouter()
  const [funnels, setFunnels] = useState<Funnel[]>(initialFunnels)
  const [query, setQuery] = useState("")
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)

  const visible = funnels.filter((funnel) => {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return true
    return funnel.name.toLowerCase().includes(needle) || funnel.slug.toLowerCase().includes(needle)
  })

  async function handleCreate() {
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      toast.error("Give the funnel a name first.")
      return
    }

    setCreating(true)
    try {
      const response = await fetch("/api/admin/funnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, slug: slugify(trimmed) }),
      })
      const body = (await response.json()) as { funnel?: Funnel; error?: string }
      if (!response.ok || !body.funnel) {
        toast.error(body.error ?? "Could not create the funnel.")
        return
      }
      setFunnels((current) => [body.funnel as Funnel, ...current])
      setName("")
      toast.success("Funnel created.")
      router.refresh()
    } catch {
      toast.error("Could not create the funnel.")
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(funnel: Funnel) {
    if (!window.confirm(`Delete "${funnel.name}" and all of its pages? This cannot be undone.`)) {
      return
    }
    try {
      const response = await fetch(`/api/admin/funnels/${funnel.id}`, { method: "DELETE" })
      if (!response.ok) {
        toast.error("Could not delete the funnel.")
        return
      }
      setFunnels((current) => current.filter((f) => f.id !== funnel.id))
      toast.success("Funnel deleted.")
      router.refresh()
    } catch {
      toast.error("Could not delete the funnel.")
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search funnels…"
          className="sm:max-w-xs"
        />
        <div className="flex flex-1 gap-2 sm:justify-end">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleCreate()
            }}
            placeholder="New funnel name"
            className="sm:max-w-xs"
          />
          <Button onClick={handleCreate} disabled={creating}>
            <Plus className="size-4" />
            {creating ? "Creating…" : "Create funnel"}
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface/30 px-4 py-16 text-center text-muted-foreground">
          {funnels.length === 0
            ? "No funnels yet. Name one above to get started."
            : "No funnels match that search."}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((funnel) => {
            const publicUrl = `/go/${funnel.slug}`
            return (
              <PreviewCard
                key={funnel.id}
                title={funnel.name}
                subtitle={publicUrl}
                // Preview the entry page. `?preview=1` lets an admin see a funnel
                // that is still a draft; without a published version there is
                // nothing to render and the card says so.
                previewUrl={previewable[funnel.id] ? `${publicUrl}?preview=1` : null}
                href={`/admin/funnels/${funnel.id}`}
                publicUrl={funnel.status === "published" ? publicUrl : null}
                badgeLabel={funnel.status}
                badgeTone={STATUS_TONE[funnel.status]}
                leadCount={leadCounts[funnel.id] ?? 0}
                onDelete={() => handleDelete(funnel)}
                deleteLabel={`Delete ${funnel.name}`}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}
