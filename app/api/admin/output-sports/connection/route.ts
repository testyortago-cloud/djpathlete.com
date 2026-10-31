import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { OutputAuthError, signIn } from "@/lib/output-sports/api"
import { disconnect, getConnection, saveConnection } from "@/lib/db/output-sports"
import { outputErrorResponse } from "@/lib/output-sports/errors"

const bodySchema = z.object({
  email: z.string().trim().email("Enter the email you sign in to Output with."),
  password: z.string().min(1, "Enter your Output password."),
})

/** The caller and their business, or a response explaining why there is none to act on. */
async function actorOr403(request: Request): Promise<{ userId: string; businessId: string } | NextResponse> {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user, request))) {
    return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
  }
  return { userId: session.user.id, businessId: (await resolveAdminTenantForRequest(request)).businessId }
}

/**
 * Connects the business's Output account. The password is used once, to get a refresh
 * token from Output, and is not stored. Owner only (OWNER_ONLY_PREFIXES).
 */
export const POST = withAudit({ action: "output_sports.connected", category: "admin_write" }, async (request) => {
  const actor = await actorOr403(request)
  if (actor instanceof NextResponse) return actor
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 })
  }
  try {
    const tokens = await signIn(parsed.data.email, parsed.data.password)
    await saveConnection(actor.businessId, tokens.refreshToken, parsed.data.email, actor.userId)
  } catch (err) {
    if (err instanceof OutputAuthError) {
      // 400, not 401/403: this is Output refusing the login, not the coach lacking access here.
      return NextResponse.json({ error: `Output Sports did not accept that login: ${err.message}` }, { status: 400 })
    }
    console.error("[output-sports] connect failed", err)
    return outputErrorResponse(err)
  }
  return NextResponse.json({ connection: await getConnection(actor.businessId) })
})

/** Disconnects: the stored token is deleted. Client links and imported results stay. */
export const DELETE = withAudit({ action: "output_sports.disconnected", category: "admin_write" }, async (request) => {
  const actor = await actorOr403(request)
  if (actor instanceof NextResponse) return actor
  await disconnect(actor.businessId)
  return NextResponse.json({ ok: true })
})
