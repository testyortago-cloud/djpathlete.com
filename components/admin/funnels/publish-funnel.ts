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
// refuses. `FunnelBuilder` does NOT use `publishFunnel` itself: it has a
// transcript to write the refusal into, one page problem per row with a link to
// each page's editor, which is strictly more than a toast can carry. It DOES
// use the two sentence helpers below, for the reason they exist — a sentence
// with three renderings is a sentence nobody can change.

import type { PagePublishProblem } from "@/lib/funnels/publish-plan"

/** What the route wrote. */
export interface FunnelPublished {
  ok: true
  published: number
  /**
   * What the compiler changed on the way — an embed it stripped, a style it
   * could not carry.
   *
   * NOT DISCARDED. The route produces these deliberately (`route.ts:216`
   * collects `result.warnings` per page), and both toast surfaces used to drop
   * them on the floor — "collected and then ignored" is this path's own
   * recorded failure, twice over. `publishedSummary` appends them.
   */
  warnings: string[]
}

/** Why nothing was published — already worded for the owner. */
export interface FunnelRefused {
  ok: false
  message: string
}

/**
 * IS THIS `error` STRING WRITTEN FOR THE OWNER, OR FOR A DEVELOPER?
 *
 * A route's `error` is only owner-facing on the statuses whose whole job is to
 * explain a refusal in the domain's own words — 400 (the body was wrong) and
 * 422 (the gate refused, and the message names the page). Everything else is
 * infrastructure talking: `auth()` on an expired 24-hour session returns
 * `{error: "Forbidden"}`, and passing that through meant the owner pressed
 * Publish and read a toast saying **"Forbidden"**. The path this replaced said
 * "Could not change the status."
 *
 * Exported because `FunnelBuilder` has the same body-shaped hole on its own
 * fetch and must answer it the same way.
 */
export function ownerFacingError(status: number, error: string | undefined, fallback: string): string {
  if (status !== 400 && status !== 422) return fallback
  return error ?? fallback
}

/**
 * The 422 body, turned into one sentence that NAMES THE PAGES.
 *
 * "This funnel could not be published" on its own sends the owner to open all
 * four pages to find the one that is wrong, which is the same
 * `silent_gate_reads_as_broken` failure in a different costume.
 */
function refusalMessage(status: number, error: string | undefined, pages: PagePublishProblem[]): string {
  const headline = ownerFacingError(
    status,
    error,
    pages.length === 0 ? "Could not publish this funnel." : "This funnel could not be published.",
  )
  if (pages.length === 0) return headline
  const named = pages.map((page) => `${page.stepName}: ${page.problems.join(" ")}`).join(" ")
  return `${headline} ${named}`
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
      return {
        ok: false,
        message: refusalMessage(response.status, body?.error, (body?.pages ?? []) as PagePublishProblem[]),
      }
    }
    // `pages` IS READ ON THE 422 PATH ONLY, and is deliberately absent from
    // `FunnelPublished`. The 200's rows carry `{stepId, stepName, version}`,
    // which only a surface that renders per-page state can use — the two
    // callers here are single toasts, and `FunnelBuilder` narrows the rows
    // itself off its own fetch. Carrying a field no reader reads is how this
    // path has twice shipped a column nobody consumed.
    return {
      ok: true,
      published: body?.published ?? 0,
      warnings: body?.warnings ?? [],
    }
  } catch {
    return { ok: false, message: "Could not publish this funnel. The live funnel is unchanged." }
  }
}

/**
 * "Published 3 pages. The funnel is live."
 *
 * THE ONE PLACE THIS SENTENCE IS WRITTEN. Three surfaces report the same
 * publish — the funnel detail control, the board's Go live, and the builder's
 * toast and result strip — and a literal inlined in any of them is a wording
 * the next change silently leaves behind.
 *
 * `warnings` is appended rather than dropped: it is what the compiler CHANGED
 * on the way, the route sends it on every 200, and a caller with nowhere else
 * to put it must not simply lose it. A caller that renders the warnings itself
 * — `FunnelBuilder`'s result strip lists them under the headline — passes none.
 */
export function publishedSummary(published: number, warnings: string[] = []): string {
  const sentence = `Published ${published} page${published === 1 ? "" : "s"}. The funnel is live.`
  return warnings.length === 0 ? sentence : `${sentence} ${warnings.join(" ")}`
}
