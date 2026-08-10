"use client"

// The funnels screen is page-centric, not funnel-centric.
//
// A funnel is a container that usually holds exactly one page, so listing
// funnels and then listing their pages meant two near-identical screens and an
// extra click to reach the only thing you actually want: the editor. The funnel
// still exists — it owns the slug, the publish state and multi-step ordering —
// but here it is a filter chip, and "Open" goes straight to the canvas.

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PreviewCard } from "./PreviewCard"
import { FunnelGoLiveButton } from "./FunnelGoLiveButton"
import type { DataTableBadgeTone } from "@/components/ui/data-table"
import type { Funnel, FunnelStep } from "@/types/database"

export interface BoardPage {
  step: FunnelStep
  funnel: Funnel
}

interface FunnelBoardProps {
  pages: BoardPage[]
  funnels: Funnel[]
  /** funnel id -> submission count */
  leadCounts: Record<string, number>
}

export function FunnelBoard({ pages, funnels, leadCounts }: FunnelBoardProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [funnelFilter, setFunnelFilter] = useState<string>("all")
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return pages.filter(({ step, funnel }) => {
      if (funnelFilter !== "all" && funnel.id !== funnelFilter) return false
      if (needle.length === 0) return true
      return (
        step.name.toLowerCase().includes(needle) ||
        funnel.name.toLowerCase().includes(needle) ||
        funnel.slug.toLowerCase().includes(needle)
      )
    })
  }, [pages, query, funnelFilter])

  async function handleCreateFunnel() {
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      toast.error("Give the page a name first.")
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
        toast.error(body.error ?? "Could not create the page.")
        return
      }
      setName("")
      toast.success("Landing page created.")
      router.refresh()
    } catch {
      toast.error("Could not create the page.")
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete({ step, funnel }: BoardPage) {
    // Deleting the entry page has no meaning on its own — it IS the funnel.
    const deletingFunnel = step.is_entry
    const message = deletingFunnel
      ? `Delete "${funnel.name}" and all of its pages? This cannot be undone.`
      : `Delete the "${step.name}" page? This cannot be undone.`
    if (!window.confirm(message)) return

    const url = deletingFunnel ? `/api/admin/funnels/${funnel.id}` : `/api/admin/funnels/steps/${step.id}`

    try {
      const response = await fetch(url, { method: "DELETE" })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        toast.error(body?.error ?? "Could not delete.")
        return
      }
      toast.success(deletingFunnel ? "Funnel deleted." : "Page deleted.")
      router.refresh()
    } catch {
      toast.error("Could not delete.")
    }
  }

  const multiPageFunnels = funnels.filter((f) => pages.filter((p) => p.funnel.id === f.id).length > 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search pages…"
          className="sm:max-w-xs"
        />
        <div className="flex flex-1 gap-2 sm:justify-end">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleCreateFunnel()
            }}
            placeholder="New landing page name"
            className="sm:max-w-xs"
          />
          <Button onClick={handleCreateFunnel} disabled={creating}>
            <Plus className="size-4" />
            {creating ? "Creating…" : "Create page"}
          </Button>
        </div>
      </div>

      {multiPageFunnels.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          <FilterChip
            label={`All (${pages.length})`}
            active={funnelFilter === "all"}
            onClick={() => setFunnelFilter("all")}
          />
          {multiPageFunnels.map((funnel) => (
            <FilterChip
              key={funnel.id}
              label={`${funnel.name} (${pages.filter((p) => p.funnel.id === funnel.id).length})`}
              active={funnelFilter === funnel.id}
              onClick={() => setFunnelFilter(funnel.id)}
            />
          ))}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface/30 px-4 py-16 text-center text-muted-foreground">
          {pages.length === 0 ? "No landing pages yet. Name one above to get started." : "Nothing matches that search."}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((page) => {
            const { step, funnel } = page
            const path = `/go/${funnel.slug}${step.is_entry ? "" : `/${step.slug}`}`
            const published = Boolean(step.published_version_id)
            const live = published && funnel.status === "published"
            const badge: { label: string; tone: DataTableBadgeTone } = live
              ? { label: "live", tone: "success" }
              : published
                ? { label: "draft", tone: "neutral" }
                : { label: "never published", tone: "neutral" }

            return (
              <PreviewCard
                key={step.id}
                title={step.name}
                subtitle={step.is_entry ? path : `${funnel.name} · ${path}`}
                previewUrl={published ? `${path}?preview=1` : null}
                // Straight to the canvas. That is the only reason to click.
                href={`/admin/funnels/${funnel.id}/edit/${step.id}`}
                primaryLabel="Open"
                publicUrl={live ? path : null}
                badgeLabel={badge.label}
                badgeTone={badge.tone}
                leadCount={step.is_entry ? (leadCounts[funnel.id] ?? 0) : undefined}
                leadsHref={`/admin/funnels/leads?funnelId=${funnel.id}`}
                onDelete={() => handleDelete(page)}
                deleteLabel={step.is_entry ? `Delete ${funnel.name}` : `Delete ${step.name}`}
                secondaryAction={
                  <>
                    {/* GO LIVE FROM HERE. Publishing a PAGE writes a version;
                        only the FUNNEL's status makes /go/<slug> reachable, and
                        that toggle used to live one navigation away on the
                        funnel detail page — a page that otherwise just repeats
                        this card. The owner published a page, was told it
                        succeeded, and got a 404, because the control that
                        actually makes it public was somewhere he wasn't.
                        Entry card only: the entry page IS the funnel, so a
                        per-page toggle on a child step would be a lie. */}
                    {step.is_entry ? (
                      <FunnelGoLiveButton funnelId={funnel.id} status={funnel.status} canGoLive={published} />
                    ) : null}
                    <Button asChild variant="outline" size="sm" title="Funnel settings & pages">
                      <Link href={`/admin/funnels/${funnel.id}`}>
                        <Settings2 className="size-4" />
                      </Link>
                    </Button>
                  </>
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
          : "rounded-full border border-border bg-white px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
      }
    >
      {label}
    </button>
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
