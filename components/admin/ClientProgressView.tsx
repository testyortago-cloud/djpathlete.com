"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Dumbbell,
  Trophy,
  Flame,
  TrendingUp,
  Award,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Star,
  Loader2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useAdminWeightUnit } from "@/hooks/use-admin-weight-unit"
import type { SetDetail } from "@/types/database"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"


interface ProgramOption {
  assignmentId: string
  programName: string
}

interface ProgressEntry {
  id: string
  exercise_name: string
  weight_kg: number | null
  sets_completed: number | null
  reps_completed: string | null
  rpe: number | null
  is_pr: boolean
  completed_at: string
  set_details: SetDetail[] | null
}

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
  recentProgress: ProgressEntry[]
  stats: {
    totalWorkouts: number
    totalPRs: number
    currentStreak: number
    uniqueExercises: number
  }
  programs?: ProgramOption[]
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
    color: "text-accent",
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
  programs = [],
}: ClientProgressViewProps) {
  const { formatWeight } = useAdminWeightUnit()
  const [achievementsOpen, setAchievementsOpen] = useState(true)
  const [workoutsOpen, setWorkoutsOpen] = useState(true)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // Program filter state
  const [selectedAssignment, setSelectedAssignment] = useState<string>("all")
  const [filteredProgress, setFilteredProgress] = useState<ProgressEntry[]>(recentProgress)
  const [isLoading, setIsLoading] = useState(false)

  const fetchProgressForAssignment = useCallback(async (assignmentId: string) => {
    if (assignmentId === "all") {
      setFilteredProgress(recentProgress)
      return
    }

    setIsLoading(true)
    try {
      const res = await fetch(
        `/api/admin/clients/${userId}/progress?assignment_id=${assignmentId}`
      )
      if (!res.ok) throw new Error("Failed to fetch")
      const { data } = await res.json()

      const mapped: ProgressEntry[] = (data ?? []).map(
        (p: Record<string, unknown>) => ({
          id: p.id as string,
          exercise_name:
            (p.exercises as { name?: string } | null)?.name ?? "Unknown Exercise",
          weight_kg: p.weight_kg as number | null,
          sets_completed: p.sets_completed as number | null,
          reps_completed: p.reps_completed as string | null,
          rpe: p.rpe as number | null,
          is_pr: p.is_pr as boolean,
          completed_at: p.completed_at as string,
          set_details: (p.set_details ?? null) as SetDetail[] | null,
        })
      )
      setFilteredProgress(mapped)
    } catch {
      setFilteredProgress([])
    } finally {
      setIsLoading(false)
    }
  }, [userId, recentProgress])

  useEffect(() => {
    fetchProgressForAssignment(selectedAssignment)
  }, [selectedAssignment, fetchProgressForAssignment])

  function toggleRow(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

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
                        <Icon className="size-4 text-accent" />
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
                            {formatWeight(achievement.metric_value)}
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

      {/* Workout Logs */}
      <div className="bg-white rounded-xl border border-border">
        <button
          type="button"
          onClick={() => setWorkoutsOpen(!workoutsOpen)}
          className="flex items-center justify-between w-full p-6 text-left"
        >
          <div className="flex items-center gap-2">
            <Dumbbell className="size-5 text-primary" />
            <h2 className="text-lg font-semibold text-primary">
              Workout Logs
            </h2>
            <span className="text-xs text-muted-foreground ml-1">
              ({filteredProgress.length})
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
            {/* Program selector */}
            {programs.length > 0 && (
              <div className="flex items-center gap-2 mb-4">
                <label
                  htmlFor="program-filter"
                  className="text-xs font-medium text-muted-foreground whitespace-nowrap"
                >
                  Program:
                </label>
                <select
                  id="program-filter"
                  value={selectedAssignment}
                  onChange={(e) => setSelectedAssignment(e.target.value)}
                  className="flex h-8 w-full max-w-xs rounded-md border border-input bg-background px-2.5 text-xs shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="all">All Programs</option>
                  {programs.map((p) => (
                    <option key={p.assignmentId} value={p.assignmentId}>
                      {p.programName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 text-muted-foreground animate-spin" />
              </div>
            ) : filteredProgress.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No workout logs found for this program.
              </p>
            ) : (
              <>
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
                    {filteredProgress.map((entry) => {
                      const hasSetDetails =
                        entry.set_details && entry.set_details.length > 0
                      const isExpanded = expandedRows.has(entry.id)

                      return (
                        <>
                          <TableRow
                            key={entry.id}
                            className={`${
                              entry.is_pr
                                ? "bg-accent/10 hover:bg-accent/20"
                                : ""
                            } ${hasSetDetails ? "cursor-pointer" : ""}`}
                            onClick={
                              hasSetDetails
                                ? () => toggleRow(entry.id)
                                : undefined
                            }
                          >
                            <TableCell className="text-muted-foreground text-xs">
                              <span className="flex items-center gap-1">
                                {hasSetDetails && (
                                  <ChevronRight
                                    className={`size-3.5 text-muted-foreground transition-transform ${
                                      isExpanded ? "rotate-90" : ""
                                    }`}
                                  />
                                )}
                                {formatShortDate(entry.completed_at)}
                              </span>
                            </TableCell>
                            <TableCell className="font-medium text-foreground">
                              {entry.exercise_name}
                            </TableCell>
                            <TableCell className="text-muted-foreground hidden sm:table-cell">
                              {formatWeight(entry.weight_kg)}
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
                                <Badge className="bg-accent/20 text-accent border-accent/30 text-xs">
                                  PR
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                          {isExpanded && hasSetDetails && (
                            <TableRow key={`${entry.id}-details`}>
                              <TableCell colSpan={6} className="p-0">
                                <div className="bg-surface/30 px-6 py-3 ml-4 border-l-2 border-primary/20">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-muted-foreground">
                                        <th className="text-left py-1 pr-4 font-medium">
                                          Set
                                        </th>
                                        <th className="text-left py-1 pr-4 font-medium">
                                          Weight
                                        </th>
                                        <th className="text-left py-1 pr-4 font-medium">
                                          Reps
                                        </th>
                                        <th className="text-left py-1 font-medium">
                                          RPE
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {entry.set_details!.map((set) => (
                                        <tr
                                          key={set.set_number}
                                          className="text-foreground"
                                        >
                                          <td className="py-1 pr-4">
                                            {set.set_number}
                                          </td>
                                          <td className="py-1 pr-4">
                                            {formatWeight(set.weight_kg ?? null)}
                                          </td>
                                          <td className="py-1 pr-4">
                                            {set.reps}
                                          </td>
                                          <td className="py-1">
                                            {set.rpe !== null ? set.rpe : "-"}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      )
                    })}
                  </TableBody>
                </Table>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
