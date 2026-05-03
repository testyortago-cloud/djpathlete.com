import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { getSubmissionById } from "@/lib/db/team-video-submissions"
import { getCurrentVersion } from "@/lib/db/team-video-versions"
import { listCommentsForVersion } from "@/lib/db/team-video-comments"
import { createReadUrl } from "@/lib/storage/team-videos"
import { EditorVideoView } from "@/components/editor/EditorVideoView"

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
  const comments = version ? await listCommentsForVersion(version.id) : []
  const videoUrl =
    version && version.status === "uploaded" ? await createReadUrl(version.storage_path) : null

  return (
    <EditorVideoView
      submission={submission}
      version={version}
      comments={comments}
      videoUrl={videoUrl}
    />
  )
}
