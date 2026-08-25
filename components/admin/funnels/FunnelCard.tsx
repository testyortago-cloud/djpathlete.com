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

import { useMemo } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, CircleDot } from "lucide-react"
import { PreviewCard } from "./PreviewCard"
import { RenameDialog } from "./RenameDialog"
import { FunnelGoLiveButton } from "./FunnelGoLiveButton"
import { ConvertToFunnelDialog } from "./ConvertToFunnelDialog"
import { FUNNEL_GOALS } from "@/lib/validators/funnel"
import { Button } from "@/components/ui/button"
import { ListChecks, Settings2 } from "lucide-react"
import { funnelConnections, type Connection, type StepWithDoc } from "@/lib/funnels/connections"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"
import type { Funnel, FunnelStep } from "@/types/database"
import { previewBasePath } from "@/lib/funnels/preview-path"
import { adminFunnelHref, adminStepHref } from "@/lib/funnels/admin-path"

/**
 * THE QUIZ EACH STEP RUNS, keyed by step id, or an empty object.
 *
 * KEYED BY STEP AND NOT BY FUNNEL, because a `quiz` block lives on a PAGE and a
 * funnel has several. The map handed down is the whole board's, so a card must
 * look up only its own steps -- offering a neighbouring card's quiz is the bug
 * this shape makes obvious.
 *
 * ABSENT MEANS ABSENT, and that is the white-label requirement stated as a
 * type. A quiz is not something this product HAS alongside funnels; it is
 * something a funnel can run, like taking a payment. A customer whose work has
 * no quizzes in it must never meet the word -- so there is no empty state, no
 * disabled button and no placeholder here, only a control that does not render.
 */
export type QuizByStepId = Record<string, { id: string; name: string }>

export interface FunnelCardProps {
  funnel: Funnel
  /** Every step of this funnel. Ordered here, not by the caller. */
  steps: FunnelStep[]
  leadCount: number
  onDelete: () => void | Promise<void>
  /** The whole board's map. This card reads only its own steps out of it. */
  quizByStepId?: QuizByStepId
}

/**
 * The rows leaving one page that go to another page of this funnel.
 *
 * DEDUPED BY DESTINATION. A real page legitimately carries several buttons to
 * the same next step — the probe recorded in `connections.ts` found six CTAs on
 * one page — and six identical `→ Checkout` chips in a card this size is noise,
 * not information. The rail shows one row per exit because it has the height
 * for it and the owner is editing that page; the board is answering the
 * coarser question "does this join up?".
 */
