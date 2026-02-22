"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Calendar,
} from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { WorkoutDay } from "@/components/client/WorkoutDay"
import type { WorkoutDayProps } from "@/components/client/WorkoutDay"

interface ProgramWorkout {
  programName: string
  category: string | string[]
  assignmentId: string
  currentWeek: number
  totalWeeks: number
  weeks: Record<number, WorkoutDayProps[]>
}

interface WorkoutTabsProps {
  programs: ProgramWorkout[]
  todayDow: number
}

const SHORT_DAYS: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
}

// ─── Program Selector Card ────────────────────────────────────────────────

function ProgramCard({
  program,
  onSelect,
  todayDow,
}: {
  program: ProgramWorkout
  onSelect: () => void
  todayDow: number
}) {
  const allWeekKeys = Object.keys(program.weeks ?? {}).map(Number)
  const currentDays =
    program.weeks?.[program.currentWeek] ??
    program.weeks?.[allWeekKeys[0]] ??
    []
  const totalExercises = currentDays.reduce(
    (sum, d) => sum + d.exercises.length,
    0
  )
  const loggedToday = currentDays.reduce(
    (sum, d) => sum + d.exercises.filter((e) => e.loggedToday).length,
    0
  )
  const totalToday = currentDays
    .filter((d) => d.day === todayDow)
    .reduce((sum, d) => sum + d.exercises.length, 0)

  return (
    <button
      onClick={onSelect}
      className="w-full text-left bg-white rounded-xl border border-border p-4 hover:border-primary/30 hover:shadow-sm transition-all active:scale-[0.98]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground text-sm">
            {program.programName}
          </h3>
          <span className="inline-flex gap-1 mt-1 flex-wrap">
            {(Array.isArray(program.category) ? program.category : [program.category]).map((cat) => (
              <span key={cat} className="inline-block rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium capitalize">
                {cat.replace("_", " ")}
              </span>
            ))}
          </span>
        </div>
        <div className="shrink-0 size-10 rounded-lg bg-primary/5 flex items-center justify-center">
          <Dumbbell className="size-5 text-primary" />
        </div>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Calendar className="size-3" />
          Week {program.currentWeek}/{program.totalWeeks}
        </span>
        <span>{totalExercises} exercises</span>
        {totalToday > 0 && (
          <span className="flex items-center gap-1 text-primary font-medium">
            <CheckCircle2 className="size-3" />
            {loggedToday}/{totalToday} today
          </span>
        )}
      </div>
    </button>
  )
}

// ─── Workout Detail View (week + day tabs + exercises) ────────────────────

