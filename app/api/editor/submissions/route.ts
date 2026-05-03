import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createSubmission, setCurrentVersion } from "@/lib/db/team-video-submissions"
import { createVersion, nextVersionNumber } from "@/lib/db/team-video-versions"
import { buildVersionPath, createUploadUrl } from "@/lib/storage/team-videos"
import { createSubmissionSchema } from "@/lib/validators/team-video"

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "editor" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = createSubmissionSchema.safeParse(body)
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
  })

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

  return NextResponse.json(
    {
      submission,
      version,
      upload: {
        uploadUrl: upload.uploadUrl,
        storagePath: upload.storagePath,
        expiresInSeconds: upload.expiresInSeconds,
      },
    },
    { status: 201 },
  )
}
