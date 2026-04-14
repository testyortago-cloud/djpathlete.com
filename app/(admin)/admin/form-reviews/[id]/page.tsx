import { requireAdmin } from "@/lib/auth-helpers"
import { notFound } from "next/navigation"
import { getFormReviewById, getFormReviewMessages } from "@/lib/db/form-reviews"
import { getSignedVideoUrl } from "@/lib/firebase-admin"
import { FormReviewDetail } from "@/components/admin/FormReviewDetail"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

export const metadata = { title: "Review Detail | Admin | DJP Athlete" }

export default async function AdminFormReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin()
  const { id } = await params

  let review: Awaited<ReturnType<typeof getFormReviewById>>
  let messages: Awaited<ReturnType<typeof getFormReviewMessages>>

  try {
    review = await getFormReviewById(id)
    messages = await getFormReviewMessages(id)
  } catch {
    notFound()
  }

  // Generate signed video URL
  let videoUrl: string | null = null
  try {
    if (review.video_path) {
      videoUrl = await getSignedVideoUrl(review.video_path)
    }
  } catch (err) {
    console.error("Failed to generate signed video URL:", err)
  }

  return (
    <div>
      <Link
        href="/admin/form-reviews"
        className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ArrowLeft className="size-3.5" />
        Back to Form Reviews
      </Link>

      <FormReviewDetail review={review} videoUrl={videoUrl} messages={messages} currentUserId={session.user.id} />
    </div>
  )
}
