import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/auth-helpers"
import { getSubmissionById } from "@/lib/db/team-video-submissions"
import { getCurrentVersion, listVersionsForSubmission } from "@/lib/db/team-video-versions"
import { listAuthorsForIds, listCommentsForVersion } from "@/lib/db/team-video-comments"
import { listAnnotationsForCommentIds } from "@/lib/db/team-video-annotations"
import { createReadUrl, createDownloadUrl } from "@/lib/storage/team-videos"
import { ReviewSurface } from "@/components/admin/team-videos/ReviewSurface"
import type { VersionRow } from "@/components/editor/VersionHistoryList"

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

  // Pre-fetch stream + download signed URLs for every uploaded version so the
  // admin can swap cuts and download originals without extra round-trips.
  // Same pattern as the editor page; ~1h TTL on signed URLs.
  const allVersions = await listVersionsForSubmission(submission.id)
  const versions: VersionRow[] = await Promise.all(
    allVersions.map(async (v) => {
      if (v.status !== "uploaded") {
        return { ...v, signedUrl: null, signedDownloadUrl: null }
      }
      const [signedUrl, signedDownloadUrl] = await Promise.all([
        createReadUrl(v.storage_path),
        createDownloadUrl(v.storage_path, v.original_filename),
      ])
      return { ...v, signedUrl, signedDownloadUrl }
    }),
  )

  const videoUrl =
    version?.status === "uploaded"
      ? versions.find((v) => v.id === version.id)?.signedUrl ?? null
      : null

  return (
    <ReviewSurface
      submission={submission}
      version={version}
      comments={comments}
      videoUrl={videoUrl}
      versions={versions}
    />
  )
}
