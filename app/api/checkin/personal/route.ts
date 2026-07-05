import { NextResponse } from "next/server"
import { verifyPersonalCheckinToken } from "@/lib/qr/checkin-token"
import { checkInClient } from "@/lib/services/session-credits"
import { bridgeCheckinToSchedule } from "@/lib/services/session-schedule"
import { clientPersonalCheckinEnabled } from "@/lib/packs/flags"
import { listPackagesForClient } from "@/lib/db/client-packages"
import { getUserById } from "@/lib/db/users"
import { summarizeClientPacks } from "@/lib/services/client-packs-view"
import { selfCheckinSchema } from "@/lib/validators/session-packs"
import { recordAudit } from "@/lib/audit/record"

/**
 * Personal (stable, per-client) check-in link. The token embeds one client id
 * and never expires, so a regular bookmarks their own "Check in, <name>" link —
 * no daily QR to print, no roster, no login. The token IS the identity, so a
 * body-supplied id is never trusted.
 */
function clientFromToken(token: string | null | undefined): string | null {
  if (!token) return null
  const v = verifyPersonalCheckinToken(token)
  return v.valid ? v.clientUserId : null
}

/** GET — resolve the token to { firstName, remaining } so the page can greet by name. */
export async function GET(request: Request) {
  try {
    if (!(await clientPersonalCheckinEnabled())) {
      return NextResponse.json({ error: "Personal check-in is not enabled" }, { status: 403 })
    }
    const clientUserId = clientFromToken(new URL(request.url).searchParams.get("token"))
    if (!clientUserId) return NextResponse.json({ error: "Invalid check-in link" }, { status: 401 })

    const [user, packs] = await Promise.all([
      getUserById(clientUserId).catch(() => null),
      listPackagesForClient(clientUserId),
    ])
    const { activeRemaining } = summarizeClientPacks(packs, new Date())
    return NextResponse.json({ firstName: user?.first_name ?? "there", remaining: activeRemaining })
  } catch (error) {
    console.error("Personal check-in resolve error:", error)
    return NextResponse.json({ error: "Failed to load check-in" }, { status: 500 })
  }
}

/** POST — check the token's client in (one credit off their oldest active pack). */
export async function POST(request: Request) {
  try {
    if (!(await clientPersonalCheckinEnabled())) {
      return NextResponse.json({ error: "Personal check-in is not enabled" }, { status: 403 })
    }
    const parsed = selfCheckinSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

    const clientUserId = clientFromToken(parsed.data.token)
    if (!clientUserId) return NextResponse.json({ error: "Invalid check-in link" }, { status: 401 })

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
        metadata: { client_user_id: clientUserId, method: "qr_self", personal_link: true, remaining: result.remaining },
      })
    }

    // Best-effort: also mark today's scheduled session attended (flag-gated).
    if (result.ok) {
      void bridgeCheckinToSchedule(clientUserId, result.checkin?.id ?? null, new Date())
    }

    return NextResponse.json({ ok: true, remaining: result.remaining, duplicate: result.reason === "duplicate" })
  } catch (error) {
    console.error("Personal check-in error:", error)
    return NextResponse.json({ error: "Failed to check in" }, { status: 500 })
  }
}
