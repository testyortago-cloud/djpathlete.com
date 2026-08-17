import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { updateFunnelSchema } from "@/lib/validators/funnel"
import { getFunnelById, updateFunnel, deleteFunnel, listSteps } from "@/lib/db/funnels"

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await ctx.params
  try {
    const funnel = await getFunnelById(id)
    if (!funnel) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ funnel, steps: await listSteps(id) })
  } catch (error) {
    console.error("[GET /api/admin/funnels/:id]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(
  { action: "funnel.updated", category: "admin_write" },
  async (request, ctx) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params

    const body = await request.json().catch(() => null)
    const parsed = updateFunnelSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    try {
      /**
       * THIS ROUTE DOES NOT PUBLISH A FUNNEL. It never did more than flip
       * `funnels.status` — see `steps/[stepId]/publish/route.ts`'s header for
       * the same shape of defect on that route, fixed the same way: a direct
       * POST there once skipped every gate the UI ran, and published a page
       * with dead buy buttons. Here the UI-only guard is `FunnelStatusControl`
       * and `FunnelGoLiveButton` routing `kind === "funnel"` through
       * `POST .../publish` instead of this PATCH — but a body-level check the
       * browser happens to make is not a guard, it is a request for one, and a
       * direct `PATCH {"status":"published"}` on a funnel row would reproduce
       * the exact "funnel published, pages are not" split this branch exists
       * to eliminate.
       *
       * ONLY `kind === "funnel"` IS REFUSED, and only for `status: "published"`.
       * A landing page (`kind === "page"`) legitimately publishes through this
       * body — its one step is already gated by the step publish route, which
       * is what flips a page's row live — so it is let through unchanged.
       * Unpublishing and archiving are also let through for both kinds: taking
       * something off the air has nothing to gate, and refusing to hide a
       * broken funnel because it is broken would be exactly backwards.
       *
       * 400, not 422: this is not `updateFunnelSchema` failing to parse a
       * shape (that path already returns 400 above) and not the publish
       * route's own gate refusing a document it inspected (that is 422,
       * reserved for a request this route never receives). It is a
       * well-formed, schema-valid body that is not a legal operation on THIS
       * route for THIS row — the same class of refusal
       * `[id]/publish/route.ts` gives a funnel with no pages, which is also a
       * 400 in this file family, not a 403 (nothing about who is asking) or a
       * 409 (nothing here conflicts with concurrent state).
       */
      if (parsed.data.status === "published") {
        const funnel = await getFunnelById(id)
        if (!funnel) return NextResponse.json({ error: "Not found" }, { status: 404 })
        if (funnel.kind === "funnel") {
          return NextResponse.json(
            {
              error:
                "A funnel is published as a whole. Use POST /api/admin/funnels/:id/publish, which gates every page before any of them go live.",
            },
            { status: 400 },
          )
        }
      }

      return NextResponse.json({ funnel: await updateFunnel(id, parsed.data) })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      if (message.includes("duplicate") || message.includes("unique")) {
        return NextResponse.json({ error: "That slug is already in use." }, { status: 409 })
      }
      console.error("[PATCH /api/admin/funnels/:id]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)

export const DELETE = withAudit(
  { action: "funnel.deleted", category: "admin_write" },
  async (_request, ctx) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params
    try {
      await deleteFunnel(id)
      return NextResponse.json({ ok: true })
    } catch (error) {
      console.error("[DELETE /api/admin/funnels/:id]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
