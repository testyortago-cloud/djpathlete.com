import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(_req: NextRequest) {
  const session = await auth()
  if (session?.user?.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { jobId } = await createAiJob({
    type: "chief_strategist_run",
    userId: session.user.id,
    input: {},
  })
  return NextResponse.json({ jobId, status: "pending" }, { status: 202 })
}
