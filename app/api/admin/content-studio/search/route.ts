import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { searchContentStudio } from "@/lib/content-studio/search"

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const url = new URL(request.url)
  const q = (url.searchParams.get("q") ?? "").trim()
  if (!q) return NextResponse.json({ videos: [], transcripts: [], posts: [] })
  const result = await searchContentStudio(q)
  return NextResponse.json(result)
}