function ProgramDetail({
  program,
  onBack,
  showBack,
  todayDow,
}: {
  program: ProgramWorkout
  onBack: () => void
  showBack: boolean
  todayDow: number
}) {
  const weekKeys = Object.keys(program.weeks ?? {}).map(Number).sort((a, b) => a - b)
  // currentWeek=0 means program hasn't started yet — default to week 1
  const effectiveCurrentWeek = program.currentWeek || 1
  const safeCurrentWeek = weekKeys.includes(effectiveCurrentWeek)
    ? effectiveCurrentWeek
    : weekKeys[0] ?? 1

  const [selectedWeek, setSelectedWeek] = useState(safeCurrentWeek)
  const [sessionLoggedIds, setSessionLoggedIds] = useState<Set<string>>(
    new Set()
  )

  const days = program.weeks?.[selectedWeek] ?? []
  const allDays = days.map((d) => d.day).sort((a, b) => a - b)
  // Only auto-select today's day when the program has started and we're on the current week
  const programStarted = program.currentWeek > 0
  const isCurrentWeekInit = programStarted && selectedWeek === effectiveCurrentWeek
  const defaultDay = isCurrentWeekInit && allDays.includes(todayDow)
    ? todayDow
    : allDays[0] ?? 1
  const [selectedDay, setSelectedDay] = useState(defaultDay)

  // Reset selected day when week changes and current day isn't in new week
  function handleWeekChange(week: number) {
    setSelectedWeek(week)
    const newDays = (program.weeks?.[week] ?? [])
      .map((d) => d.day)
      .sort((a, b) => a - b)
    if (!newDays.includes(selectedDay)) {
      const isNewWeekCurrent = programStarted && week === effectiveCurrentWeek
      const fallback = isNewWeekCurrent && newDays.includes(todayDow)
        ? todayDow
        : newDays[0] ?? 1
      setSelectedDay(fallback)
    }
  }

  function isDayComplete(day: number): boolean {
    const dayData = days.find((d) => d.day === day)
    if (!dayData || dayData.exercises.length === 0) return true
    return dayData.exercises.every(
      (e) => e.loggedToday || sessionLoggedIds.has(e.exercise.id)
    )
  }

  const dayData = days.find((d) => d.day === selectedDay)

  // Progress calculation for selected day
  const dayExercises = dayData?.exercises ?? []
  const loggedCount = dayExercises.filter(
    (e) => e.loggedToday || sessionLoggedIds.has(e.exercise.id)
  ).length
  const totalCount = dayExercises.length
  const progressPct =
    totalCount > 0 ? Math.round((loggedCount / totalCount) * 100) : 0
  const remaining = totalCount - loggedCount

  function handleExerciseLogged(exerciseId: string) {
    setSessionLoggedIds((prev) => new Set(prev).add(exerciseId))
  }

  const isCurrentWeek = programStarted && selectedWeek === effectiveCurrentWeek

  return (
    <div>
      {/* Back button + program name */}
      {showBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm font-medium text-primary mb-3 -ml-1 hover:text-primary/80 transition-colors"
        >
          <ChevronLeft className="size-4" />
          All Programs
        </button>
      )}

      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-base font-semibold text-foreground">
          {program.programName}
        </h2>
        {(Array.isArray(program.category) ? program.category : [program.category]).map((cat) => (
          <span key={cat} className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium capitalize">
            {cat.replace("_", " ")}
          </span>
        ))}
      </div>

      {/* Week selector */}
      {program.totalWeeks > 1 && (
        <div className="flex items-center justify-between mb-4 bg-white rounded-xl border border-border px-4 py-2.5">
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            disabled={selectedWeek <= 1}
            onClick={() => handleWeekChange(selectedWeek - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">
              Week {selectedWeek}
              <span className="text-muted-foreground font-normal">
                {" "}
                / {program.totalWeeks}
              </span>
            </p>
            {isCurrentWeek && (
              <p className="text-[10px] text-primary font-medium">
                Current week
              </p>
            )}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            disabled={selectedWeek >= program.totalWeeks}
            onClick={() => handleWeekChange(selectedWeek + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}

      {/* Day selector pills */}
      {allDays.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4 -mx-1 px-1 scrollbar-none">
          {allDays.map((day) => {
            const isToday = day === todayDow && isCurrentWeek
            const isSelected = day === selectedDay
            const isComplete = isDayComplete(day)

            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={cn(
                  "relative flex flex-col items-center min-w-[52px] px-3 py-2 rounded-xl text-xs font-medium transition-all shrink-0",
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : isComplete
                      ? "bg-success/10 border border-success/30 text-success hover:border-success/50"
                      : "bg-white border border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                )}
              >
                <span
                  className={cn(
                    "text-[10px]",
                    isSelected
                      ? "text-primary-foreground/70"
                      : isComplete
                        ? "text-success/70"
                        : "text-muted-foreground/60"
                  )}
                >
                  {SHORT_DAYS[day] ?? `D${day}`}
                </span>
                <span className="text-sm font-semibold">{day}</span>
                {isToday && (
                  <span
                    className={cn(
                      "absolute -top-0.5 -right-0.5 size-2 rounded-full",
                      isSelected ? "bg-white" : "bg-primary"
                    )}
                  />
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Session progress bar */}
      {totalCount > 0 && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground">
                {loggedCount}/{totalCount}
              </span>{" "}
              exercises
            </span>
            <span className="font-semibold text-foreground">
              {progressPct}%
            </span>
          </div>
          <Progress
            value={progressPct}
            className={cn(
              "h-2",
              progressPct === 100 &&
                "[&>[data-slot=progress-indicator]]:bg-success"
            )}
          />
          {remaining === 1 && (
            <p className="text-xs text-success font-medium">
              Almost there! 1 to go
            </p>
          )}
        </div>
      )}

      {/* Workout content for selected day */}
      <div className="space-y-6">
        <AnimatePresence mode="wait">
          {dayData && dayData.exercises.length > 0 ? (
            <motion.div
              key={`${selectedWeek}-${selectedDay}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <WorkoutDay
                day={dayData.day}
                dayLabel={dayData.dayLabel}
                exercises={dayData.exercises}
                assignmentId={program.assignmentId}
                onExerciseLogged={handleExerciseLogged}
              />
            </motion.div>
          ) : (
            <motion.div
              key="rest"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="bg-white rounded-xl border border-border p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  {allDays.length === 0
                    ? "No exercises for this week."
                    : "Rest day — no exercises scheduled."}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────

export function WorkoutTabs({ programs, todayDow }: WorkoutTabsProps) {
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(
    programs.length === 1 ? programs[0].assignmentId : null
  )

  const selectedProgram = programs.find(
    (p) => p.assignmentId === selectedProgramId
  )

  if (selectedProgram) {
    return (
      <ProgramDetail
        program={selectedProgram}
        onBack={() => setSelectedProgramId(null)}
        showBack={programs.length > 1}
        todayDow={todayDow}
      />
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground mb-1">
        Select a workout program to get started.
      </p>
      {programs.map((program) => (
        <ProgramCard
          key={program.assignmentId}
          program={program}
          onSelect={() => setSelectedProgramId(program.assignmentId)}
          todayDow={todayDow}
        />
      ))}
    </div>
  )
}
