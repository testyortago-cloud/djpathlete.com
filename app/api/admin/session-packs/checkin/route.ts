import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { checkInClient } from "@/lib/services/session-credits"
import { bridgeCheckinToSchedule } from "@/lib/services/session-schedule"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const bodySchema = z.object({ clientUserId: z.string().uuid() })

/** Coach one-tap check-in (fallback to QR). Deducts a credit from the client's active pack. */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "clientUserId is required" }, { status: 400 })
    }

    const result = await checkInClient({
      clientUserId: parsed.data.clientUserId,
      method: "coach_tap",
      createdBy: session.user.id,
      now: new Date(),
    })

    if (!result.ok && result.reason === "no_credits") {
      return NextResponse.json({ error: "No active credits — sell or renew a pack first." }, { status: 409 })
    }

    if (result.ok && result.reason !== "duplicate") {
      void recordAudit({
        action: "pack.checkin",
        category: "client_action",
        outcome: "success",
        target: { type: "client_package", id: result.packageId!, label: "coach_tap" },
        metadata: { client_user_id: parsed.data.clientUserId, method: "coach_tap", remaining: result.remaining },
        request,
      })
    }

    // Best-effort: also mark today's scheduled session attended (flag-gated).
    if (result.ok) {
      void bridgeCheckinToSchedule(parsed.data.clientUserId, result.checkin?.id ?? null, new Date())
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("Coach check-in error:", error)
    return NextResponse.json({ error: "Failed to check in" }, { status: 500 })
  }
}
