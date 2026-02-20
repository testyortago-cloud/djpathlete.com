"use client"

import { useState } from "react"
import {
  Dumbbell,
  Trophy,
  Flame,
  TrendingUp,
  Award,
  ChevronDown,
  ChevronUp,
  Star,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"

interface ClientProgressViewProps {
  userId: string
  achievements: Array<{
    id: string
    achievement_type: string
    title: string
    description: string | null
    metric_value: number | null
    earned_at: string
    icon: string
  }>
  recentProgress: Array<{
    id: string
    exercise_name: string
    weight_kg: number | null
    sets_completed: number | null
    reps_completed: string | null
    rpe: number | null
    is_pr: boolean
    completed_at: string
  }>
  stats: {
    totalWorkouts: number
    totalPRs: number
    currentStreak: number
    uniqueExercises: number
  }
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatShortDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

const ACHIEVEMENT_ICONS: Record<string, typeof Trophy> = {
  trophy: Trophy,
  star: Star,
  flame: Flame,
  award: Award,
  trending_up: TrendingUp,
  dumbbell: Dumbbell,
}

function getAchievementIcon(iconName: string) {
  return ACHIEVEMENT_ICONS[iconName] ?? Trophy
}

const STAT_CARDS = [
  {
    key: "totalWorkouts" as const,
    label: "Total Workouts",
    icon: Dumbbell,
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  {
    key: "totalPRs" as const,
    label: "Personal Records",
    icon: Trophy,
    color: "text-accent-foreground",
    bgColor: "bg-accent/20",
  },
  {
    key: "currentStreak" as const,
    label: "Day Streak",
    icon: Flame,
    color: "text-warning",
    bgColor: "bg-warning/10",
  },
  {
    key: "uniqueExercises" as const,
    label: "Exercises",
    icon: TrendingUp,
    color: "text-success",
    bgColor: "bg-success/10",
  },
]

export function ClientProgressView({
  userId,
  achievements,
  recentProgress,
  stats,
}: ClientProgressViewProps) {
  const [achievementsOpen, setAchievementsOpen] = useState(true)
  const [workoutsOpen, setWorkoutsOpen] = useState(true)

  const hasAnyData =
    stats.totalWorkouts > 0 ||
    achievements.length > 0 ||
    recentProgress.length > 0

  if (!hasAnyData) {
    return (
      <div className="bg-white rounded-xl border border-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="size-5 text-primary" />
          <h2 className="text-lg font-semibold text-primary">
            Progress & Tracking
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          No workout data recorded yet. Progress will appear here once the
          client starts logging workouts.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {STAT_CARDS.map((stat) => {
          const Icon = stat.icon
          return (
            <div
              key={stat.key}
              className="bg-white rounded-xl border border-border p-4"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex items-center justify-center size-10 rounded-lg ${stat.bgColor} shrink-0`}
                >
                  <Icon className={`size-5 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-semibold text-foreground">
                    {stats[stat.key]}
                  </p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Achievements Section */}
      {achievements.length > 0 && (
        <div className="bg-white rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setAchievementsOpen(!achievementsOpen)}
            className="flex items-center justify-between w-full p-6 text-left"
          >
            <div className="flex items-center gap-2">
              <Trophy className="size-5 text-primary" />
              <h2 className="text-lg font-semibold text-primary">
                Achievements
              </h2>
              <span className="text-xs text-muted-foreground ml-1">
                ({achievements.length})
              </span>
            </div>
            {achievementsOpen ? (
              <ChevronUp className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </button>

          {achievementsOpen && (
            <div className="px-6 pb-6 -mt-2">
              <div className="divide-y divide-border">
                {achievements.slice(0, 10).map((achievement) => {
                  const Icon = getAchievementIcon(achievement.icon)
                  return (
                    <div
                      key={achievement.id}
                      className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-center justify-center size-8 rounded-full bg-accent/20 shrink-0">
                        <Icon className="size-4 text-accent-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {achievement.title}
                        </p>
                        {achievement.description && (
                          <p className="text-xs text-muted-foreground truncate">
                            {achievement.description}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        {achievement.metric_value !== null && (
                          <p className="text-sm font-medium text-foreground">
                            {achievement.metric_value} kg
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {formatShortDate(achievement.earned_at)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
              {achievements.length > 10 && (
                <p className="text-xs text-muted-foreground mt-3 text-center">
                  Showing 10 of {achievements.length} achievements
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recent Workouts Table */}
      {recentProgress.length > 0 && (
        <div className="bg-white rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setWorkoutsOpen(!workoutsOpen)}
            className="flex items-center justify-between w-full p-6 text-left"
          >
            <div className="flex items-center gap-2">
              <Dumbbell className="size-5 text-primary" />
              <h2 className="text-lg font-semibold text-primary">
                Recent Workouts
              </h2>
              <span className="text-xs text-muted-foreground ml-1">
                ({recentProgress.length})
              </span>
            </div>
            {workoutsOpen ? (
              <ChevronUp className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </button>

          {workoutsOpen && (
            <div className="px-6 pb-6 -mt-2">
              <Table>
                <TableHeader>
                  <TableRow className="bg-surface/50">
                    <TableHead className="text-muted-foreground">
                      Date
                    </TableHead>
                    <TableHead className="text-muted-foreground">
                      Exercise
                    </TableHead>
                    <TableHead className="text-muted-foreground hidden sm:table-cell">
                      Weight
                    </TableHead>
                    <TableHead className="text-muted-foreground hidden sm:table-cell">
                      Sets x Reps
                    </TableHead>
                    <TableHead className="text-muted-foreground hidden md:table-cell">
                      RPE
                    </TableHead>
                    <TableHead className="text-muted-foreground text-right">
                      PR
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentProgress.slice(0, 20).map((entry) => (
                    <TableRow
                      key={entry.id}
                      className={
                        entry.is_pr
                          ? "bg-accent/10 hover:bg-accent/20"
                          : ""
                      }
                    >
                      <TableCell className="text-muted-foreground text-xs">
                        {formatShortDate(entry.completed_at)}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {entry.exercise_name}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden sm:table-cell">
                        {entry.weight_kg !== null
                          ? `${entry.weight_kg} kg`
                          : "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden sm:table-cell">
                        {entry.sets_completed !== null &&
                        entry.reps_completed !== null
                          ? `${entry.sets_completed} x ${entry.reps_completed}`
                          : entry.sets_completed !== null
                            ? `${entry.sets_completed} sets`
                            : entry.reps_completed !== null
                              ? entry.reps_completed
                              : "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden md:table-cell">
                        {entry.rpe !== null ? entry.rpe : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.is_pr && (
                          <Badge className="bg-accent/20 text-accent-foreground border-accent/30 text-xs">
                            PR
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {recentProgress.length > 20 && (
                <p className="text-xs text-muted-foreground mt-3 text-center">
                  Showing 20 of {recentProgress.length} entries
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
