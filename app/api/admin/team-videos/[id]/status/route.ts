import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getSubmissionById, setSubmissionStatus, approveSubmission, reopenSubmission,
} from "@/lib/db/team-video-submissions"
import { statusTransitionSchema } from "@/lib/validators/team-video"

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

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = statusTransitionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  }

  switch (parsed.data.action) {
    case "approve":
      if (submission.status === "locked") {
        return NextResponse.json({ error: "Submission is locked" }, { status: 409 })
      }
      await approveSubmission(submission.id, session.user.id)
      // TODO(Task 22): send "approved" email to editor
      return NextResponse.json({ ok: true })

    case "request_revision":
      if (submission.status === "approved" || submission.status === "locked") {
        return NextResponse.json(
          { error: "Cannot request revision on approved/locked submission" },
          { status: 409 },
        )
      }
      await setSubmissionStatus(submission.id, "revision_requested")
      // TODO(Task 22): send "revision requested" email to editor
      return NextResponse.json({ ok: true })

    case "reopen":
      if (submission.status !== "approved") {
        return NextResponse.json(
          { error: "Only approved submissions can be reopened" },
          { status: 409 },
        )
      }
      await reopenSubmission(submission.id)
      // TODO(Task 22): send "reopened" email to editor
      return NextResponse.json({ ok: true })
  }
}
