import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getClientPackageByIdMaybe, updateClientPackage } from "@/lib/db/client-packages"
import { recordAudit } from "@/lib/audit/record"

const bodySchema = z.object({ autoRenew: z.boolean() })

/**
 * PATCH — arm or disarm auto-renew on the client's OWN pack.
 *
 * Identity comes from the session, and the guard is ownership, not role:
 * a client may only ever flip auto-renew on a pack whose client_user_id is
 * their own session id. Arming means the system will charge their saved
 * card when the pack depletes, so every flip is audited.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await ctx.params

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "autoRenew must be a boolean" }, { status: 400 })
    }
    const { autoRenew } = parsed.data

    const pack = await getClientPackageByIdMaybe(id)
    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 })
    }
    // Ownership, not role: a client may only ever flip auto-renew on their OWN pack.
    if (pack.client_user_id !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
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
    console.error("Client auto-renew toggle error:", error)
    return NextResponse.json({ error: "Failed to update auto-renew" }, { status: 500 })
  }
}
