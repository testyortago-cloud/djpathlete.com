"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { VideoPlayer } from "@/components/shared/VideoPlayer"
import { FormReviewThread } from "@/components/shared/FormReviewThread"
import { Button } from "@/components/ui/button"
import { CheckCircle2, Clock, MessageSquare, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { FormReviewStatus } from "@/types/database"

interface FormReviewDetailProps {
  review: {
    id: string
    title: string
    notes: string | null
    status: string
    created_at: string
    video_path: string
    users?: { first_name: string; last_name: string; email: string; avatar_url?: string | null } | null
  }
  videoUrl: string | null
  messages: Array<{
    id: string
    user_id: string
    message: string
    created_at: string
    users?: { first_name: string; last_name: string; avatar_url?: string | null; role?: string } | null
  }>
  currentUserId: string
}

const statusConfig: Record<FormReviewStatus, { label: string; icon: typeof Clock; className: string }> = {
  pending: { label: "Pending Review", icon: Clock, className: "bg-amber-100 text-amber-700" },
  in_progress: { label: "In Progress", icon: MessageSquare, className: "bg-blue-100 text-blue-700" },
  reviewed: { label: "Reviewed", icon: CheckCircle2, className: "bg-green-100 text-green-700" },
}

export function FormReviewDetail({ review, videoUrl, messages, currentUserId }: FormReviewDetailProps) {
  const router = useRouter()
  const [status, setStatus] = useState(review.status as FormReviewStatus)
  const [updating, setUpdating] = useState(false)

  const config = statusConfig[status]
  const StatusIcon = config.icon
  const clientName = review.users ? `${review.users.first_name} ${review.users.last_name}` : "Unknown"
  async function markAsReviewed() {
    setUpdating(true)
    try {
      const res = await fetch(`/api/admin/form-reviews/${review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "reviewed" }),
      })
      if (!res.ok) throw new Error("Failed to update status")
      setStatus("reviewed")
      toast.success("Marked as reviewed")
      router.refresh()
    } catch {
      toast.error("Failed to update status")
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-primary">{review.title}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
            <span>{clientName}</span>
            <span className="text-border">|</span>
            <span>
              {new Date(review.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full",
              config.className,
            )}
          >
            <StatusIcon className="size-3.5" />
            {config.label}
          </span>
          {status !== "reviewed" && (
            <Button size="sm" variant="outline" onClick={markAsReviewed} disabled={updating}>
              {updating ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4 mr-1.5" />
              )}
              Mark as Reviewed
            </Button>
          )}
        </div>
      </div>

      {/* Video */}
      {videoUrl ? (
        <VideoPlayer src={videoUrl} />
      ) : (
        <div className="bg-muted rounded-xl p-8 text-center text-sm text-muted-foreground">Video not available</div>
      )}

      {/* Client info + notes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-2">Client</h3>
          <p className="text-sm text-foreground">{clientName}</p>
          <p className="text-xs text-muted-foreground">{review.users?.email}</p>
        </div>
        {review.notes && (
          <div className="bg-white rounded-xl border border-border p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Client Notes</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{review.notes}</p>
          </div>
        )}
      </div>

      {/* Conversation thread */}
      <div className="bg-white rounded-xl border border-border p-4">
        <FormReviewThread
          messages={messages}
          currentUserId={currentUserId}
          reviewId={review.id}
          apiBasePath="/api/admin/form-reviews"
        />
      </div>
    </div>
  )
}
