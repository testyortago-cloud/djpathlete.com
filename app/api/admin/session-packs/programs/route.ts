import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getPrograms } from "@/lib/db/programs"
import { canAccessAdminPath } from "@/lib/permissions/guard"

/** GET — active programs (id + name) for the "link a program" selector. */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }
    const programs = await getPrograms()
    return NextResponse.json({ programs: programs.map((p) => ({ id: p.id, name: p.name })) })
  } catch (error) {
    console.error("List programs error:", error)
    return NextResponse.json({ error: "Failed to load programs" }, { status: 500 })
  }
}
