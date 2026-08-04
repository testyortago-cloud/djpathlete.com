// GET /api/messaging/clients — the picker behind "New message"
//
// Owned by this feature rather than borrowed from /api/admin/users, so the
// shape the dialog depends on cannot drift underneath it. Returns only the
// fields the picker renders; no password hashes, no billing ids.
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getClients } from "@/lib/db/users"

export const runtime = "nodejs"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const clients = await getClients()
  return NextResponse.json({
    clients: clients.map((client) => ({
      id: client.id,
      first_name: client.first_name,
      last_name: client.last_name,
      email: client.email,
    })),
  })
}
