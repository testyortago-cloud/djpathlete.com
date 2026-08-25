"use client"

// components/admin/funnels/FunnelList.tsx — the funnels screen.
//
// SEPARATE FROM `FunnelBoard`, WHICH NOW SERVES ONLY `/admin/pages`.
//
// The two screens used to share one board because they had the same card: a
// landing page IS one page, and a funnel was being drawn as a pile of loose
// pages. Now they differ in the only region that matters — a funnel card lists
// its steps and what leads where — and `FunnelBoard` was already 388 lines of
// `kind`-branching. A third branch through a component that size, to render a
// card shaped differently, is how both screens end up wrong at once.
//
// What is NOT duplicated is the card chrome itself: `PreviewCard` renders both,
// and the step list arrives through its `extra` slot. The scaled same-origin
// thumbnail alone is sixty lines of ResizeObserver work that has already been
// got wrong once by hard-coding its scale — copying it would be the real
// duplication.
//
// THE FILTER CHIPS ARE GONE, NOT RELABELLED. They existed to regroup step cards
// by their funnel, so with one card per funnel the grouping IS the card. The
// owner's report — "the category filter is wrong its filtering the name" — was
// exactly right: they were funnel names doing duty as categories, and
// `FunnelBoard`'s own comment had already admitted as much.

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { FunnelCard, type QuizByStepId } from "./FunnelCard"
import { CreateFunnelDialog } from "./CreateFunnelDialog"
import { CreatePageDialog } from "./CreatePageDialog"
import { ownExamplesFromGroups } from "./own-examples"
import { BoardEmptyState } from "./BoardEmptyState"
import type { Funnel, FunnelStep, FunnelKind } from "@/types/database"

export interface FunnelWithSteps {
  funnel: Funnel
  steps: FunnelStep[]
}

interface FunnelListProps {
  funnels: FunnelWithSteps[]
  /** Submission counts keyed by funnel id. */
  leadCounts: Record<string, number>
  /**
   * The quiz each step runs, for the whole board. Defaults to none.
   *
   * THERE IS NO QUIZZES SCREEN ANY MORE, and this prop is why: a quiz is
   * something a funnel RUNS, not a thing the product has beside funnels. It
   * reaches the card that runs one and renders nothing on every other card, so
   * a customer with no quizzes never meets the word.
   */
  quizByStepId?: QuizByStepId
  /**
   * Which board this is: the copy, the create dialog and the empty state.
   *
   * AND NOTHING ABOUT HOW A CARD BEHAVES. A row's own `funnel.kind` decides
   * that, so a landing page listed anywhere still behaves like one -- which is
   * what makes sharing this component safe rather than merely shorter.
   *
   * DEFAULTS TO `"funnel"`. Every caller that predates `/admin/pages` moving
   * here omits it, and a default of `"page"` would have turned the funnels
   * board into a pages board in silence.
   */
  kind?: FunnelKind
}

export function FunnelList({ funnels, leadCounts, quizByStepId = {}, kind = "funnel" }: FunnelListProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")

  // Derived from what this screen ALREADY holds — no extra read, and the same
  // body the pages board uses, so the two cannot describe an example
  // differently.
  const ownExamples = useMemo(() => ownExamplesFromGroups(funnels), [funnels])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return funnels
    return funnels.filter(({ funnel, steps }) => {
      // STEP NAMES TOO. The flattened board's one real virtue was that typing a
      // page's name found it; collapsing to a funnel card must not cost that,
      // so a search for "checkout" surfaces the funnel that contains it.
      return (
        funnel.name.toLowerCase().includes(needle) ||
        funnel.slug.toLowerCase().includes(needle) ||
        steps.some((step) => step.name.toLowerCase().includes(needle) || step.slug.toLowerCase().includes(needle))
      )
    })
  }, [funnels, query])

  async function handleDelete(funnel: Funnel) {
    if (!window.confirm(`Delete "${funnel.name}" and all of its pages? This cannot be undone.`)) return
    try {
      const response = await fetch(`/api/admin/funnels/${funnel.id}`, { method: "DELETE" })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        toast.error(body?.error ?? "Could not delete the funnel.")
        return
      }
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
          placeholder={kind === "page" ? "Search pages…" : "Search funnels and pages…"}
          className="sm:max-w-xs"
        />
        <div className="flex flex-1 gap-2 sm:justify-end">
          {kind === "page" ? (
            <CreatePageDialog takenSlugs={funnels.map(({ funnel }) => funnel.slug)} />
          ) : (
            <CreateFunnelDialog takenSlugs={funnels.map(({ funnel }) => funnel.slug)} ownExamples={ownExamples} />
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        // THE REAL EMPTY STATE FOR AN EMPTY ACCOUNT, not one line of grey text.
        // This is the first screen a new owner meets, before they know what a
        // funnel is; the board it replaced explained that, and losing the
        // explanation was a silent regression. A no-MATCHES result is a
        // different thing and keeps its one line.
        funnels.length === 0 ? (
          <BoardEmptyState kind={kind} />
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-surface/30 px-4 py-16 text-center text-muted-foreground">
            Nothing matches that search.
          </div>
        )
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map(({ funnel, steps }) => (
            <FunnelCard
              key={funnel.id}
              funnel={funnel}
              steps={steps}
              leadCount={leadCounts[funnel.id] ?? 0}
              quizByStepId={quizByStepId}
              onDelete={() => handleDelete(funnel)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
