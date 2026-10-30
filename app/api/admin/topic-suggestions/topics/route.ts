// GET / POST the weekly scan topics (the boxes on /admin/topic-suggestions). POST replaces the whole list
// and writes the scan's searches with it; see lib/blog/scan-topics.ts.
import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { MAX_SCAN_TOPICS, scanTopicSchema, searchCountProblem } from "@/lib/blog/scan-topics"
import { getScanTopics, saveScanTopics } from "@/lib/blog/scan-topics-store"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return NextResponse.json({ topics: await getScanTopics() })
}

const schema = z.object({ topics: z.array(scanTopicSchema).max(MAX_SCAN_TOPICS, `At most ${MAX_SCAN_TOPICS} topics`) })

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
  }
  const problem = searchCountProblem(parsed.data.topics)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  await saveScanTopics(parsed.data.topics, session.user.id)
  return NextResponse.json({ topics: parsed.data.topics })
}
