import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { getLatestAssignmentProgram } from "@/lib/db/assignments"

/** The program a new AI program for this client will follow on from, for the AI Generate dialog. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user, request))) {
    return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
  }
  try {
    const { id } = await params
    return NextResponse.json({ program: await getLatestAssignmentProgram(id) })
  } catch (error) {
    console.error("[previous-program GET]", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "Could not read the client's programs." }, { status: 500 })
  }
}
