"use client"

import { toast } from "sonner"
import { Trophy, Flame, Star, CheckCircle2 } from "lucide-react"

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

export function showAchievementToast(achievement: {
  title: string
  description: string | null
  icon: string
  achievement_type: string
}) {
  const Icon = getIconForType(achievement.achievement_type)
  const iconColor = getAccentColorForType(achievement.achievement_type)
  const iconBg = getIconBgForType(achievement.achievement_type)

  toast.custom(
    (t) => (
      <div
        className="flex items-center gap-3 rounded-xl border border-border bg-white p-4 shadow-lg"
        onClick={() => toast.dismiss(t)}
      >
        <div
          className={`flex shrink-0 items-center justify-center size-10 rounded-full ${iconBg}`}
        >
          <Icon className={`size-5 ${iconColor}`} strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {achievement.title}
          </p>
          {achievement.description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {achievement.description}
            </p>
          )}
        </div>
      </div>
    ),
    {
      duration: 5000,
      position: "top-center",
    }
  )
}
