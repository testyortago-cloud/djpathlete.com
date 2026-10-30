import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import { createManualTopicSuggestion } from "@/lib/db/content-calendar"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { briefMondayISO } from "@/lib/blog/scan-topics"
import { addScanTopic } from "@/lib/blog/scan-topics-store"

const schema = z.object({ title: z.string().trim().min(5, "Too short").max(200) })

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const body = await request.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
  }
  // Dated like the weekly scan's cards, so it sits in the same week's brief rather than in the archive.
  const entry = await createManualTopicSuggestion(parsed.data.title, briefMondayISO(new Date()))
  // It also becomes a weekly scan topic. A failure there must not undo the card the coach just added.
  const scanTopic = await addScanTopic(parsed.data.title, "manual", session.user.id).catch((err) => {
    console.error("[topic-suggestions/custom] adding the scan topic failed:", err)
    return null
  })
  return NextResponse.json({ ...entry, scan_topic: scanTopic }, { status: 201 })
}
