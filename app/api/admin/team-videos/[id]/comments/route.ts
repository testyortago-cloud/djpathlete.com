import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSubmissionById, setSubmissionStatus } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { createComment, listCommentsForVersion } from "@/lib/db/team-video-comments"
import { createAnnotationForComment, listAnnotationsForCommentIds } from "@/lib/db/team-video-annotations"
import { createCommentSchema } from "@/lib/validators/team-video"

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await ctx.params
  const submission = await getSubmissionById(id)
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 })

  const version = await getCurrentVersion(submission.id)
  if (!version) return NextResponse.json({ error: "No current version" }, { status: 409 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = createCommentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const comment = await createComment({
    versionId: version.id,
    authorId: session.user.id,
    timecodeSeconds: parsed.data.timecodeSeconds,
    commentText: parsed.data.commentText,
  })

  // Persist annotation drawing alongside the comment, if provided.
  if (parsed.data.annotation) {
    try {
      await createAnnotationForComment(comment.id, parsed.data.annotation)
    } catch (err) {
      console.error("[comment-annotation] failed to persist:", err)
      // Don't fail the comment create — the text comment still exists and is useful.
    }
  }

  // First comment on a "submitted" record bumps it to "in_review"
  if (submission.status === "submitted") {
    await setSubmissionStatus(submission.id, "in_review")
  }

  return NextResponse.json({ comment }, { status: 201 })
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await ctx.params
  const submission = await getSubmissionById(id)
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 })

  const version = await getCurrentVersion(submission.id)
  if (!version) return NextResponse.json({ comments: [] })

  const comments = await listCommentsForVersion(version.id)
  return NextResponse.json({ comments })
}