function exitsFrom(connections: Connection[], stepId: string): Connection[] {
  const seen = new Set<string>()
  return connections.filter((entry) => {
    if (entry.fromStepId !== stepId || entry.to.kind !== "step") return false
    if (seen.has(entry.to.slug)) return false
    seen.add(entry.to.slug)
    return true
  })
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

export function FunnelCard({ funnel, steps, leadCount, onDelete, quizByStepId = {} }: FunnelCardProps) {
  // MEMOISED, and not as a micro-optimisation. `FunnelList` owns the search
  // box, so every keystroke re-renders every card — and without this, each one
  // re-runs `sectionDocSchema.safeParse` over every step's FULL page document.
  // On a board of a dozen funnels that is a zod parse of a dozen whole pages
  // per character typed.
  const { ordered, entry, graph, nameBySlug, lastId } = useMemo(() => {
    const ordered = [...steps].sort((a, b) => a.position - b.position)
    // `find`, not `[0]`. A funnel whose entry step was reordered still has
    // exactly one `is_entry` row, and that is the page `/go/<slug>` serves.
    const entry = ordered.find((step) => step.is_entry) ?? ordered[0] ?? null

    // PARSED, NOT CAST — `project_data` is jsonb typed `unknown`, and a legacy
    // GrapesJS blob is indistinguishable from a document by shape alone. A page
    // whose draft no longer parses loses its arrows, not the whole card.
    const docs: StepWithDoc[] = ordered.map((step) => {
      const parsed = sectionDocSchema.safeParse(step.project_data)
      return {
        id: step.id,
        name: step.name,
        slug: step.slug,
        position: step.position,
        isEntry: step.is_entry,
        // `parsed.data`, not a re-cast of the raw value. Casting the input
        // after validating a rebuilt copy is how a schema that later gains a
        // `.default()` or a transform silently stops describing what is used.
        doc: parsed.success ? (parsed.data as SectionDoc) : null,
      }
    })

    // THE READER'S OWN TIE-BREAK, not `ordered[length - 1]`. `funnelConnections`
    // picks the last page with `reduce((f, s) => s.position > f.position ? s : f)`,
    // which keeps the FIRST of a tied maximum; taking the array's last element
    // keeps the LAST. With duplicate positions the two disagree about which
    // page is allowed to end, and "the board and the builder cannot disagree"
    // is this card's whole premise.
    const last =
      ordered.length === 0
        ? null
        : ordered.reduce((furthest, step) => (step.position > furthest.position ? step : furthest))

    return {
      ordered,
      entry,
      graph: funnelConnections(funnel.slug, docs),
      nameBySlug: new Map(ordered.map((step) => [step.slug, step.name])),
      lastId: last?.id,
    }
  }, [steps, funnel.slug])

  // THE SAME RULE `StepList`, `StepRail` AND THE BOARD ALREADY USE. A version
  // row is not enough on its own: if the funnel is a draft the page is
  // unreachable, and if the entry has never been compiled a published funnel
  // serves nothing. Either way "live" would be the true thing about the
  // database and the false thing about the world.
  // THIS FUNNEL'S OWN STEPS ONLY. `ordered` is already position-sorted, so the
  // first step running a quiz wins -- matching `quizUsesInSteps`, which the
  // server used to build the map.
  const quizOnThisFunnel = useMemo(
    () => ordered.map((step) => quizByStepId[step.id]).find(Boolean) ?? null,
    [ordered, quizByStepId],
  )

  // `funnel.kind` IS THE FACT, never the screen's. A row's own kind decides how
  // it is administered, so a landing page listed anywhere still behaves like
  // one -- which is what lets both boards share this card at all.
  const isPage = funnel.kind === "page"

  // A FUNNEL HAS NO SINGLE GOAL -- its steps do -- so naming one on the
  // container would invent a fact. A landing page IS one page, so its goal is
  // the page's goal and worth showing.
  const goalLabel = isPage ? FUNNEL_GOALS.find((option) => option.value === funnel.goal)?.label : undefined

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
        // A funnel with an unbuilt entry still has no face, so `null` survives
        // for that case — but one whose entry is WRITTEN and merely unpublished
        // now shows it.
        previewUrl={entryPublished ? `${path}?preview=1` : entry ? previewBasePath(funnel.slug) : null}
        previewIsDraft={!entryPublished && Boolean(entry)}
        // BUILT FROM THE ROW'S KIND, never written out. Both routes serve a
        // page — the funnels one redirects — so a hardcoded `/admin/funnels`
        // still WORKS and still lights up the wrong sidebar tab, which is the
        // whole defect `adminFunnelBase` was added to fix. This is invisible
        // until the pages board renders this card, which it now does.
        href={entry ? adminStepHref(funnel.kind, funnel.id, entry.id) : adminFunnelHref(funnel.kind, funnel.id)}
        primaryLabel="Open"
        publicUrl={live ? path : null}
        badgeLabel={badge.label}
        badgeTone={badge.tone}
        goalLabel={goalLabel}
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
              noun={isPage ? "landing page" : "funnel"}
              publicPath={path}
            />
          </span>
        }
        secondaryAction={
          <>
            {/* THE QUIZ THIS FUNNEL RUNS, reached from the funnel that runs it.
                A quiz block holds a POINTER, so the quiz has no home of its own
                -- and it used to be reachable only from a separate list screen,
                which made it look like a sibling of Funnels rather than part of
                one. The owner's report, four times: "it should live in the
                funnel". The first step that runs one wins; a funnel showing the
                same quiz twice is one quiz to edit. */}
            {quizOnThisFunnel ? (
              <Button asChild variant="outline" size="sm" title={`Edit ${quizOnThisFunnel.name}`}>
                <Link href={`/admin/funnels/quizzes/${quizOnThisFunnel.id}`}>
                  <ListChecks className="size-4 shrink-0" aria-hidden />
                  Quiz
                </Link>
              </Button>
            ) : null}
            <FunnelGoLiveButton funnelId={funnel.id} status={funnel.status} kind={funnel.kind} canGoLive={entryPublished} />
            {/* A PAGE OUTGROWS ITSELF the moment it needs a thank-you or an
                upsell step. Explicit, never derived from the step count:
                deriving it would move a live page between screens with no
                warning and no undo. */}
            {isPage ? <ConvertToFunnelDialog funnelId={funnel.id} funnelName={funnel.name} /> : null}
            {/* FUNNEL ONLY, AND THIS IS THE SHARP EDGE OF SHARING ONE CARD.
                `/admin/pages/<id>` redirects to the list by design, so this
                button on a landing page is a control whose only outcome is a
                bounce back to the screen the owner is already looking at --
                the exact dead end that redirect was added to remove. */}
            {isPage ? null : (
              <Button asChild variant="outline" size="sm" aria-label={`${funnel.name} settings`}>
                <Link href={adminFunnelHref(funnel.kind, funnel.id)}>
                  <Settings2 className="size-4" />
                </Link>
              </Button>
            )}
          </>
        }
        extra={
          // TWO OR MORE, NOT "ANY". A one-step row's single step IS this card,
          // so a bordered box repeating the card's own title is the "emptier
          // copy" problem the landing-page detail screen was deleted over. It
          // lands identically on a one-step FUNNEL -- a quiz funnel is exactly
          // that -- so the COUNT decides here, never the kind.
          //
          // It also still covers the original case: a funnel with no steps at
          // all, which `listSteps` produces when a read fails.
          ordered.length < 2 ? null : (
          <div data-testid="funnel-step-list" className="rounded-lg border border-border bg-surface/30 p-2">
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
                          href={adminStepHref(funnel.kind, funnel.id, step.id)}
                          data-testid="step-name"
                          title={step.name}
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
          )
        }
      />
    </div>
  )
}
