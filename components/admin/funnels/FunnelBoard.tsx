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
import { formatRunWindow } from "@/lib/funnels/run-window"
import { CreatePageDialog } from "./CreatePageDialog"
import { CreateFunnelDialog } from "./CreateFunnelDialog"
import { ConvertToFunnelDialog } from "./ConvertToFunnelDialog"
import { RenameDialog } from "./RenameDialog"
import type { DataTableBadgeTone } from "@/components/ui/data-table"
import type { Funnel, FunnelStep, FunnelKind } from "@/types/database"
import { adminFunnelHref, adminStepHref } from "@/lib/funnels/admin-path"

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

/**
 * THE NAME THE OWNER TYPED, wherever it happens to live.
 *
 * A landing page's name is on the FUNNEL row: `createFunnel` names its only
 * step "Landing page", a label nobody chose and every card shares. Titling the
 * card with it turned the owner's own name into a filter chip and nothing else,
 * so a list of landing pages read as several identical rows called "Landing
 * page" — sorted under categories the owner never created.
 *
 * A funnel's page is a different thing: its steps are named individually and
 * the funnel's name is the container above them, so there `step.name` is right.
 * `funnel.kind`, not the screen, decides — the row is the fact.
 */
export function titlesTheFunnelRow({ step, funnel }: BoardPage): boolean {
  return funnel.kind === "page" && step.is_entry
}

export function cardTitle(page: BoardPage): string {
  return titlesTheFunnelRow(page) ? page.funnel.name : page.step.name
}

export function FunnelBoard({ kind, pages, funnels, leadCounts }: FunnelBoardProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [funnelFilter, setFunnelFilter] = useState<string>("all")

  const pageCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const { funnel } of pages) counts.set(funnel.id, (counts.get(funnel.id) ?? 0) + 1)
    return counts
  }, [pages])

  /**
   * Chips group pages BY FUNNEL, which is only worth doing when grouping
   * actually groups. On the landing pages screen every funnel holds exactly one
   * page, so each chip filtered down to a single card that was already on
   * screen — and, being labelled with the funnel's name, it read as a category
   * the owner had somehow assigned rather than the name of the page itself.
   */
  const groups = useMemo(() => funnels.filter((f) => (pageCounts.get(f.id) ?? 0) > 0), [funnels, pageCounts])
  const showFilters = groups.length > 1 && groups.some((f) => (pageCounts.get(f.id) ?? 0) > 1)

  // Ignored, not just hidden. Deleting a page can drop the board below the
  // threshold above while a chip is still selected, and a filter with no
  // visible control is a board that silently hides rows.
  const activeFilter = showFilters ? funnelFilter : "all"

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return pages.filter(({ step, funnel }) => {
      if (activeFilter !== "all" && funnel.id !== activeFilter) return false
      if (needle.length === 0) return true
      return (
        step.name.toLowerCase().includes(needle) ||
        funnel.name.toLowerCase().includes(needle) ||
        funnel.slug.toLowerCase().includes(needle)
      )
    })
  }, [pages, query, activeFilter])

  async function handleDelete({ step, funnel }: BoardPage) {
    // Deleting the entry page has no meaning on its own — it IS the funnel.
    // But WHICH word describes what just vanished depends on the row, not on
    // the request: a landing page's entry step also deletes a `funnels` row,
    // and saying "Funnel deleted" on the pages screen names a thing the owner
    // has never seen. `funnel.kind`, not the endpoint, decides the vocabulary.
    const deletingFunnel = step.is_entry
    const isPage = funnel.kind === "page"
    const message = deletingFunnel
      ? isPage
        ? `Delete the "${funnel.name}" landing page? This cannot be undone.`
        : `Delete "${funnel.name}" and all of its pages? This cannot be undone.`
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
      toast.success(deletingFunnel ? (isPage ? "Landing page deleted." : "Funnel deleted.") : "Page deleted.")
      router.refresh()
    } catch {
      toast.error("Could not delete.")
    }
  }

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

      {showFilters ? (
        <div className="flex flex-wrap gap-2">
          <FilterChip
            label={`All (${pages.length})`}
            active={activeFilter === "all"}
            onClick={() => setFunnelFilter("all")}
          />
          {groups.map((funnel) => (
            <FilterChip
              key={funnel.id}
              label={`${funnel.name} (${pageCounts.get(funnel.id) ?? 0})`}
              active={activeFilter === funnel.id}
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

            // The card's title and the row the rename writes to must be the
            // SAME row, or the pencil edits a word the card does not show —
            // hence one predicate feeding both, not two conditions that agree
            // today.
            const titlesTheFunnel = titlesTheFunnelRow(page)
            const title = cardTitle(page)

            return (
              <PreviewCard
                key={step.id}
                title={title}
                // The funnel's name is dropped here only when the title already
                // IS the funnel's name; on every other card it is the one thing
                // saying which funnel this page belongs to.
                subtitle={titlesTheFunnel ? path : `${funnel.name} · ${path}`}
                titleAction={
                  <RenameDialog
                    name={title}
                    noun={titlesTheFunnel ? "landing page" : funnel.kind === "page" ? "page" : "step"}
                    endpoint={
                      titlesTheFunnel
                        ? `/api/admin/funnels/${funnel.id}`
                        : `/api/admin/funnels/steps/${step.id}`
                    }
                    publicPath={path}
                  />
                }
                previewUrl={published ? `${path}?preview=1` : null}
                // Straight to the canvas. That is the only reason to click.
                href={adminStepHref(funnel.kind, funnel.id, step.id)}
                primaryLabel="Open"
                publicUrl={live ? path : null}
                badgeLabel={badge.label}
                badgeTone={badge.tone}
                goalLabel={goalLabel}
                description={step.is_entry ? funnel.description : null}
                // Entry card only: the window belongs to the funnel, not to
                // each of its pages, so repeating it on every step would read
                // as four different windows.
                runWindow={step.is_entry ? formatRunWindow(funnel.starts_at, funnel.ends_at) : null}
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
                    {/* FUNNELS ONLY, and for the same reason the go-live
                        button above moved onto this card: `/admin/<base>/<id>`
                        is a STEP LIST, and a landing page has exactly one step.
                        For a page it rendered a second, emptier copy of this
                        card and nothing else — every control it held is now
                        here. A funnel's steps are real information this board
                        cannot show, so the button stays there. */}
                    {kind === "funnel" ? (
                      <Button asChild variant="outline" size="sm" title="Funnel settings & pages">
                        <Link href={adminFunnelHref(funnel.kind, funnel.id)}>
                          <Settings2 className="size-4" />
                        </Link>
                      </Button>
                    ) : null}
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
