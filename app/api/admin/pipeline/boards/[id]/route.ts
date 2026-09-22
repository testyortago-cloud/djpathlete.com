// app/api/admin/pipeline/boards/[id]/route.ts — renames a board and/or
// flips its status. Body: { name?: string; status?: "active" | "archived" }.
// Same shape as app/api/admin/pipeline/move/route.ts (withAudit, auth,
// canAccessAdminPath, resolveAdminTenantForRequest with the
// NoAccessibleBusinessError -> 403 branch).
//
// updatePipelineBoard (lib/db/pipeline.ts, Task 3) refuses to archive the
// board every unrouted event falls back to (DEFAULT_PIPELINE_KEY) — that
// refusal is a readable Error, surfaced here as a 400, not a 500.
//
// Fix round 1, Finding 1 (controller ruling R10): a `pipelineId` that does
// not resolve for this business — wrong id, or another tenant's board —
// throws `PipelineBoardNotFoundError` from the DAL and is surfaced as 404,
// NOT 400. Both causes get the exact same status and message; telling them
// apart here (404 vs 403) would let a caller learn which board ids exist on
// OTHER tenants by comparing responses.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { PipelineBoardNotFoundError, readBoardRow, updatePipelineBoard } from "@/lib/db/pipeline"
// Type-only, so the closed audit taxonomy is checked at compile time — a
// slug that is not a row in `AUDIT_ACTIONS` stops the build instead of
// writing a row the log viewer cannot name. Same convention as
// app/api/ask/route.ts and lib/lead-engine/chat/escalate.ts.
import type { AuditAction } from "@/lib/audit/actions"

const MAX_NAME_LENGTH = 200

const BOARD_UPDATED_AUDIT_ACTION: AuditAction = "pipeline.board_updated"

/**
 * The internal channel the handler hands the board's PREVIOUS name and status
 * to the audit callbacks on — the two facts that stop existing the moment the
 * UPDATE lands, so nothing downstream can recover them.
 *
 * `x-audit-` prefix is load-bearing: `stripAuditHeaders` (lib/audit/with-audit.ts)
 * deletes every header carrying it AFTER the callbacks have read them, so
 * neither value reaches the browser. URI-encoded because a board name is free
 * text and `Headers.set` throws on anything outside latin-1 — one accented
 * character in a board name would otherwise turn a successful rename into a
 * 500.
 */
const AUDIT_PREVIOUS_NAME_HEADER = "x-audit-previous-name"
const AUDIT_PREVIOUS_STATUS_HEADER = "x-audit-previous-status"

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
    action: BOARD_UPDATED_AUDIT_ACTION,
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
    // WHAT CHANGED, not merely which board (whole-branch review, Important
    // 5). This row used to carry a board id and — only when the body happened
    // to include a `name` — a label. An ARCHIVE sends `{status:"archived"}`
    // and no name, so "who archived Camps & Clinics" answered with a bare
    // uuid: no label, no status, nothing saying the board was archived at
    // all rather than renamed.
    //
    // Reads the ORIGINAL request, which is safe HERE and would not be on the
    // sibling routes: this route's `target` resolver above takes the id from
    // `ctx.params` and never touches the request, and the handler parses a
    // CLONE — so the original body is still unread by the time `withAudit`
    // calls this. The previous name and status cannot come from the request
    // at all (they are what the request is replacing), so they arrive on the
    // headers above.
    metadata: async (request, response) => {
      const meta: Record<string, unknown> = {}
      try {
        const body = (await request.json()) as Record<string, unknown> | null
        if (body && typeof body === "object") {
          meta.fields = Object.keys(body)
          if (typeof body.status === "string") meta.status = body.status
        }
      } catch {
        /* an unparseable or already-consumed body costs the fields, not the row */
      }
      const previousName = response.headers.get(AUDIT_PREVIOUS_NAME_HEADER)
      if (previousName) meta.previous_name = decodeURIComponent(previousName)
      const previousStatus = response.headers.get(AUDIT_PREVIOUS_STATUS_HEADER)
      if (previousStatus) meta.previous_status = previousStatus
      return meta
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

    // READ BEFORE THE WRITE, FOR THE AUDIT ROW ONLY — see the `metadata`
    // callback above. This is deliberately NOT a gate: a null here is left
    // alone and `updatePipelineBoard` below is still the one place a
    // nonexistent or foreign-tenant board is refused, because duplicating an
    // existence check into this route is precisely what controller ruling
    // R10 argued against. It is also why a failure to read is swallowed: the
    // rename or archive must not fail over a label lookup.
    const previous = await readBoardRow(id, businessId).catch(() => null)

    try {
      await updatePipelineBoard({
        pipelineId: id,
        businessId,
        name: parsed.data.name,
        status: parsed.data.status,
      })
    } catch (err) {
      // `PipelineBoardNotFoundError` covers BOTH a nonexistent id and a
      // foreign tenant's board — same status, same message, on purpose (see
      // the header comment). Every other DAL refusal ("every unrouted event
      // falls back to…", a duplicate constraint) is a readable Error and
      // surfaces as 400, not 500.
      if (err instanceof PipelineBoardNotFoundError) {
        return NextResponse.json({ error: err.message }, { status: 404 })
      }
      const message = err instanceof Error ? err.message : "Failed to update board"
      return NextResponse.json({ error: message }, { status: 400 })
    }

    // The board's name AFTER the update — the submitted one on a rename, the
    // unchanged one on an archive. Always present when the board could be
    // read, so the audit target carries a human label on every successful
    // PATCH rather than only on a rename.
    const nameAfter = parsed.data.name ?? previous?.name
    const response = NextResponse.json({
      ok: true,
      board: { id, ...(nameAfter !== undefined ? { name: nameAfter } : {}) },
    })
    if (previous) {
      response.headers.set(AUDIT_PREVIOUS_NAME_HEADER, encodeURIComponent(previous.name))
      response.headers.set(AUDIT_PREVIOUS_STATUS_HEADER, previous.status)
    }
    return response
  },
)
