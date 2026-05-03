import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getSubmissionById,
  setSubmissionStatus,
} from "@/lib/db/team-video-submissions"
import {
  finalizeVersion,
  getCurrentVersion,
} from "@/lib/db/team-video-versions"
import { sendVideoUploadedEmail } from "@/lib/email"
import { getBaseUrl } from "@/lib/url"
import { createServiceRoleClient } from "@/lib/supabase"
import type { User } from "@/types/database"

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "editor" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  const submission = await getSubmissionById(id)
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 })

  if (session.user.role === "editor" && submission.submitted_by !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const version = await getCurrentVersion(submission.id)
  if (!version) return NextResponse.json({ error: "No version to finalize" }, { status: 409 })
  if (version.status === "uploaded") {
    return NextResponse.json({ error: "Version already finalized" }, { status: 409 })
  }

  await finalizeVersion(version.id)
  await setSubmissionStatus(submission.id, "submitted")

  try {
    const supabase = createServiceRoleClient()
    const { data: admins } = await supabase
      .from("users")
      .select("email, first_name")
      .eq("role", "admin")
    if (admins && admins.length > 0) {
      const editorName = session.user.name ?? "Your editor"
      await Promise.all(
        (admins as Array<Pick<User, "email" | "first_name">>).map((a) =>
          sendVideoUploadedEmail({
            to: a.email,
            editorName,
            submissionTitle: submission.title,
            reviewUrl: `${getBaseUrl()}/admin/team-videos/${submission.id}`,
          }),
        ),
      )
    }
  } catch (err) {
    console.error("[finalize-email] failed:", err)
  }

  return NextResponse.json({ ok: true })
}
