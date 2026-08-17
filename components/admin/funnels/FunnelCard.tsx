"use client"

// components/admin/funnels/FunnelCard.tsx — a funnel, as one thing.
//
// THE COMPLAINT THIS ANSWERS, verbatim: "why connected funnels is not compiled,
// and also the category filter is wrong its filtering the name".
//
// Both halves were one decision. The funnels screen rendered ONE CARD PER STEP
// and pushed the funnel's name into a filter chip above them — `page.tsx` said
// so outright: "a funnel's steps are the things you open, and the funnel itself
// is the filter chip above them". So a three-step funnel was three loose cards,
// the funnel had no card of its own, and the chip read as a category the owner
// had somehow assigned. `FunnelBoard`'s own comment had already admitted that
// second half about the landing-pages screen and left it standing here.
//
// It also left the screen contradicting the model underneath it: publishing and
// background drafting are both FUNNEL-level operations now — one all-or-nothing
// publish, one queue spanning every step — while the board was still step-level.
//
// So the funnel is the card, and its steps are a list inside it.
//
// THE ARROWS COME FROM `funnelConnections`, THE SAME READER THE BUILDER'S STEP
// RAIL USES. That is the point of reusing it rather than re-deriving "what
// leads where" here: the board and the builder cannot disagree about whether a
// funnel is connected, and the publish gate resolves the same refs again. Three
// surfaces, one definition.

import Link from "next/link"
import { AlertTriangle, ArrowRight, CircleDot } from "lucide-react"
import { PreviewCard } from "./PreviewCard"
import { RenameDialog } from "./RenameDialog"
import { FunnelGoLiveButton } from "./FunnelGoLiveButton"
import { Button } from "@/components/ui/button"
import { Settings2 } from "lucide-react"
import { funnelConnections, type Connection, type StepWithDoc } from "@/lib/funnels/connections"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"
import type { Funnel, FunnelStep } from "@/types/database"

export interface FunnelCardProps {
  funnel: Funnel
  /** Every step of this funnel. Ordered here, not by the caller. */
  steps: FunnelStep[]
  leadCount: number
  onDelete: () => void | Promise<void>
}

/** The rows leaving one page that go to another page of this funnel. */
function exitsFrom(connections: Connection[], stepId: string): Connection[] {
  return connections.filter((entry) => entry.fromStepId === stepId && entry.to.kind === "step")
}

/**
 * What leaves this page, in the owner's own button text.
 *
 * SAME VOCABULARY AS THE RAIL — "ends here", "leads nowhere", and the exact
 * `→ no page called "x"` for a broken slug. A second wording for the same three
 * states would be a second opinion about whether a funnel is connected.
 */
function StepExits({ exits, isLast, nameBySlug }: { exits: Connection[]; isLast: boolean; nameBySlug: Map<string, string> }) {
  if (exits.length === 0) {
    // The last page is SUPPOSED to end. Saying so is the difference between a
    // card that reports a problem and one that nags about a thank-you page.
    if (isLast) {
      return (
        <span data-testid="step-exits" className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <CircleDot className="size-3 shrink-0" aria-hidden />
          ends here
        </span>
      )
    }
    return (
      <span data-testid="step-exits" className="flex items-center gap-1 text-[11px] text-[var(--warning)]">
        <AlertTriangle className="size-3 shrink-0" aria-hidden />
        leads nowhere
      </span>
    )
  }

  return (
    <span data-testid="step-exits" className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {exits.map((exit) => {
        const slug = exit.to.kind === "step" ? exit.to.slug : ""
        const exists = exit.to.kind === "step" && exit.to.exists
        return (
          <span
            key={`${exit.sectionId}-${exit.field}`}
            className={`flex items-center gap-1 text-[11px] ${exists ? "text-muted-foreground" : "text-[var(--error)]"}`}
          >
            {exists ? (
              <ArrowRight className="size-3 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="size-3 shrink-0" aria-hidden />
            )}
            {exists ? (nameBySlug.get(slug) ?? slug) : `no page called “${slug}”`}
          </span>
        )
      })}
    </span>
  )
}

