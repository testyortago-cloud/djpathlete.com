"use client"

// components/admin/funnels/connections-context.tsx — keeping the rail honest
// while the owner edits.
//
// The rail lives in a LAYOUT and the builder lives in the PAGE beneath it, so
// the rail is a server-rendered sibling of the thing that changes it. Without
// this bridge it would be correct at mount and wrong from the first edit
// onwards: wire a button in the inspector and the arrow would not move until a
// refresh, which is the "collected and then ignored" failure this area has
// already shipped twice.
//
// SO: the server's graph seeds the state, and the builder overwrites ONLY the
// page it is editing, which is the one page it has better information about
// than the server does. Every other page stays exactly as the server described
// it, because nothing in this tab can have changed it.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import {
  funnelConnections,
  type FunnelConnections,
  type StepWithDoc,
} from "@/lib/funnels/connections"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import type { SectionOp } from "@/lib/funnels/sections/apply"
import { readTurnStream } from "@/components/admin/funnels/builder/stream"

interface ConnectionsState {
  connections: FunnelConnections
  /** Ordered by position. What the rail draws a row for. */
  pages: RailPage[]
  funnelId: string
  funnelSlug: string
  funnelKind: string
}

/** One page as the rail needs it — no document, that lives in the graph. */
export interface RailPage {
  id: string
  name: string
  slug: string
  position: number
  isEntry: boolean
  /** Serving a published version AND the funnel itself is published. */
  live: boolean
  published: boolean
}

/**
 * The one page that can currently be repaired, and how.
 *
 * ONLY THE PAGE BEING EDITED. Applying ops needs the step's revision, which
 * `PUT .../edit` checks to refuse a stale write — and the layout holds no
 * revisions, only documents. A "fix every page" button would therefore have to
 * either skip the check or invent revisions, and both mean silently clobbering
 * whatever another tab has done. So the rail reports every page that leads
 * nowhere, and offers the fix on the one whose revision the builder is holding.
 */
interface Repair {
  stepId: string
  apply: (ops: SectionOp[]) => void | Promise<void>
}

/**
 * How far along a never-built step's background draft is.
 *
 * `failed` is terminal for this session and deliberately not retried: a model
 * refusal repeated automatically is the same refusal at twice the cost.
 * Opening the page still offers the normal creation path.
 */
export type DraftPhase = "idle" | "queued" | "writing" | "done" | "failed"

/** One step the queue may draft, composed by the layout from stored columns. */
export interface DraftJob {
  stepId: string
  /** `creationPrompt(funnel, step, siblings)` — the same string the step page would send. */
  prompt: string
  /** The step's `doc_revision`, for the build route's optimistic lock. */
  revision: number
}

interface ContextValue extends ConnectionsState {
  /** Recompute one page's rows from the document the builder now holds. */
  publishStepConnections: (stepId: string, doc: SectionDoc | null) => void
  repair: Repair | null
  registerRepair: (repair: Repair | null) => void
  /** The document the builder currently holds, for the page it is editing. */
  docFor: (stepId: string) => SectionDoc | null
  /** Where a step's background draft is, or `"idle"` if it has none queued. */
  draftPhase: (stepId: string) => DraftPhase
  /** Draft every unbuilt step, one at a time, in the order the layout gave. */
  startAutoDraft: () => void
  /** Draft one named step, now. */
  draftStep: (stepId: string) => void
}

const ConnectionsContext = createContext<ContextValue | null>(null)

export interface ConnectionsProviderProps {
  funnelId: string
  funnelSlug: string
  funnelKind: string
  pages: RailPage[]
  /** Every page's document, as the server read it. Seeds the graph. */
  initialDocs: StepWithDoc[]
  /** Steps the background queue may draft, composed by the layout. */
  draftJobs?: DraftJob[]
  children: React.ReactNode
}

