import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { isTeamRole } from "@/lib/permissions/registry"
import { getSubmissionById, setCurrentVersion } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { buildVersionPath, createUploadUrl } from "@/lib/storage/team-videos"
import { createVersionSchema } from "@/lib/validators/team-video"
import { uploadBlockedReason } from "@/lib/team-videos/workflow"
import { withAudit } from "@/lib/audit/with-audit"

export const POST = withAudit(
  {
    action: "team_video.version_added",
    category: "support",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "team_video_submission", id }
    },
  },
  async (request, context) => {
    const ctx = context as unknown as { params: Promise<{ id: string }> }
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isTeamRole(session.user.role) && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  const submission = await getSubmissionById(id)
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 })

  // Editors can only revise their own submissions
  if (session.user.role !== "admin" && submission.submitted_by !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Open until sign-off — an editor can deliver a new cut whenever the
  // submission isn't approved or locked. The refusal reuses the same sentence
  // the editor UI shows, so the two can't drift.
  const blocked = uploadBlockedReason(submission.status)
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 409 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = createVersionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const versionNumber = await nextVersionNumber(submission.id)
  const storagePath = buildVersionPath(submission.id, versionNumber, parsed.data.filename)

  const version = await createVersion({
    submissionId: submission.id,
    versionNumber,
    storagePath,
    originalFilename: parsed.data.filename,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
  })

  await setCurrentVersion(submission.id, version.id)

  const upload = await createUploadUrl({
    storagePath,
    contentType: parsed.data.mimeType,
  })

  return NextResponse.json({ version, upload }, { status: 201 })
  },
)
