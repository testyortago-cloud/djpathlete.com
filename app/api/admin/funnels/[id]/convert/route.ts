// app/api/admin/funnels/[id]/convert/route.ts — moving one row between the
// Landing pages board and the Funnels board.
//
// ---------------------------------------------------------------------------
// WHY THIS IS ITS OWN ROUTE, AND NOT `kind` BACK IN THE PATCH BODY.
// ---------------------------------------------------------------------------
// Until 2026-08-31, conversion WAS a field in `PATCH /api/admin/funnels/[id]`.
// That made `kind` a door in the publish guard, because the same route lets a
// PAGE go live through a plain `{status:"published"}` while a FUNNEL must go
// through `POST .../publish` and its three gates. Two requests walked through
// it: demote a four-page funnel whose pages were never built, then publish the
// "page". The result is a live funnel whose own buttons 404 — precisely the
// state `[id]/publish/route.ts` exists to prevent.
//
// The owner's fix was to delete conversion outright. He has since asked for it
// back on both boards. Putting `kind` back in the PATCH body would put the
// conversion and the publish in one handler again, where the only thing
// keeping them apart is the order two `if`s happen to run in — a guard by
// coincidence. So conversion gets its own verb here, and PATCH keeps refusing
// any body that so much as NAMES `kind`. `patch-route.test.ts` still owns that
// half and did not change.
//
// ---------------------------------------------------------------------------
// ONE GUARD, DOING TWO JOBS — WHICH IS WHY THERE IS ONLY ONE.
// ---------------------------------------------------------------------------
// A funnel may become a landing page ONLY when it has exactly one step.
//
//   1. It is what stops pages vanishing. `/admin/pages` draws a row as a
//      single card and a landing page HAS NO DETAIL SCREEN — `/admin/pages/<id>`
//      redirects to the list. Demoting a five-page funnel destroys nothing and
//      makes four pages unreachable from the admin, which the owner would meet
//      as "my funnel deleted my pages".
//
//   2. It also denies the old bypass its ingredient. The exploit needed UNBUILT
//      SIBLINGS to smuggle live, and a one-page funnel has none — so at the
//      moment of conversion the demoted row is a landing page in every respect:
//      same one step, same `/go/<slug>`, same publish gate.
//
// BUT THIS CHECK IS POINT-IN-TIME, AND ON ITS OWN IT DOES NOT HOLD. `kind` is
// stored, not derived (migration 00205 says so), and nothing in the schema
// enforces one step per page. Review of this branch found the sequel: convert
// to a page, then `POST /api/admin/funnels/steps` three times — that route used
// to read the funnel only to 404 — and the row is a four-page "landing page"
// which `steps/[stepId]/publish` will take LIVE as a side effect of publishing
// one step. The invariant is therefore held by TWO guards, and the other one
// lives in `app/api/admin/funnels/steps/route.ts`, which now refuses a
// `kind === "page"` parent. Neither may be removed alone.
//
// Nor is this one atomic: the count is read and then the write happens, with no
// constraint underneath, so two concurrent admin writers can still produce a
// two-step page. Recoverable rather than guarded — do not call it airtight.
//
// Promotion (`page -> funnel`) is deliberately UNGUARDED: one step is a legal
// funnel — `createFunnel` makes exactly that shape — and gaining a board that
// can show more pages takes nothing away.
//
// ---------------------------------------------------------------------------
// `status` IS PRESERVED, NOT RESET.
// ---------------------------------------------------------------------------
// Safe for the same reason the guard is sufficient: after conversion the row
// has the same single step with the same published version, so `/go/<slug>`
// serves byte-for-byte what it served a moment earlier. Forcing a live page
// back to `draft` would take a working page off the air as a side effect of
// filing it on a different board, which is not what the owner asked for and
// would be discovered as an outage.
//
// TENANCY: `funnels` has no `business_id` column, so there is no predicate to
// apply here — this route is exactly as tenant-scoped as every other funnel
// admin route, which is to say by `canAccessAdminPath` alone. That is a known
// gap belonging to the tenancy work, not something this route can fix; it is
// named rather than silently inherited.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { convertFunnelSchema } from "@/lib/validators/funnel"
import { getFunnelById, updateFunnel, listSteps } from "@/lib/db/funnels"

export const POST = withAudit(
  {
    action: "funnel.converted",
    category: "admin_write",
    // NAMED, not just identified. `withAudit` runs this AFTER the handler, so
    // the read below sees the row as it now stands — and `name` is not what
    // changed, so it is the same name either way. The extra round trip is worth
    // it on an action this rare: without a label the log reads
    // "funnel 69418ea3-…", and "where did my landing page go" is the exact
    // question this slug exists to answer.
    target: async (_request, context) => {
      const { id } = await (context as { params: Promise<{ id: string }> }).params
      // The id is the part that must survive. A failed name lookup degrades to
      // an unlabelled row rather than throwing — `withAudit` catches a throw
      // here into `target = undefined`, which would lose the id as well.
      const funnel = await getFunnelById(id).catch(() => null)
      return funnel ? { type: "funnel", id, label: funnel.name } : { type: "funnel", id }
    },
    // READ OFF THE RESPONSE, not the request body. The request says what was
    // asked for; only the response says what happened — a no-op and a real
    // conversion send the identical body, and logging the request would record
    // a conversion for the one that changed nothing.
    metadata: async (_request, response) => {
      const body = (await response.json().catch(() => null)) as {
        converted?: { from: string; to: string }
      } | null
      return body?.converted ? { kind: body.converted } : {}
    },
  },
  async (request, ctx) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await ctx.params
    const parsed = convertFunnelSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Say which one you want: {"to":"page"} or {"to":"funnel"}.' }, { status: 400 })
    }
    const to = parsed.data.to

    try {
      const funnel = await getFunnelById(id)
      if (!funnel) return NextResponse.json({ error: "Not found" }, { status: 404 })

      // ALREADY THERE. Answered 200 rather than 400 because nothing is wrong:
      // two clicks on a stale card, or a retry, must not read as a failure.
      // It writes nothing, so no audit row claims a conversion that did not
      // happen — `metadata` above returns {} for exactly this response.
      if (funnel.kind === to) {
        return NextResponse.json({ funnel })
      }

      // ONLY ON THE WAY DOWN, and the steps are not read on the way up. See the
      // header: promotion has nothing to count.
      if (to === "page") {
        const steps = await listSteps(id)
        if (steps.length !== 1) {
          return NextResponse.json(
            {
              error:
                steps.length === 0
                  ? "This funnel has no pages. A landing page is one page — build its page first."
                  : `This funnel has ${steps.length} pages. A landing page is just one page, so ` +
                    `remove the extra pages first and then convert it.`,
            },
            { status: 400 },
          )
        }
      }

      const updated = await updateFunnel(id, { kind: to })
      return NextResponse.json({ funnel: updated, converted: { from: funnel.kind, to } })
    } catch (error) {
      console.error("[POST /api/admin/funnels/:id/convert]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
