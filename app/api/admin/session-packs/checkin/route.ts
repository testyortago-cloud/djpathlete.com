import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { checkInClient } from "@/lib/services/session-credits"
import { bridgeCheckinToSchedule } from "@/lib/services/session-schedule"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const bodySchema = z.object({ clientUserId: z.string().uuid() })

/**
 * Coach one-tap check-in (fallback to QR). Deducts a credit from the client's
 * active pack — or, when they have no pack but do have an attendance
 * arrangement, records attendance instead and deducts nothing.
 *
 * This is the ONLY door that passes `allowUnmetered`. The self-serve doors stay
 * metered on purpose: an arrangement's ledger is the coach's evidence of work
 * done at a partner facility, so the coach records it.
 */
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
      allowUnmetered: true,
    })

    if (!result.ok && result.reason === "no_credits") {
      return NextResponse.json(
        { error: "No active pack or attendance arrangement — sell a pack or start an arrangement first." },
        { status: 409 },
      )
    }

    if (result.ok && result.reason !== "duplicate") {
      // Two different facts, so two different action slugs: one deducted a
      // credit, the other did not. Collapsing them would make the audit trail
      // claim money moved when none did.
      void recordAudit(
        result.unmetered
          ? {
              action: "attendance.checkin",
              category: "client_action",
              outcome: "success",
              target: { type: "attendance_arrangement", id: result.arrangementId!, label: "coach_tap" },
              metadata: { client_user_id: parsed.data.clientUserId, method: "coach_tap", credit_delta: 0 },
              request,
            }
          : {
              action: "pack.checkin",
              category: "client_action",
              outcome: "success",
              target: { type: "client_package", id: result.packageId!, label: "coach_tap" },
              metadata: { client_user_id: parsed.data.clientUserId, method: "coach_tap", remaining: result.remaining },
              request,
            },
      )
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
