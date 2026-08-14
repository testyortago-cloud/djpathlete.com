import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { loadClientPacksView } from "@/lib/services/client-packs-view"
import { listRenewalAttemptsForUser } from "@/lib/db/pack-renewal-attempts"
import { canAccessAdminPath } from "@/lib/permissions/guard"

/** GET ?clientUserId= — a client's packages (each with its check-in history)
 *  plus their recent auto-renewal attempts, for the packs panel. */
export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const clientUserId = new URL(request.url).searchParams.get("clientUserId")
    if (!clientUserId) {
      return NextResponse.json({ error: "clientUserId is required" }, { status: 400 })
    }

    // The pack list is the point of this route; the attempts history is
    // supplementary. Caught independently (still run in parallel) so a
    // failure fetching it degrades to an empty list rather than taking the
    // packages payload down with it.
    const [packages, attempts] = await Promise.all([
      loadClientPacksView(clientUserId),
      listRenewalAttemptsForUser(clientUserId).catch((error) => {
        console.error("List renewal attempts error:", error)
        return []
      }),
    ])
    return NextResponse.json({ packages, attempts })
  } catch (error) {
    console.error("List packages error:", error)
    return NextResponse.json({ error: "Failed to load packages" }, { status: 500 })
  }
}
