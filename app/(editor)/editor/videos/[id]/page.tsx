import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { getSubmissionById } from "@/lib/db/team-video-submissions"
import { getCurrentVersion, listVersionsForSubmission } from "@/lib/db/team-video-versions"
import { listCommentsForVersion } from "@/lib/db/team-video-comments"
import { listAnnotationsForCommentIds } from "@/lib/db/team-video-annotations"
import { createReadUrl } from "@/lib/storage/team-videos"
import { EditorVideoView } from "@/components/editor/EditorVideoView"
import type { VersionRow } from "@/components/editor/VersionHistoryList"

interface Props {
  params: Promise<{ id: string }>
}

export const metadata = { title: "Video Review" }

export default async function EditorVideoPage({ params }: Props) {
  const session = await auth()
  if (!session?.user) redirect("/login?callbackUrl=/editor")

  const { id } = await params
  const submission = await getSubmissionById(id)
  if (!submission) notFound()

  // Editors can only view their own; admins can view all
  if (session.user.role === "editor" && submission.submitted_by !== session.user.id) {
    notFound()
  }

  const version = await getCurrentVersion(submission.id)
  const rawComments = version ? await listCommentsForVersion(version.id) : []
  const annotationMap = await listAnnotationsForCommentIds(rawComments.map((c) => c.id))
  const comments = rawComments.map((c) => ({
    ...c,
    annotation: annotationMap.get(c.id) ?? null,
  }))

  // Pre-fetch signed read URLs for every uploaded version so the user can
  // swap between cuts without an extra round-trip. URLs expire (~1h) but
  // any longer review session triggers a refresh anyway.
  const allVersions = await listVersionsForSubmission(submission.id)
  const versions: VersionRow[] = await Promise.all(
    allVersions.map(async (v) => ({
      ...v,
      signedUrl:
        v.status === "uploaded" ? await createReadUrl(v.storage_path) : null,
    })),
  )

  const currentVersionUrl =
    version?.status === "uploaded"
      ? versions.find((v) => v.id === version.id)?.signedUrl ?? null
      : null

  return (
    <EditorVideoView
      submission={submission}
      version={version}
      comments={comments}
      videoUrl={currentVersionUrl}
      versions={versions}
    />
  )
}
