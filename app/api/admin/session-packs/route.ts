import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { loadClientPacksView } from "@/lib/services/client-packs-view"

/** GET ?clientUserId= — a client's packages, each with its check-in history. */
export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const clientUserId = new URL(request.url).searchParams.get("clientUserId")
    if (!clientUserId) {
      return NextResponse.json({ error: "clientUserId is required" }, { status: 400 })
    }

    const packages = await loadClientPacksView(clientUserId)
    return NextResponse.json({ packages })
  } catch (error) {
    console.error("List packages error:", error)
    return NextResponse.json({ error: "Failed to load packages" }, { status: 500 })
  }
}
