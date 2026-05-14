import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createSubmission, setCurrentVersion } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { createImagesForVersion } from "@/lib/db/team-submission-images"
import { buildImagePath, createImageUploadUrls } from "@/lib/storage/team-videos"
import { createPhotoSubmissionSchema } from "@/lib/validators/team-video"
import { isTeamImagesEnabled } from "@/lib/team-images/feature-flag"

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "editor" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!isTeamImagesEnabled()) {
    return NextResponse.json(
      { error: "Photo submissions are disabled. Set NEXT_PUBLIC_TEAM_IMAGES_ENABLED=true." },
      { status: 400 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = createPhotoSubmissionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const submission = await createSubmission({
    title: parsed.data.title,
    description: parsed.data.description,
    submittedBy: session.user.id,
    kind: "image_set",
  })

  const versionNumber = await nextVersionNumber(submission.id)
  const folderPrefix = `team-videos/${submission.id}/v${versionNumber}/`

  const version = await createVersion({
    submissionId: submission.id,
    versionNumber,
    storagePath: folderPrefix,
    originalFilename: null,
    mimeType: null,
    sizeBytes: null,
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
      submission,
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
