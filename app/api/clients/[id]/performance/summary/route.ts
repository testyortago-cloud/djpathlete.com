import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getLatest } from "@/lib/db/daily-readiness"
import { getActive } from "@/lib/db/injuries"
import { getPRsByUser, listByUser } from "@/lib/db/performance-tests"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const { id } = await params

  const [latestReadiness, activeInjuries, prs, recentTests] = await Promise.all([
    getLatest(id),
    getActive(id),
    getPRsByUser(id),
    listByUser(id).then((t) => t.slice(0, 5)),
  ])

  return NextResponse.json({
    summary: {
      latestReadiness,
      activeInjuriesCount: activeInjuries.length,
      activeInjuries,
      prsCount: prs.length,
      recentPRs: prs.slice(0, 6),
      lastTest: recentTests[0] ?? null,
      recentTests,
    },
  })
}
