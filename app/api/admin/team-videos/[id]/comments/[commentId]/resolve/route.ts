import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getCommentById, resolveComment, reopenComment } from "@/lib/db/team-video-comments"

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; commentId: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { commentId } = await ctx.params
  const comment = await getCommentById(commentId)
  if (!comment) return NextResponse.json({ error: "Comment not found" }, { status: 404 })

  // Toggle: open → resolved, resolved → open. Body can override with explicit action.
  let body: { action?: "resolve" | "reopen" } = {}
  try {
    body = await request.json()
  } catch {
    /* empty body OK */
  }
  const action = body.action ?? (comment.status === "open" ? "resolve" : "reopen")

  if (action === "resolve") await resolveComment(commentId, session.user.id)
  else await reopenComment(commentId)

  return NextResponse.json({ ok: true, action })
}
