// app/api/admin/pipeline/move/route.ts — a human dragging a card on the
// pipeline board. Body: { opportunityId, toStageKey }.
//
// This route is deliberately thin: auth, parse the body, call
// `moveOpportunityManually` (lib/db/pipeline.ts, Task 3/5) with the session
// user's id, respond. Every consequence of a move — setting
// `closed_trigger='manual'` on a close, dual-logging `pipeline.opportunity_moved`
// (admin_write) alongside `pipeline.opportunity_won`/`_lost` (commerce) when
// the destination is won/lost, clearing closure fields on a reopen — is
// already the DAL's job and is NOT reimplemented here.
//
// Admin-only, not permission-tiered: a card move can close a deal and
// therefore move a revenue number, so staff (even with a "leads"-shaped
// permission elsewhere) do not get a pass here — only `role === "admin"`.
//
// withAudit() wraps this for the 401/denied/failure trail (the DAL is never
// reached on those paths, so it never logs them). On a SUCCESSFUL move this
// wrapper's own `admin_write` row is intentionally redundant with the DAL's
// more detailed one — the DAL's is the one worth reading (it carries
// to_stage/closing), this one is the generic "someone hit this endpoint and
// it returned 200" record the house convention asks every admin route to
// emit.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { moveOpportunityManually } from "@/lib/db/pipeline"

type MoveBody = { opportunityId?: unknown; toStageKey?: unknown }

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0
}

export const POST = withAudit(
  {
    action: "pipeline.opportunity_moved",
    category: "admin_write",
    // Reads the ORIGINAL (still-unconsumed) request — the handler below
    // parses a CLONE of it, so this is the first real read regardless of
    // which branch the handler took, including the 401/403 paths.
    target: async (request) => {
      const body = (await request.json().catch(() => null)) as MoveBody | null
      return isNonEmptyString(body?.opportunityId)
        ? { type: "opportunity", id: body.opportunityId }
        : undefined
    },
  },
  async (request) => {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = (await request.clone().json().catch(() => null)) as MoveBody | null
    if (!isNonEmptyString(body?.opportunityId) || !isNonEmptyString(body?.toStageKey)) {
      return NextResponse.json(
        { error: "opportunityId and toStageKey are required" },
        { status: 400 },
      )
    }

    try {
      await moveOpportunityManually({
        opportunityId: body.opportunityId,
        toStageKey: body.toStageKey,
        actorUserId: session.user.id,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Move failed"
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  },
)
