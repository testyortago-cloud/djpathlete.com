import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { getLink } from "@/lib/db/output-sports"
import { syncClient } from "@/lib/output-sports/sync"
import { outputErrorResponse } from "@/lib/output-sports/errors"

type Ctx = { params: Promise<{ id: string }> }

// A sync after a long gap reads Output in 31-day pieces, then recomputes PRs.
export const maxDuration = 300

/** Pulls the client's latest Output results into their performance tests. */
export const POST = withAudit(
  {
    action: "output_sports.synced",
    category: "admin_write",
    target: async (_req, ctx) => ({ type: "user", id: (await (ctx as Ctx).params).id }),
  },
  async (request, context) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user, request))) {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }
    const { id } = await (context as unknown as Ctx).params
    const { businessId } = await resolveAdminTenantForRequest(request)
    let summary
    try {
      summary = await syncClient(businessId, id, session.user.id)
    } catch (err) {
      return outputErrorResponse(err)
    }
    return NextResponse.json({ summary, link: await getLink(businessId, id) })
  },
)