export function ConnectionsProvider({
  funnelId,
  funnelSlug,
  funnelKind,
  pages,
  initialDocs,
  draftJobs = [],
  children,
}: ConnectionsProviderProps) {
  const [docs, setDocs] = useState<StepWithDoc[]>(initialDocs)

  // Read by the draft queue's run loop below. `docs` itself is a value closed
  // over at whatever render created the callback that reads it — fine for
  // rendering, wrong for a loop that keeps running across many renders. This
  // ref is written SYNCHRONOUSLY inside `publishStepConnections`, not via a
  // `useEffect` mirror, so a document published a moment before
  // `startAutoDraft` runs is visible even if no render has committed in
  // between.
  const docsRef = useRef(docs)

  const publishStepConnections = useCallback((stepId: string, doc: SectionDoc | null) => {
    setDocs((current) => {
      const index = current.findIndex((entry) => entry.id === stepId)
      // A page this provider does not know about is ignored rather than
      // appended: the rail's rows come from the server's page list, and
      // inventing one here would draw a row for a page with no id to link to.
      if (index === -1) return current
      if (current[index].doc === doc) return current
      const next = current.slice()
      next[index] = { ...next[index], doc }
      docsRef.current = next
      return next
    })
  }, [])

  const [repair, setRepair] = useState<Repair | null>(null)

  // Recomputed from the documents rather than stored, so there is exactly one
  // definition of "what leads where" and the rail cannot drift from what the
  // publish gate will say about the same page.
  const connections = useMemo(() => funnelConnections(funnelSlug, docs), [funnelSlug, docs])

  const docFor = useCallback(
    (stepId: string) => docs.find((entry) => entry.id === stepId)?.doc ?? null,
    [docs],
  )

  // --------------------------------------------------------------------
  // Background draft queue — "i dont want to click the other one for it to
  // be generate". Steps 2..n draft themselves, one at a time, instead of
  // waiting for the owner to open each blank page.
  // --------------------------------------------------------------------

  const [phases, setPhases] = useState<Record<string, DraftPhase>>({})
  // Kept in step with `phases` so `draftStep`'s guard reads the current
  // value without re-creating the callback on every phase change.
  const phasesRef = useRef(phases)
  useEffect(() => {
    phasesRef.current = phases
  }, [phases])

  // A REF, not state. `startAutoDraft` is called from an effect in
  // `FunnelBuilder` that can legitimately re-run, and a state flag would not
  // be visible to the second call in the same tick — so the queue would run
  // twice, drafting every page over the top of itself at full model cost.
  const running = useRef(false)

  const setPhase = useCallback((stepId: string, phase: DraftPhase) => {
    setPhases((current) => (current[stepId] === phase ? current : { ...current, [stepId]: phase }))
  }, [])

  /**
   * Draft one step, and hand the finished document to the graph.
   *
   * Returns rather than throws. The queue below must survive one page
   * refusing — stranding every page behind it would be a worse failure than
   * the one it is reporting.
   */
  const runJob = useCallback(
    async (job: DraftJob): Promise<void> => {
      setPhase(job.stepId, "writing")
      try {
        const response = await fetch(`/api/admin/funnels/steps/${job.stepId}/build`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: job.prompt, revision: job.revision }),
        })
        const isStream = (response.headers.get("content-type") ?? "").includes("text/event-stream")
        if (!isStream || !response.ok) {
          setPhase(job.stepId, "failed")
          return
        }
        // The SAME reader the builder uses. A second implementation of the
        // framing would be a second thing to keep in step with the route.
        const outcome = await readTurnStream(response, () => {})
        if (outcome.type !== "result") {
          setPhase(job.stepId, "failed")
          return
        }
        const turn = outcome.review ?? outcome.turn
        const doc = turn.doc as SectionDoc | null
        // INTO THE GRAPH IMMEDIATELY, so the rail's arrows appear as the pages
        // are made rather than at the next refresh.
        publishStepConnections(job.stepId, doc)
        // `compile`, not `blocked` and not `doc`. `BuildTurnResponse.compile`
        // (`components/admin/funnels/builder/types.ts`) is already documented
        // as the single flag meaning "this turn produced no document": the
        // route returns it null on exactly two paths — the model declined
        // (`blocked`) and both attempts failed — and non-null on every path
        // that wrote a document, review turns included.
        //
        // `blocked` alone is wrong: the both-attempts-failed path also leaves
        // no document behind but reports `blocked: false`, so a `blocked`-only
        // check would call a transient model/API error "done" and paint a
        // green badge over a page that is still blank — the one page the
        // owner would then never open, with `failed` gone (it is terminal, so
        // never retried either).
        //
        // `doc` alone is wrong the other way: the refusal path emits
        // `doc: draft.doc`, the page as it ALREADY stood, not the page that
        // was asked for — so on a step that had something there before, a
        // nullness check alone reads a refusal as a success.
        setPhase(job.stepId, turn.compile === null ? "failed" : "done")
      } catch (error) {
        // Never takes the editor down. The owner came here to edit a page.
        console.error("[funnels/draft-queue] could not draft a step:", error)
        setPhase(job.stepId, "failed")
      }
    },
    [publishStepConnections, setPhase],
  )

  /**
   * Draft every unbuilt step, one at a time, in the order the layout gave.
   *
   * SEQUENTIAL, NOT PARALLEL, for two reasons that both bite: several
   * concurrent builds run straight into `SECTION_BUILDER_RATE_LIMIT_MAX`, and
   * step N is written knowing step N-1 exists — which is what makes the
   * prompt's "the full sequence is..." line and `resolveDoc`'s page list true
   * rather than aspirational.
   */
  const startAutoDraft = useCallback(() => {
    if (running.current || draftJobs.length === 0) return
    running.current = true
    for (const job of draftJobs) setPhase(job.stepId, "queued")
    void (async () => {
      for (const job of draftJobs) {
        // RUN-TIME CHECK, against the CURRENT graph — not the graph as it
        // stood when the layout computed `draftJobs`. On a brand-new
        // templated funnel, step 1 is a job here too (the layout has no way
        // to know it is about to be drafted from `initialPrompt`), and by the
        // time this line runs `FunnelBuilder` may already have published a
        // document for it. Re-drafting would cost nothing server-side (the
        // build route's revision check 409s before the model call) but would
        // flip a page the owner just watched succeed to a red "failed" badge.
        if (docsRef.current.find((entry) => entry.id === job.stepId)?.doc) {
          setPhase(job.stepId, "done")
          continue
        }
        await runJob(job)
      }
    })()
  }, [draftJobs, runJob, setPhase])

  /** One named step, now — the publish refusal's "Generate it now". */
  const draftStep = useCallback(
    (stepId: string) => {
      const job = draftJobs.find((entry) => entry.stepId === stepId)
      if (!job) return
      if (phasesRef.current[stepId] === "writing" || phasesRef.current[stepId] === "queued") return
      void runJob(job)
    },
    [draftJobs, runJob],
  )

  const draftPhase = useCallback((stepId: string): DraftPhase => phases[stepId] ?? "idle", [phases])

  const value = useMemo<ContextValue>(
    () => ({
      connections,
      pages,
      funnelId,
      funnelSlug,
      funnelKind,
      publishStepConnections,
      repair,
      registerRepair: setRepair,
      docFor,
      draftPhase,
      startAutoDraft,
      draftStep,
    }),
    [
      connections,
      pages,
      funnelId,
      funnelSlug,
      funnelKind,
      publishStepConnections,
      repair,
      docFor,
      draftPhase,
      startAutoDraft,
      draftStep,
    ],
  )

  return <ConnectionsContext.Provider value={value}>{children}</ConnectionsContext.Provider>
}

