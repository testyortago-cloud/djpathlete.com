import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listPackagesForClient } from "@/lib/db/client-packages"
import { listCheckinsForPackage } from "@/lib/db/session-checkins"
import { getAssignmentById } from "@/lib/db/assignments"
import { getProgramById } from "@/lib/db/programs"

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

    const packages = await listPackagesForClient(clientUserId)

    // Resolve linked program names once per unique assignment.
    const programNameByAssignment = new Map<string, string | null>()
    for (const a of new Set(packages.map((p) => p.assignment_id).filter((x): x is string => !!x))) {
      try {
        const assignment = await getAssignmentById(a)
        const program = await getProgramById(assignment.program_id)
        programNameByAssignment.set(a, program?.name ?? null)
      } catch {
        programNameByAssignment.set(a, null)
      }
    }

    const withCheckins = await Promise.all(
      packages.map(async (p) => ({
        ...p,
        checkins: await listCheckinsForPackage(p.id),
        program_name: p.assignment_id ? (programNameByAssignment.get(p.assignment_id) ?? null) : null,
      })),
    )

    return NextResponse.json({ packages: withCheckins })
  } catch (error) {
    console.error("List packages error:", error)
    return NextResponse.json({ error: "Failed to load packages" }, { status: 500 })
  }
}
