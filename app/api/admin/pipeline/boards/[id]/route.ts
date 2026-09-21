// app/api/admin/pipeline/boards/[id]/route.ts — renames a board and/or
// flips its status. Body: { name?: string; status?: "active" | "archived" }.
// Same shape as app/api/admin/pipeline/move/route.ts (withAudit, auth,
// canAccessAdminPath, resolveAdminTenantForRequest with the
// NoAccessibleBusinessError -> 403 branch).
//
// updatePipelineBoard (lib/db/pipeline.ts, Task 3) refuses to archive the
// board every unrouted event falls back to (DEFAULT_PIPELINE_KEY) — that
// refusal is a readable Error, surfaced here as a 400, not a 500.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { updatePipelineBoard } from "@/lib/db/pipeline"

const MAX_NAME_LENGTH = 200

const UpdateBoardSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Board name is required.")
      .max(MAX_NAME_LENGTH, `Board name must be ${MAX_NAME_LENGTH} characters or fewer.`)
      .optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .refine((data) => data.name !== undefined || data.status !== undefined, {
    message: "Provide a name or a status to update.",
  })

export const PATCH = withAudit(
  {
    action: "pipeline.board_updated",
    category: "admin_write",
    // The board's id comes from the URL (ctx.params), not the body, so —
    // unlike boards/route.ts's POST — this target never needs to read the
    // request at all: it resolves on ctx.params alone and only reaches for
    // the RESPONSE (a clone `withAudit` hands it, safe to consume) to add a
    // human label when the write actually landed.
    target: async (_request, ctx, response) => {
      const { id } = await ctx.params
      if (!response) return { type: "pipeline_board", id }
      try {
        const body = (await response.json()) as { board?: { name?: string } }
        return { type: "pipeline_board", id, ...(body.board?.name ? { label: body.board.name } : {}) }
      } catch {
        return { type: "pipeline_board", id }
      }
    },
  },
  async (request, ctx) => {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (!(await canAccessAdminPath(session.user, request))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    let businessId: string
    try {
      ;({ businessId } = await resolveAdminTenantForRequest(request))
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      throw err
    }

    const { id } = await ctx.params

    // A CLONE, so the request is available for the `target` resolver above —
    // it does not read it today (ctx.params already names the board), but the
    // convention is kept identical to every other route in this directory so
    // a future field-dependent label does not have to remember to switch it.
    const body = await request.clone().json().catch(() => null)
    const parsed = UpdateBoardSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return NextResponse.json(
        {
          error: issue?.message ?? "Invalid request body.",
          ...(issue && issue.path.length > 0 ? { field: issue.path.join(".") } : {}),
        },
        { status: 400 },
      )
    }

    try {
      await updatePipelineBoard({
        pipelineId: id,
        businessId,
        name: parsed.data.name,
        status: parsed.data.status,
      })
    } catch (err) {
      // Readable DAL refusal ("every unrouted event falls back to…", board
      // not found for this business) — surfaced, not swallowed into a 500.
      const message = err instanceof Error ? err.message : "Failed to update board"
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      board: { id, ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}) },
    })
  },
)
