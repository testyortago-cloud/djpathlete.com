// PUT /api/admin/funnels/steps/[stepId]/tree — save the visual builder's draft.
//
// The FIRST write path into a funnel document that does not go through the
// model. `applyOps` has only ever been reachable from the AI build route, which
// meant every document change cost a paid model turn. Dragging a button four
// pixels should not.
//
// `revision` IS REQUIRED AND IS THE OPTIMISTIC LOCK, for the same reason the
// build route demands one: a PageTree is a full snapshot, so a lost update is
// not a merge conflict, it is a page silently reverting to whatever the other
// tab had. The DAL makes the check part of the write and reports
// `stale_revision`, which becomes a 409 here so the client re-syncs.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { pageTreeSchema } from "@/lib/funnels/tree/schema"
import { savePageTree } from "@/lib/db/funnel-page-tree"
import type { PageTree } from "@/lib/funnels/tree/types"

const bodySchema = z.object({
  tree: pageTreeSchema,
  revision: z.number().int().min(0),
})

export const PUT = withAudit(
  { action: "funnel.updated", category: "admin_write" },
  async (request, ctx: { params: Promise<{ stepId: string }> }) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { stepId } = await ctx.params
    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      )
    }

    try {
      const result = await savePageTree(
        stepId,
        parsed.data.tree as PageTree,
        parsed.data.revision,
      )

      if (!result.ok) {
        if (result.reason === "not_found") {
          return NextResponse.json({ error: "Not found" }, { status: 404 })
        }
        // 409, with the current revision, so the client can tell the owner what
        // happened and reload rather than retrying blind and clobbering.
        return NextResponse.json(
          {
            error: "This page changed in another tab. Reload before saving again.",
            code: "stale_revision",
            currentRevision: result.currentRevision,
          },
          { status: 409 },
        )
      }

      return NextResponse.json({ revision: result.revision })
    } catch (error) {
      console.error("[PUT /api/admin/funnels/steps/:id/tree]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