/**
 * The graph, or `null` outside a provider.
 *
 * NULLABLE ON PURPOSE. `FunnelBuilder` renders under this provider in the
 * funnel and landing-page routes, and standalone in tests and in the draft
 * preview harness. A hook that threw would make the builder untestable in
 * isolation, so every consumer degrades instead — the picker offers no pages,
 * and the rail is simply not on screen.
 */
export function useConnections(): ContextValue | null {
  return useContext(ConnectionsContext)
}

/**
 * The callback the builder calls whenever its document changes.
 *
 * A no-op outside a provider, for the reason above.
 */
export function usePublishStepConnections(): (stepId: string, doc: SectionDoc | null) => void {
  const context = useContext(ConnectionsContext)
  return useMemo(
    () => context?.publishStepConnections ?? (() => {}),
    [context],
  )
}

/**
 * The draft queue, or inert no-ops outside a provider.
 *
 * Same contract as `usePublishStepConnections`: `FunnelBuilder` renders under
 * this provider in the funnel route and standalone in tests and the preview
 * harness, so a hook that threw would make the builder untestable in isolation.
 * `draftPhase` answering "idle" everywhere means the builder behaves exactly as
 * it did before this feature.
 */
export function useDraftQueue(): Pick<ContextValue, "draftPhase" | "startAutoDraft" | "draftStep"> {
  const context = useContext(ConnectionsContext)
  return useMemo(
    () => ({
      draftPhase: context?.draftPhase ?? (() => "idle" as DraftPhase),
      startAutoDraft: context?.startAutoDraft ?? (() => {}),
      draftStep: context?.draftStep ?? (() => {}),
    }),
    [context],
  )
}

/**
 * The builder tells the rail how to write to the page it is holding.
 *
 * The rail cannot write on its own: `PUT .../edit` checks a revision, and the
 * layout holds documents but no revisions. The builder has both, so it lends
 * the rail its writer for the one page it is editing — and takes it back on
 * unmount, so a stale writer can never be aimed at a page that is no longer
 * open.
 */
export function useRegisterRepair(
  stepId: string,
  apply: (ops: SectionOp[]) => void | Promise<void>,
): void {
  const context = useContext(ConnectionsContext)
  const register = context?.registerRepair
  useEffect(() => {
    if (!register) return
    register({ stepId, apply })
    return () => register(null)
  }, [register, stepId, apply])
}
