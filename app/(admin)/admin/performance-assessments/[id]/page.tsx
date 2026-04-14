import { requireAdmin } from "@/lib/auth-helpers"
import { notFound } from "next/navigation"
import {
  getPerformanceAssessmentById,
  getAssessmentExercises,
  getAssessmentMessages,
} from "@/lib/db/performance-assessments"
import { getSignedVideoUrl } from "@/lib/firebase-admin"
import { PerformanceAssessmentDetail } from "@/components/admin/PerformanceAssessmentDetail"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

export const metadata = { title: "Assessment Detail | Admin | DJP Athlete" }

export default async function AdminPerformanceAssessmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin()
  const { id } = await params

  let assessment: Awaited<ReturnType<typeof getPerformanceAssessmentById>>
  let exercises: Awaited<ReturnType<typeof getAssessmentExercises>>

  try {
    ;[assessment, exercises] = await Promise.all([getPerformanceAssessmentById(id), getAssessmentExercises(id)])
  } catch {
    notFound()
  }

  // Fetch messages for each exercise in parallel
  const messagesMap: Record<string, Awaited<ReturnType<typeof getAssessmentMessages>>> = {}
  const messageResults = await Promise.all(
    exercises.map((ex) => getAssessmentMessages(ex.id).then((msgs) => ({ exerciseId: ex.id, msgs }))),
  )
  for (const { exerciseId, msgs } of messageResults) {
    messagesMap[exerciseId] = msgs
  }

  // Generate signed video URLs for exercises that have client videos
  const videoUrlsMap: Record<string, string> = {}
  const videoResults = await Promise.all(
    exercises
      .filter((ex) => ex.video_path)
      .map((ex) =>
        getSignedVideoUrl(ex.video_path!)
          .then((url) => ({ exerciseId: ex.id, url }))
          .catch(() => ({ exerciseId: ex.id, url: null })),
      ),
  )
  for (const { exerciseId, url } of videoResults) {
    if (url) videoUrlsMap[exerciseId] = url
  }

  return (
    <div>
      <Link
        href="/admin/performance-assessments"
        className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ArrowLeft className="size-3.5" />
        Back to Assessments
      </Link>

      <PerformanceAssessmentDetail
        assessment={assessment}
        exercises={exercises}
        messagesMap={messagesMap}
        videoUrlsMap={videoUrlsMap}
        currentUserId={session.user.id}
      />
    </div>
  )
}
