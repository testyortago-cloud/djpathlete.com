import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import { createManualTopicSuggestion } from "@/lib/db/content-calendar"
import { canAccessAdminPath } from "@/lib/permissions/guard"

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
  const today = new Date().toISOString().slice(0, 10)
  const entry = await createManualTopicSuggestion(parsed.data.title, today)
  return NextResponse.json(entry, { status: 201 })
}
