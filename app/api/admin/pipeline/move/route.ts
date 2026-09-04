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
// NO LONGER ADMIN-ONLY as of 2026-09-04. `/api/admin/pipeline` is mapped to the
// `contacts` permission, so a coach can move cards on their OWN board — the
// whole point of that change. A card move can still close a deal and therefore
// move a revenue number, so two things replaced the blanket role check and both
// matter: the permission gate, and the TENANT. `opportunityId` arrives in the
// request body, and `moveOpportunityManually` defaults its `businessId` to
// SINGLETON_BUSINESS_ID — so omitting it here would silently move the
// OPERATOR'S cards on a coach's request. Holding no permission is still a 403.
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
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
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
    // Was `role !== "admin"`. A coach holding `contacts` reaches this now, so
    // the decision moves to the registry -- and the move below MUST carry the
    // tenant, or a coach moves the operator's cards.
    if (!(await canAccessAdminPath(session.user, request))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // The opportunityId arrives in the request body, so without this the
    // `businessId` parameter below falls to its SINGLETON_BUSINESS_ID default
    // and a coach's move lands on the operator's own pipeline.
    let businessId: string
    try {
      ;({ businessId } = await resolveAdminTenantForRequest(request))
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      throw err
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
        businessId,
        // The REAL role, not the "admin" this used to hardcode. A coach can
        // close a deal now, and the audit trail has to say so.
        actorRole: session.user.role,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Move failed"
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  },
)
