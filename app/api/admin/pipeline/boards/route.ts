// app/api/admin/pipeline/boards/route.ts — creates a new pipeline board.
// Body: { name: string }. Mirrors app/api/admin/pipeline/move/route.ts's
// shape (withAudit, auth, canAccessAdminPath, resolveAdminTenantForRequest
// with the NoAccessibleBusinessError -> 403 branch), NOT the two-role
// hardcode the older routes in this directory started from — `/api/admin/
// pipeline` is mapped to the staff-grantable `contacts` permission, so a
// coach can create a board of their own.
//
// createPipelineBoard (lib/db/pipeline.ts, Task 3) does the actual writing
// and already seeds the mandatory won/lost stages and gives a readable
// refusal for a duplicate key or a symbols-only name — this route surfaces
// that refusal as a 400, not a 500.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { createPipelineBoard } from "@/lib/db/pipeline"
// Type-only, so the closed audit taxonomy is checked at compile time — a
// slug that is not a row in `AUDIT_ACTIONS` stops the build instead of
// writing a row the log viewer cannot name. Same convention as
// app/api/ask/route.ts and lib/lead-engine/chat/escalate.ts.
import type { AuditAction } from "@/lib/audit/actions"

const MAX_NAME_LENGTH = 200

const BOARD_CREATED_AUDIT_ACTION: AuditAction = "pipeline.board_created"

const CreateBoardSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Board name is required.")
    .max(MAX_NAME_LENGTH, `Board name must be ${MAX_NAME_LENGTH} characters or fewer.`),
})

export const POST = withAudit(
  {
    action: BOARD_CREATED_AUDIT_ACTION,
    category: "admin_write",
    // Reads the ORIGINAL (still-unconsumed) request — the handler below
    // parses a CLONE of it, so this is the first real read regardless of
    // which branch the handler took, including the 401/403/400 paths. A
    // created board's id only exists once `createPipelineBoard` has run, so
    // this falls back to a name-only read on every path that never reached
    // it, and only resolves a full target (with id) off the RESPONSE on a
    // genuine 200. Same split as pipeline/move/route.ts — see its header for
    // why getting request/request.clone() backwards silently loses the
    // target.
    target: async (request, _ctx, response) => {
      const body = (await request.json().catch(() => null)) as { name?: unknown } | null
      const name = typeof body?.name === "string" ? body.name : undefined
      if (!response) return undefined
      try {
        const respBody = (await response.json()) as { board?: { id?: string; key?: string; name?: string } }
        return respBody.board?.id
          ? { type: "pipeline_board", id: respBody.board.id, label: respBody.board.name ?? name }
          : undefined
      } catch {
        return undefined
      }
    },
  },
  async (request) => {
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

    // A CLONE — see the `target` resolver's comment above for why: it reads
    // the original request after this handler returns, and a body can only
    // be read once.
    const body = await request.clone().json().catch(() => null)
    const parsed = CreateBoardSchema.safeParse(body)
    if (!parsed.success) {
      // Repo trap: a bare "Invalid request body" hides WHICH field failed —
      // a `.max()` rejects the whole payload with a message that reads like
      // every other field failed too. Name the field explicitly.
      const issue = parsed.error.issues[0]
      return NextResponse.json(
        { error: issue?.message ?? "Invalid request body.", field: issue?.path.join(".") || "name" },
        { status: 400 },
      )
    }

    try {
      const board = await createPipelineBoard({ name: parsed.data.name, businessId })
      return NextResponse.json({ ok: true, board: { ...board, name: parsed.data.name } })
    } catch (err) {
      // Readable DAL refusal (duplicate key, symbols-only name) — surfaced,
      // not swallowed into a 500.
      const message = err instanceof Error ? err.message : "Failed to create board"
      return NextResponse.json({ error: message }, { status: 400 })
    }
  },
)
