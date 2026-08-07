import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function POST(_req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { jobId } = await createAiJob({
    type: "chief_strategist_run",
    userId: session.user.id,
    input: {},
  })
  return NextResponse.json({ jobId, status: "pending" }, { status: 202 })
}
