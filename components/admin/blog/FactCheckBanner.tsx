"use client"

import { AlertTriangle, AlertOctagon, ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export type FactCheckStatus = "pending" | "passed" | "flagged" | "failed"

interface FactCheckBannerProps {
  status: FactCheckStatus
  flaggedCount: number
  open: boolean
  onToggle: () => void
}

export function FactCheckBanner({ status, flaggedCount, open, onToggle }: FactCheckBannerProps) {
  if (status === "passed" || status === "pending") return null

  const isFailed = status === "failed"
  const Icon = isFailed ? AlertOctagon : AlertTriangle

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "w-full flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md border",
        isFailed
          ? "bg-error/10 border-error/30 text-error"
          : "bg-warning/10 border-warning/30 text-warning",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 text-left">
        {isFailed
          ? "Fact-check failed — manual review recommended"
          : `${flaggedCount} claim${flaggedCount === 1 ? "" : "s"} flagged — review before publishing`}
      </span>
      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
    </button>
  )
}
