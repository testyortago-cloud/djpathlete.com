import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import { getSetting, setSetting } from "@/lib/db/system-settings"
import { BLOG_SCAN_QUERIES_KEY, DEFAULT_BLOG_SCAN_QUERIES } from "@/lib/blog/scan-queries"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const queries = await getSetting<string[]>(BLOG_SCAN_QUERIES_KEY, DEFAULT_BLOG_SCAN_QUERIES)
  return NextResponse.json({ queries })
}

const schema = z.object({
  queries: z
    .array(z.string().trim().min(3).max(300))
    .min(1, "Add at least one topic")
    .max(20, "Maximum 20 topics"),
})

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
  await setSetting(BLOG_SCAN_QUERIES_KEY, parsed.data.queries, session.user.id)
  return NextResponse.json({ queries: parsed.data.queries })
}
