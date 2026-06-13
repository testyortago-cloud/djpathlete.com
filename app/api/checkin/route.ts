import { NextResponse } from "next/server"
import { checkinSchema } from "@/lib/validators/session-packs"
import { verifyCheckinToken } from "@/lib/qr/checkin-token"
import { checkInClient } from "@/lib/services/session-credits"
import { qrCheckinEnabled } from "@/lib/packs/flags"
import { recordAudit } from "@/lib/audit/record"

/** Public QR self-check-in. Token-gated; can only deduct from the resolved client's own pack. */
export async function POST(request: Request) {
  try {
    if (!(await qrCheckinEnabled())) {
      return NextResponse.json({ error: "Self check-in is not enabled" }, { status: 403 })
    }

    const parsed = checkinSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }
    const { clientUserId, token } = parsed.data

    const verdict = verifyCheckinToken(token, new Date())
    if (!verdict.valid) {
      return NextResponse.json({ error: "Invalid or expired check-in code" }, { status: 401 })
    }

    const result = await checkInClient({ clientUserId, method: "qr_self", createdBy: null, now: new Date() })
    if (!result.ok && result.reason === "no_credits") {
      return NextResponse.json({ error: "No active credits left on your pack." }, { status: 409 })
    }

    if (result.ok && result.reason !== "duplicate") {
      void recordAudit({
        action: "pack.checkin",
        category: "client_action",
        outcome: "success",
        actor: { id: clientUserId, email: null, role: "client" },
        target: { type: "client_package", id: result.packageId!, label: "qr_self" },
        metadata: { client_user_id: clientUserId, method: "qr_self", coach_id: verdict.coachId, remaining: result.remaining },
        request,
      })
    }

    return NextResponse.json({ ok: true, remaining: result.remaining, duplicate: result.reason === "duplicate" })
  } catch (error) {
    console.error("Self check-in error:", error)
    return NextResponse.json({ error: "Failed to check in" }, { status: 500 })
  }
}
