"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, ExternalLink, Pencil } from "lucide-react"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableToolbar,
  type DataTableBadgeTone,
} from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Funnel, FunnelStatus } from "@/types/database"

const STATUS_TONE: Record<FunnelStatus, DataTableBadgeTone> = {
  draft: "neutral",
  published: "success",
  archived: "warning",
}

interface FunnelListProps {
  initialFunnels: Funnel[]
}

export function FunnelList({ initialFunnels }: FunnelListProps) {
  const router = useRouter()
  const [funnels, setFunnels] = useState<Funnel[]>(initialFunnels)
  const [query, setQuery] = useState("")
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)

  const visible = funnels.filter((funnel) => {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return true
    return (
      funnel.name.toLowerCase().includes(needle) || funnel.slug.toLowerCase().includes(needle)
    )
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

  return (
    <DataTableCard>
      <DataTableToolbar>
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
            placeholder="New funnel name"
            className="sm:max-w-xs"
          />
          <Button onClick={handleCreate} disabled={creating}>
            <Plus className="size-4" />
            {creating ? "Creating…" : "Create"}
          </Button>
        </div>
      </DataTableToolbar>

      <DataTable>
        <DataTableHeader>
          <DataTableHead>Name</DataTableHead>
          <DataTableHead className="hidden md:table-cell">Public URL</DataTableHead>
          <DataTableHead className="hidden md:table-cell">Status</DataTableHead>
          <DataTableHead align="right">Actions</DataTableHead>
        </DataTableHeader>
        <tbody>
          {visible.length === 0 ? (
            <DataTableEmpty colSpan={4}>
              No funnels yet. Name one above to get started.
            </DataTableEmpty>
          ) : (
            visible.map((funnel) => (
              <DataTableRow key={funnel.id}>
                <DataTableCell>
                  <Link href={`/admin/funnels/${funnel.id}`} className="font-medium text-primary">
                    {funnel.name}
                  </Link>
                </DataTableCell>
                <DataTableCell muted className="hidden md:table-cell text-xs">
                  /go/{funnel.slug}
                </DataTableCell>
                <DataTableCell className="hidden md:table-cell">
                  <DataTableBadge tone={STATUS_TONE[funnel.status]}>{funnel.status}</DataTableBadge>
                </DataTableCell>
                <DataTableCell align="right">
                  <div className="flex items-center justify-end gap-2">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/admin/funnels/${funnel.id}`}>
                        <Pencil className="size-4" />
                        Edit
                      </Link>
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <a
                        href={`/go/${funnel.slug}${funnel.status === "published" ? "" : "?preview=1"}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="size-4" />
                        View
                      </a>
                    </Button>
                  </div>
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </tbody>
      </DataTable>
    </DataTableCard>
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