export function FunnelCard({ funnel, steps, leadCount, onDelete }: FunnelCardProps) {
  const ordered = [...steps].sort((a, b) => a.position - b.position)
  // `find`, not `[0]`. A funnel whose entry step was reordered still has
  // exactly one `is_entry` row, and that is the page `/go/<slug>` serves.
  const entry = ordered.find((step) => step.is_entry) ?? ordered[0] ?? null

  // PARSED, NOT CAST — `project_data` is jsonb typed `unknown`, and a legacy
  // GrapesJS blob is indistinguishable from a document by shape alone. A page
  // whose draft no longer parses loses its arrows, not the whole card.
  const docs: StepWithDoc[] = ordered.map((step) => ({
    id: step.id,
    name: step.name,
    slug: step.slug,
    position: step.position,
    isEntry: step.is_entry,
    doc: sectionDocSchema.safeParse(step.project_data).success ? (step.project_data as SectionDoc) : null,
  }))
  const graph = funnelConnections(funnel.slug, docs)
  const nameBySlug = new Map(ordered.map((step) => [step.slug, step.name]))
  const lastId = ordered[ordered.length - 1]?.id

  // THE SAME RULE `StepList`, `StepRail` AND THE BOARD ALREADY USE. A version
  // row is not enough on its own: if the funnel is a draft the page is
  // unreachable, and if the entry has never been compiled a published funnel
  // serves nothing. Either way "live" would be the true thing about the
  // database and the false thing about the world.
  const entryPublished = Boolean(entry?.published_version_id)
  const live = entryPublished && funnel.status === "published"
  const badge = live
    ? { label: "live", tone: "success" as const }
    : entryPublished
      ? { label: "draft", tone: "neutral" as const }
      : { label: "never published", tone: "neutral" as const }

  const path = `/go/${funnel.slug}`

  return (
    <div data-testid="funnel-card">
      <PreviewCard
        title={funnel.name}
        subtitle={path}
        // The FUNNEL's face is its entry page. A funnel whose entry is unbuilt
        // shows "No preview yet" at the funnel level, which is honest.
        previewUrl={entryPublished ? `${path}?preview=1` : null}
        href={entry ? `/admin/funnels/${funnel.id}/edit/${entry.id}` : `/admin/funnels/${funnel.id}`}
        primaryLabel="Open"
        publicUrl={live ? path : null}
        badgeLabel={badge.label}
        badgeTone={badge.tone}
        description={funnel.description}
        leadCount={leadCount}
        leadsHref={`/admin/funnels/leads?funnelId=${funnel.id}`}
        onDelete={onDelete}
        deleteLabel={`Delete ${funnel.name}`}
        titleAction={
          <span data-testid="funnel-name-action">
            {/* The FUNNEL row, not a step. On the old board this pencil edited
                whichever step's card you clicked; here the title is the funnel,
                so the endpoint must be too or the pencil edits a word the card
                does not show. */}
            <RenameDialog
              name={funnel.name}
              endpoint={`/api/admin/funnels/${funnel.id}`}
              noun="funnel"
              publicPath={path}
            />
          </span>
        }
        secondaryAction={
          <>
            <FunnelGoLiveButton funnelId={funnel.id} status={funnel.status} kind={funnel.kind} canGoLive={entryPublished} />
            <Button asChild variant="outline" size="sm" aria-label={`${funnel.name} settings`}>
              <Link href={`/admin/funnels/${funnel.id}`}>
                <Settings2 className="size-4" />
              </Link>
            </Button>
          </>
        }
        extra={
          <div className="rounded-lg border border-border bg-surface/30 p-2">
            <ol className="space-y-1.5">
              {ordered.map((step, index) => {
                const stepLive = Boolean(step.published_version_id) && funnel.status === "published"
                return (
                  <li key={step.id} data-testid="funnel-step-row" className="flex items-start gap-2">
                    <span className="w-3 shrink-0 text-[11px] text-muted-foreground">{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2">
                        {/* Straight into THIS page's builder. The flattened
                            board's one real virtue was that every page was one
                            click away; collapsing to a funnel card must not
                            cost that. */}
                        <Link
                          href={`/admin/funnels/${funnel.id}/edit/${step.id}`}
                          data-testid="step-name"
                          className="truncate text-xs text-primary hover:underline"
                        >
                          {step.name}
                        </Link>
                        {stepLive ? (
                          <span className="rounded-full bg-[var(--success)]/10 px-1.5 py-0.5 text-[10px] text-[var(--success)]">
                            live
                          </span>
                        ) : null}
                      </span>
                      <StepExits
                        exits={exitsFrom(graph.connections, step.id)}
                        isLast={step.id === lastId}
                        nameBySlug={nameBySlug}
                      />
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
        }
      />
      {/* Read by the tests and by nothing else — the visible status lives in
          PreviewCard's badge, and duplicating it as text would put the word on
          screen twice. */}
      <span data-testid="funnel-status" className="sr-only">
        {badge.label}
      </span>
      <span data-testid="funnel-name" className="sr-only">
        {funnel.name}
      </span>
    </div>
  )
}
