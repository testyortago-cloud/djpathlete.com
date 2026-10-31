import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { getLink } from "@/lib/db/output-sports"
import { syncClient } from "@/lib/output-sports/sync"
import { outputErrorResponse } from "@/lib/output-sports/errors"

type Ctx = { params: Promise<{ id: string }> }

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
    try {
      const summary = await syncClient(businessId, id, session.user.id)
      return NextResponse.json({ summary, link: await getLink(businessId, id) })
    } catch (err) {
      return outputErrorResponse(err)
    }
  },
)
