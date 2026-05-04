import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSubmissionById } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { createComment, getCommentById } from "@/lib/db/team-video-comments"
import { createCommentSchema } from "@/lib/validators/team-video"

/**
 * POST /api/editor/submissions/[id]/comments
 *
 * Editors can post comments only on their own submissions. Admins are also
 * allowed (they pose as editor on the editor surface). Replies are supported;
 * annotations are not (only admin can attach drawings — keeps the schema
 * intent simple: editor reactions stay text-only).
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "editor" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  const submission = await getSubmissionById(id)
  if (!submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 })
  }
  // Editors can only comment on submissions they own. Admin can on any.
  if (
    session.user.role === "editor" &&
    submission.submitted_by !== session.user.id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const version = await getCurrentVersion(submission.id)
  if (!version) {
    return NextResponse.json({ error: "No current version" }, { status: 409 })
  }

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

  // Editors can't drop annotations — they can only react in text.
  if (parsed.data.annotation && session.user.role === "editor") {
    return NextResponse.json(
      {
        error: "Editors cannot attach drawings. Comment only, please.",
        details: { annotation: ["Editors cannot attach drawings"] },
      },
      { status: 400 },
    )
  }

  // Validate parent if this is a reply.
  if (parsed.data.parentId) {
    const parent = await getCommentById(parsed.data.parentId)
    if (!parent || parent.version_id !== version.id) {
      return NextResponse.json({ error: "Parent comment not found" }, { status: 404 })
    }
    if (parent.parent_id != null) {
      return NextResponse.json(
        { error: "Cannot reply to a reply — only one level of nesting is supported" },
        { status: 400 },
      )
    }
  }

  const comment = await createComment({
    versionId: version.id,
    authorId: session.user.id,
    timecodeSeconds: parsed.data.timecodeSeconds,
    commentText: parsed.data.commentText,
    parentId: parsed.data.parentId ?? null,
  })

  return NextResponse.json({ comment }, { status: 201 })
}
