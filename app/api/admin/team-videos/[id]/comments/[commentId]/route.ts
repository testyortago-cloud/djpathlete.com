import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getCommentById, deleteComment } from "@/lib/db/team-video-comments"

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string; commentId: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { commentId } = await ctx.params
  const comment = await getCommentById(commentId)
  if (!comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 })
  }

  await deleteComment(commentId)
  return NextResponse.json({ ok: true })
}
