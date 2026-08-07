import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { searchContentStudio } from "@/lib/content-studio/search"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const url = new URL(request.url)
  const q = (url.searchParams.get("q") ?? "").trim()
  if (!q) return NextResponse.json({ videos: [], transcripts: [], posts: [] })
  const result = await searchContentStudio(q)
  return NextResponse.json(result)
}
