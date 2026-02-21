"use client"

import { motion } from "framer-motion"
import { Trophy, Flame, Star, CheckCircle2 } from "lucide-react"
import type { Achievement } from "@/types/database"

interface AchievementCardProps {
  achievement: Achievement
}

function getIconForType(type: string) {
  switch (type) {
    case "pr":
      return Trophy
    case "streak":
      return Flame
    case "milestone":
      return Star
    case "completion":
      return CheckCircle2
    default:
      return Trophy
  }
}

function getAccentColorForType(type: string) {
  switch (type) {
    case "pr":
      return "text-amber-500"
    case "streak":
      return "text-orange-500"
    case "milestone":
      return "text-emerald-500"
    case "completion":
      return "text-primary"
    default:
      return "text-accent"
  }
}

function getIconBgForType(type: string) {
  switch (type) {
    case "pr":
      return "bg-amber-500/10"
    case "streak":
      return "bg-orange-500/10"
    case "milestone":
      return "bg-emerald-500/10"
    case "completion":
      return "bg-primary/10"
    default:
      return "bg-accent/10"
  }
}

function getBorderForType(type: string) {
  switch (type) {
    case "pr":
      return "border-amber-200"
    case "streak":
      return "border-orange-200"
    case "milestone":
      return "border-emerald-200"
    case "completion":
      return "border-primary/20"
    default:
      return "border-border"
  }
}

export function AchievementCard({ achievement }: AchievementCardProps) {
  const Icon = getIconForType(achievement.achievement_type)
  const iconColor = getAccentColorForType(achievement.achievement_type)
  const iconBg = getIconBgForType(achievement.achievement_type)
  const borderColor = getBorderForType(achievement.achievement_type)

  const earnedDate = new Date(achievement.earned_at).toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
    }
  )

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={`bg-white rounded-xl border ${borderColor} p-3 sm:p-4 transition-shadow hover:shadow-md`}
    >
      <div className="flex items-start gap-2.5 sm:gap-3">
        <div
          className={`flex shrink-0 items-center justify-center size-9 sm:size-10 rounded-full ${iconBg}`}
        >
          <Icon className={`size-4 sm:size-5 ${iconColor}`} strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-xs sm:text-sm font-semibold text-foreground leading-snug">
              {achievement.title}
            </h3>
            <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap shrink-0">{earnedDate}</span>
          </div>
          {achievement.description && (
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {achievement.description}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  )
}
