import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { voidCheckinSchema } from "@/lib/validators/session-packs"
import { voidCheckinAndRestore } from "@/lib/services/session-credits"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

/** Void a check-in (coach undo) — restores the credit. */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const parsed = voidCheckinSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "checkinId is required" }, { status: 400 })
    }

    const result = await voidCheckinAndRestore({
      checkinId: parsed.data.checkinId,
      voidedBy: session.user.id,
      reason: parsed.data.reason ?? null,
      now: new Date(),
    })

    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 409
      return NextResponse.json({ error: result.reason }, { status })
    }

    void recordAudit({
      action: "pack.checkin_voided",
      category: "client_action",
      outcome: "success",
      target: { type: "session_checkin", id: parsed.data.checkinId },
      metadata: { reason: parsed.data.reason ?? null },
      request,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Void check-in error:", error)
    return NextResponse.json({ error: "Failed to void check-in" }, { status: 500 })
  }
}
