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

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import {
  funnelConnections,
  type FunnelConnections,
  type StepWithDoc,
} from "@/lib/funnels/connections"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import type { SectionOp } from "@/lib/funnels/sections/apply"

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

interface ContextValue extends ConnectionsState {
  /** Recompute one page's rows from the document the builder now holds. */
  publishStepConnections: (stepId: string, doc: SectionDoc | null) => void
  repair: Repair | null
  registerRepair: (repair: Repair | null) => void
  /** The document the builder currently holds, for the page it is editing. */
  docFor: (stepId: string) => SectionDoc | null
}

const ConnectionsContext = createContext<ContextValue | null>(null)

export interface ConnectionsProviderProps {
  funnelId: string
  funnelSlug: string
  funnelKind: string
  pages: RailPage[]
  /** Every page's document, as the server read it. Seeds the graph. */
  initialDocs: StepWithDoc[]
  children: React.ReactNode
}

export function ConnectionsProvider({
  funnelId,
  funnelSlug,
  funnelKind,
  pages,
  initialDocs,
  children,
}: ConnectionsProviderProps) {
  const [docs, setDocs] = useState<StepWithDoc[]>(initialDocs)

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
    }),
    [connections, pages, funnelId, funnelSlug, funnelKind, publishStepConnections, repair, docFor],
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
