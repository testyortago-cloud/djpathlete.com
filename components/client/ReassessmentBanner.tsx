"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { RefreshCw, ArrowRight } from "lucide-react"

interface ReassessmentBannerProps {
  completedAssignmentId: string
}

export function ReassessmentBanner({ completedAssignmentId }: ReassessmentBannerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="mb-6"
    >
      <Link
        href={`/client/reassessment?assignmentId=${completedAssignmentId}`}
        className="group flex items-center gap-4 rounded-xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-accent/10 p-4 sm:p-5 hover:from-primary/15 hover:to-accent/15 transition-all"
      >
        <div className="flex items-center justify-center size-11 shrink-0 rounded-full bg-primary/15">
          <RefreshCw className="size-5 text-primary" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground text-sm sm:text-base">Your program is complete!</p>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Take a quick reassessment to get your next personalized program.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-medium text-primary shrink-0 group-hover:gap-2.5 transition-all">
          <span className="hidden sm:inline">Start Reassessment</span>
          <ArrowRight className="size-4" />
        </div>
      </Link>
    </motion.div>
  )
}
