// components/admin/funnels/own-examples.ts — the owner's own funnels, for the
// examples modal.
//
// NOT A `"use client"` MODULE, AND THAT IS THE POINT. This body is shared by
// both boards: `FunnelBoard` (the landing-pages screen, which holds its rows
// flattened as pages) and `FunnelList` (the funnels screen, which holds them
// grouped). It used to live in `FunnelBoard` itself — so importing it from
// `FunnelList` dragged all ~390 lines of the board, including the chips and the
// card it no longer renders, into the funnels page's bundle.
//
// It has no JSX, no hooks and no state; only the `OwnExample` TYPE comes from a
// component, and a type-only import is erased at compile time.

import type { OwnExample } from "./ExamplesDialog"
import type { Funnel, FunnelStep } from "@/types/database"

/**
 * One example per funnel, longest first.
 *
 * `stepNames` is sorted by `position` rather than taken as given: the caller's
 * array order is not the funnel's order, and an example that lists a funnel's
 * steps out of sequence teaches the wrong shape.
 */
export function ownExamplesFromGroups(groups: { funnel: Funnel; steps: FunnelStep[] }[]): OwnExample[] {
  return groups
    .map(({ funnel, steps }) => ({
      id: funnel.id,
      name: funnel.name,
      template: funnel.template ?? null,
      stepNames: [...steps].sort((a, b) => a.position - b.position).map((step) => step.name),
      live: funnel.status === "published",
    }))
    .sort((a, b) => b.stepNames.length - a.stepNames.length)
}
