import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSubmissionById, setCurrentVersion } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { createImagesForVersion } from "@/lib/db/team-submission-images"
import { buildImagePath, createImageUploadUrls } from "@/lib/storage/team-videos"
import { createPhotoVersionSchema } from "@/lib/validators/team-video"
import { isTeamImagesEnabled } from "@/lib/team-images/feature-flag"

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "editor" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!isTeamImagesEnabled()) {
    return NextResponse.json(
      { error: "Photo submissions are disabled." },
      { status: 400 },
    )
  }

  const { id } = await ctx.params
  const submission = await getSubmissionById(id)
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 })

  if (session.user.role === "editor" && submission.submitted_by !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (submission.kind !== "image_set") {
    return NextResponse.json({ error: "Submission is not a photo set" }, { status: 409 })
  }
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
  const parsed = createPhotoVersionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const versionNumber = await nextVersionNumber(submission.id)
  const folderPrefix = `team-videos/${submission.id}/v${versionNumber}/`

  const version = await createVersion({
    submissionId: submission.id,
    versionNumber,
    storagePath: folderPrefix,
  })
  await setCurrentVersion(submission.id, version.id)

  const imageInputs = parsed.data.images.map((img) => ({
    position: img.position,
    storagePath: buildImagePath(submission.id, versionNumber, img.position, img.filename),
    originalFilename: img.filename,
    mimeType: img.mimeType,
    sizeBytes: img.sizeBytes,
  }))
  await createImagesForVersion(version.id, imageInputs)

  const uploads = await createImageUploadUrls(
    imageInputs.map((i) => ({ storagePath: i.storagePath, contentType: i.mimeType })),
  )

  return NextResponse.json(
    {
      version,
      uploads: uploads.map((u, idx) => ({
        position: imageInputs[idx].position,
        uploadUrl: u.uploadUrl,
        storagePath: u.storagePath,
        expiresInSeconds: u.expiresInSeconds,
      })),
    },
    { status: 201 },
  )
}
