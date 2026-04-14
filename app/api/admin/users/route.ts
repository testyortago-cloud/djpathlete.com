import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getClients, getUsers } from "@/lib/db/users"

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const role = request.nextUrl.searchParams.get("role")

    if (role === "client") {
      const clients = await getClients()
      return NextResponse.json({ users: clients })
    }

    const users = await getUsers()
    return NextResponse.json({ users })
  } catch {
    return NextResponse.json({ error: "Failed to fetch users." }, { status: 500 })
  }
}
