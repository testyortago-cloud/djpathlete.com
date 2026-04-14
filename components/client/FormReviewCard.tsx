"use client"

import Link from "next/link"
import { Video, Clock, MessageSquare, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { FormReviewStatus } from "@/types/database"

interface FormReviewCardProps {
  id: string
  title: string
  status: FormReviewStatus
  createdAt: string
}

const statusConfig: Record<FormReviewStatus, { label: string; icon: typeof Clock; className: string }> = {
  pending: {
    label: "Pending",
    icon: Clock,
    className: "bg-amber-100 text-amber-700",
  },
  in_progress: {
    label: "In Progress",
    icon: MessageSquare,
    className: "bg-blue-100 text-blue-700",
  },
  reviewed: {
    label: "Reviewed",
    icon: CheckCircle2,
    className: "bg-green-100 text-green-700",
  },
}

export function FormReviewCard({ id, title, status, createdAt }: FormReviewCardProps) {
  const config = statusConfig[status]
  const StatusIcon = config.icon

  return (
    <Link
      href={`/client/form-reviews/${id}`}
      className="group block bg-white rounded-xl border border-border p-4 hover:border-primary/30 hover:shadow-sm transition-all"
    >
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center size-10 rounded-full bg-primary/10 shrink-0">
          <Video className="size-5 text-primary" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
              {title}
            </h3>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0",
                config.className,
              )}
            >
              <StatusIcon className="size-3" />
              {config.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {new Date(createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
      </div>
    </Link>
  )
}
