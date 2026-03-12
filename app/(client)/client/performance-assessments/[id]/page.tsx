import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import {
  getPerformanceAssessmentById,
  getAssessmentExercises,
  getAssessmentMessages,
} from "@/lib/db/performance-assessments"
import { getSignedVideoUrl } from "@/lib/firebase-admin"
import { PerformanceAssessmentClientDetail } from "@/components/client/PerformanceAssessmentDetail"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

export const metadata = { title: "Assessment Detail | DJP Athlete" }

export default async function ClientPerformanceAssessmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const { id } = await params

  let assessment: Awaited<ReturnType<typeof getPerformanceAssessmentById>>
  let exercises: Awaited<ReturnType<typeof getAssessmentExercises>>

  try {
    ;[assessment, exercises] = await Promise.all([
      getPerformanceAssessmentById(id),
      getAssessmentExercises(id),
    ])
  } catch {
    notFound()
  }

  // Verify ownership and non-draft
  if (assessment.client_user_id !== session.user.id || assessment.status === "draft") {
    notFound()
  }

  // Fetch messages for each exercise
  const messagesMap: Record<string, Awaited<ReturnType<typeof getAssessmentMessages>>> = {}
  const messageResults = await Promise.all(
    exercises.map((ex) =>
      getAssessmentMessages(ex.id).then((msgs) => ({ exerciseId: ex.id, msgs }))
    )
  )
  for (const { exerciseId, msgs } of messageResults) {
    messagesMap[exerciseId] = msgs
  }

  // Generate signed video URLs
  const videoUrlsMap: Record<string, string> = {}
  const videoResults = await Promise.all(
    exercises
      .filter((ex) => ex.video_path)
      .map((ex) =>
        getSignedVideoUrl(ex.video_path!)
          .then((url) => ({ exerciseId: ex.id, url }))
          .catch(() => ({ exerciseId: ex.id, url: null }))
      )
  )
  for (const { exerciseId, url } of videoResults) {
    if (url) videoUrlsMap[exerciseId] = url
  }

  return (
    <div>
      <Link
        href="/client/performance-assessments"
        className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ArrowLeft className="size-3.5" />
        Back to Assessments
      </Link>

      <PerformanceAssessmentClientDetail
        assessment={assessment}
        exercises={exercises}
        messagesMap={messagesMap}
        videoUrlsMap={videoUrlsMap}
        currentUserId={session.user.id}
      />
    </div>
  )
}
