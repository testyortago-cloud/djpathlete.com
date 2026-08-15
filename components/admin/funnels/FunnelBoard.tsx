"use client"

// One board, two vocabularies.
//
// Both screens list one card per PAGE — a funnel that holds exactly one page
// would otherwise need two near-identical screens and an extra click to reach
// the only thing you actually want: the editor. What differs between a landing
// page and a funnel is the words, the create dialog and whether a goal applies;
// that is a `kind` prop, not a second component. Two copies of this file would
// drift, and the drift would be invisible until one screen quietly stopped
// matching the other.

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FUNNEL_GOALS } from "@/lib/validators/funnel"
import { PreviewCard } from "./PreviewCard"
import { FunnelGoLiveButton } from "./FunnelGoLiveButton"
import { CreatePageDialog } from "./CreatePageDialog"
import { CreateFunnelDialog } from "./CreateFunnelDialog"
import { ConvertToFunnelDialog } from "./ConvertToFunnelDialog"
import type { DataTableBadgeTone } from "@/components/ui/data-table"
import type { Funnel, FunnelStep, FunnelKind } from "@/types/database"

export interface BoardPage {
  step: FunnelStep
  funnel: Funnel
}

interface FunnelBoardProps {
  /** Which screen this is. Drives copy, the create dialog and the goal badge. */
  kind: FunnelKind
  pages: BoardPage[]
  funnels: Funnel[]
  /** funnel id -> submission count */
  leadCounts: Record<string, number>
}

export function FunnelBoard({ kind, pages, funnels, leadCounts }: FunnelBoardProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [funnelFilter, setFunnelFilter] = useState<string>("all")

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
          placeholder={kind === "page" ? "Search pages…" : "Search funnels…"}
          className="sm:max-w-xs"
        />
        <div className="flex flex-1 gap-2 sm:justify-end">
          {kind === "page" ? (
            <CreatePageDialog takenSlugs={funnels.map((f) => f.slug)} />
          ) : (
            <CreateFunnelDialog takenSlugs={funnels.map((f) => f.slug)} />
          )}
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
        pages.length === 0 ? (
          <EmptyState kind={kind} />
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-surface/30 px-4 py-16 text-center text-muted-foreground">
            Nothing matches that search.
          </div>
        )
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

            // Goals and descriptions belong to the FUNNEL row, so they describe
            // the entry page only — a child step is a different page with a
            // different job. And a funnel has no single goal at all: its steps
            // do, so showing one on the container would invent a fact.
            const goalLabel =
              kind === "page" && step.is_entry
                ? FUNNEL_GOALS.find((option) => option.value === funnel.goal)?.label
                : undefined

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
                goalLabel={goalLabel}
                description={step.is_entry ? funnel.description : null}
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
                    {/* Only on a landing page, and only on the entry card: a
                        funnel is already a funnel, and a child step is not the
                        thing that would be converted. */}
                    {kind === "page" && step.is_entry ? (
                      <ConvertToFunnelDialog funnelId={funnel.id} funnelName={funnel.name} />
                    ) : null}
                    {/* THE DRAG DESIGNER'S BUTTON WAS HERE AND IS DELIBERATELY
                        GONE. See lib/funnels/tree/parked.ts: it could not
                        publish a page, no page ever used it, and a page is now
                        edited by clicking it in the builder that Open goes to.
                        The route still exists and explains itself to anyone
                        holding a bookmark. */}
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

/**
 * The empty state is the only place a first-time owner is told what this screen
 * makes. A single grey "nothing here yet" line taught nothing, and it is the
 * state the screen spends its whole first day in.
 */
function EmptyState({ kind }: { kind: FunnelKind }) {
  const copy =
    kind === "page"
      ? {
          title: "No landing pages yet",
          body: "A landing page is one focused page at /go/<url>, built to do a single job — capture a lead, sell a program, fill a camp.",
          steps: [
            "Name it and pick what it should do",
            "Describe it — the builder writes the first draft",
            "Review it, then go live",
          ],
        }
      : {
          title: "No funnels yet",
          body: "A funnel is more than one step in order — a landing page, then a booking step, then a thank-you — all sharing one address.",
          steps: [
            "Create the funnel and name its first step",
            "Add the steps that follow it",
            "Publish each step, then take the funnel live",
          ],
        }

  return (
    <div className="rounded-xl border border-dashed border-border bg-surface/30 px-6 py-14 text-center">
      <h2 className="font-heading text-lg text-primary">{copy.title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{copy.body}</p>
      <ol className="mx-auto mt-5 max-w-xs space-y-2 text-left text-sm text-muted-foreground">
        {copy.steps.map((entry, index) => (
          <li key={entry} className="flex gap-2.5">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-medium text-accent">
              {index + 1}
            </span>
            {entry}
          </li>
        ))}
      </ol>
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
