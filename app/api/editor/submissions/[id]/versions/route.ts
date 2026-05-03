import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSubmissionById, setCurrentVersion } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { buildVersionPath, createUploadUrl } from "@/lib/storage/team-videos"
import { createVersionSchema } from "@/lib/validators/team-video"

export async function POST(
  request: Request,
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

  // Editors can only revise their own submissions
  if (session.user.role === "editor" && submission.submitted_by !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Only allowed when revision was requested or submission is still a draft
  if (submission.status !== "revision_requested" && submission.status !== "draft") {
    return NextResponse.json(
      { error: "Cannot upload a new version in current state" },
      { status: 409 },
    )
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
}
