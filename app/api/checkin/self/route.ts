import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { selfCheckinSchema } from "@/lib/validators/session-packs"
import { verifyCheckinToken } from "@/lib/qr/checkin-token"
import { checkInClient } from "@/lib/services/session-credits"
import { bridgeCheckinToSchedule } from "@/lib/services/session-schedule"
import { clientSelfCheckinEnabled } from "@/lib/packs/flags"
import { recordAudit } from "@/lib/audit/record"

/**
 * Client-portal self check-in. The QR token proves on-site presence; the
 * authenticated session proves identity. The client id comes from the session
 * only — any id in the body is ignored — so a client can never check anyone
 * else in.
 */
export async function POST(request: Request) {
  try {
    if (!(await clientSelfCheckinEnabled())) {
      return NextResponse.json({ error: "Self check-in is not enabled" }, { status: 403 })
    }

    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (session.user.role !== "client") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const parsed = selfCheckinSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

    const verdict = verifyCheckinToken(parsed.data.token, new Date())
    if (!verdict.valid) {
      return NextResponse.json({ error: "Invalid or expired check-in code" }, { status: 401 })
    }

    const clientUserId = session.user.id
    const result = await checkInClient({ clientUserId, method: "qr_self", createdBy: clientUserId, now: new Date() })
    if (!result.ok && result.reason === "no_credits") {
      return NextResponse.json({ error: "No active credits left on your pack." }, { status: 409 })
    }

    if (result.ok && result.reason !== "duplicate") {
      void recordAudit({
        action: "pack.checkin",
        category: "client_action",
        outcome: "success",
        actor: { id: clientUserId, email: session.user.email ?? null, role: "client" },
        target: { type: "client_package", id: result.packageId!, label: "qr_self" },
        metadata: {
          client_user_id: clientUserId,
          method: "qr_self",
          self_initiated: true,
          coach_id: verdict.coachId,
          remaining: result.remaining,
        },
        request,
      })
    }

    // Best-effort: also mark today's scheduled session attended (flag-gated).
    if (result.ok) {
      void bridgeCheckinToSchedule(clientUserId, result.checkin?.id ?? null, new Date())
    }

    return NextResponse.json({ ok: true, remaining: result.remaining, duplicate: result.reason === "duplicate" })
  } catch (error) {
    console.error("Self check-in error:", error)
    return NextResponse.json({ error: "Failed to check in" }, { status: 500 })
  }
}
