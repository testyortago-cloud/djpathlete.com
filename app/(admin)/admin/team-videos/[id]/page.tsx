import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/auth-helpers"
import { getSubmissionById } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { listAuthorsForIds, listCommentsForVersion } from "@/lib/db/team-video-comments"
import { listAnnotationsForCommentIds } from "@/lib/db/team-video-annotations"
import { createReadUrl } from "@/lib/storage/team-videos"
import { ReviewSurface } from "@/components/admin/team-videos/ReviewSurface"

interface Props {
  params: Promise<{ id: string }>
}

export const metadata = { title: "Team Video Review" }

export default async function TeamVideoReviewPage({ params }: Props) {
  await requireAdmin()
  const { id } = await params
  const submission = await getSubmissionById(id)
  if (!submission) notFound()

  const version = await getCurrentVersion(submission.id)
  const rawComments = version ? await listCommentsForVersion(version.id) : []
  const [annotationMap, authorMap] = await Promise.all([
    listAnnotationsForCommentIds(rawComments.map((c) => c.id)),
    listAuthorsForIds(rawComments.map((c) => c.author_id)),
  ])
  const comments = rawComments.map((c) => ({
    ...c,
    annotation: annotationMap.get(c.id) ?? null,
    author: authorMap.get(c.author_id) ?? null,
  }))
  const videoUrl =
    version && version.status === "uploaded"
      ? await createReadUrl(version.storage_path)
      : null

  return (
    <ReviewSurface
      submission={submission}
      version={version}
      comments={comments}
      videoUrl={videoUrl}
    />
  )
}
