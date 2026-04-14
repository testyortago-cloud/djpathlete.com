import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import { getFormReviewById, getFormReviewMessages } from "@/lib/db/form-reviews"
import { getSignedVideoUrl } from "@/lib/firebase-admin"
import { VideoPlayer } from "@/components/shared/VideoPlayer"
import { FormReviewThread } from "@/components/shared/FormReviewThread"
import { ArrowLeft, Clock, MessageSquare, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import type { FormReviewStatus } from "@/types/database"

export const metadata = { title: "Form Review | DJP Athlete" }

const statusConfig: Record<FormReviewStatus, { label: string; icon: typeof Clock; className: string }> = {
  pending: { label: "Pending Review", icon: Clock, className: "bg-amber-100 text-amber-700" },
  in_progress: { label: "In Progress", icon: MessageSquare, className: "bg-blue-100 text-blue-700" },
  reviewed: { label: "Reviewed", icon: CheckCircle2, className: "bg-green-100 text-green-700" },
}

export default async function FormReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const { id } = await params
  let review: Awaited<ReturnType<typeof getFormReviewById>>
  let messages: Awaited<ReturnType<typeof getFormReviewMessages>>

  try {
    review = await getFormReviewById(id)
    if (review.client_user_id !== session.user.id) notFound()
    messages = await getFormReviewMessages(id)
  } catch {
    notFound()
  }

  const status = review.status as FormReviewStatus
  const config = statusConfig[status]
  const StatusIcon = config.icon
  // Get signed URL for the video
  let videoUrl: string | null = null
  try {
    if (review.video_path) {
      videoUrl = await getSignedVideoUrl(review.video_path)
    }
  } catch (err) {
    console.error("Failed to generate video URL:", err)
  }

  return (
    <div>
      <Link
        href="/client/form-reviews"
        className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
      >
        <ArrowLeft className="size-3.5" />
        Back to Form Reviews
      </Link>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl sm:text-2xl font-semibold text-primary">{review.title}</h1>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full",
            config.className,
          )}
        >
          <StatusIcon className="size-3.5" />
          {config.label}
        </span>
      </div>

      {/* Date info */}
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mb-5">
        <span>
          {new Date(review.created_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </div>

      {/* Video */}
      {videoUrl ? (
        <div className="mb-6">
          <VideoPlayer src={videoUrl} />
        </div>
      ) : (
        <div className="mb-6 bg-muted rounded-xl p-8 text-center text-sm text-muted-foreground">
          Video not available
        </div>
      )}

      {/* Notes */}
      {review.notes && (
        <div className="bg-white rounded-xl border border-border p-4 mb-6">
          <h3 className="text-sm font-semibold text-foreground mb-2">Your Notes</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{review.notes}</p>
        </div>
      )}

      {/* Conversation thread */}
      <div className="bg-white rounded-xl border border-border p-4">
        <FormReviewThread
          messages={messages}
          currentUserId={session.user.id}
          reviewId={id}
          apiBasePath="/api/client/form-reviews"
        />
      </div>
    </div>
  )
}
