import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getClientPackageByIdMaybe, updateClientPackage } from "@/lib/db/client-packages"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const bodySchema = z.object({ autoRenew: z.boolean() })

/**
 * PATCH — arm or disarm auto-renew on a client's pack, from the coach side.
 *
 * Arming means the system will charge the client's saved card when this pack
 * depletes, so every flip is audited with who did it.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: "autoRenew must be a boolean" }, { status: 400 })
    }
    const { autoRenew } = parsed.data

    const pack = await getClientPackageByIdMaybe(id)
    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 })
    }

    await updateClientPackage(id, { auto_renew: autoRenew })

    void recordAudit({
      action: autoRenew ? "pack.auto_renew_enabled" : "pack.auto_renew_disabled",
      category: "commerce",
      outcome: "success",
      target: { type: "client_package", id, label: pack.session_type },
      metadata: { client_user_id: pack.client_user_id },
      request,
    })

    return NextResponse.json({ ok: true, autoRenew })
  } catch (error) {
    console.error("Admin auto-renew toggle error:", error)
    return NextResponse.json({ error: "Failed to update auto-renew" }, { status: 500 })
  }
}
