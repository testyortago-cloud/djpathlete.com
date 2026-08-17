// components/admin/funnels/publish-funnel.ts — ONE funnel-publish operation,
// three doorways.
//
// Taking a funnel live used to be `PATCH /api/admin/funnels/[id]` with
// `{status:"published"}` — a route that validates a body and writes, without
// reading a single step. It will therefore mark a funnel published while three
// of its four pages have never been built, producing a live funnel whose own
// buttons 404. That write was reachable from THREE places: the builder's
// primary Publish, the funnel detail page's `FunnelStatusControl`, and the
// board's `FunnelGoLiveButton`. A guard on two of the three is not a guard.
//
// `POST /api/admin/funnels/[id]/publish` gates every page first and flips the
// funnel row last. This module is the client half of that call, shared so that
// the two toast-only surfaces cannot drift apart in what they say when it
// refuses. `FunnelBuilder` deliberately does NOT use it: it has a transcript to
// write the refusal into, one page problem per row with a link to each page's
// editor, which is strictly more than a toast can carry.

import type { PagePublishProblem } from "@/lib/funnels/publish-plan"

/** What the route wrote, page by page. */
export interface FunnelPublished {
  ok: true
  published: number
  pages: { stepId: string; stepName: string; version: number }[]
  warnings: string[]
}

/** Why nothing was published — already worded for the owner. */
export interface FunnelRefused {
  ok: false
  message: string
}

/**
 * The 422 body, turned into one sentence that NAMES THE PAGES.
 *
 * "This funnel could not be published" on its own sends the owner to open all
 * four pages to find the one that is wrong, which is the same
 * `silent_gate_reads_as_broken` failure in a different costume.
 */
function refusalMessage(error: string | undefined, pages: PagePublishProblem[]): string {
  if (pages.length === 0) return error ?? "Could not publish this funnel."
  const named = pages.map((page) => `${page.stepName}: ${page.problems.join(" ")}`).join(" ")
  return `${error ?? "This funnel could not be published."} ${named}`
}

/**
 * Publish every page of a funnel and take the funnel live, or refuse.
 *
 * NEVER THROWS, and never reports a success it did not get: both callers are
 * buttons whose label is the owner's only evidence of what happened, and a
 * label flipped to "Take offline" over a funnel still in draft is the same
 * class of lie as a badge reading "published" over a URL that 404s.
 */
export async function publishFunnel(funnelId: string): Promise<FunnelPublished | FunnelRefused> {
  try {
    const response = await fetch(`/api/admin/funnels/${funnelId}/publish`, { method: "POST" })
    const body = (await response.json().catch(() => null)) as {
      published?: number
      /**
       * ONE KEY, TWO SHAPES, AND THE STATUS TELLS THEM APART. On a 200 the
       * route sends `{stepId, stepName, version}` per page it wrote; on a 422
       * it sends `PagePublishProblem` per page it refused. `unknown[]` so
       * neither branch can read the other's fields by accident.
       */
      pages?: unknown[]
      warnings?: string[]
      error?: string
    } | null

    if (!response.ok) {
      return { ok: false, message: refusalMessage(body?.error, (body?.pages ?? []) as PagePublishProblem[]) }
    }
    return {
      ok: true,
      published: body?.published ?? 0,
      pages: (body?.pages ?? []) as FunnelPublished["pages"],
      warnings: body?.warnings ?? [],
    }
  } catch {
    return { ok: false, message: "Could not publish this funnel. The live funnel is unchanged." }
  }
}

/** "Published 3 pages. The funnel is live." */
export function publishedSummary(published: number): string {
  return `Published ${published} page${published === 1 ? "" : "s"}. The funnel is live.`
}
