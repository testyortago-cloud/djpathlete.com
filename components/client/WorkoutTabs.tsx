"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import { CheckCircle2, ChevronLeft, ChevronRight, Dumbbell, Calendar, Lock } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { WorkoutDay } from "@/components/client/WorkoutDay"
import { CompleteWeekButton } from "@/components/client/CompleteWeekButton"
import type { WorkoutDayProps } from "@/components/client/WorkoutDay"

interface ProgramWorkout {
  programName: string
  category: string | string[]
  difficulty: string
  periodization: string | null
  splitType: string | null
  assignmentId: string
  currentWeek: number
  totalWeeks: number
  weeks: Record<number, WorkoutDayProps[]>
  lockedWeeks?: Record<number, { priceCents: number }>
}

interface WorkoutTabsProps {
  programs: ProgramWorkout[]
  todayDow: number
}

/** Build a sequential "Day N" map from sorted day-of-week values */
function buildDayIndexMap(days: number[]): Map<number, number> {
  const map = new Map<number, number>()
  const sorted = [...days].sort((a, b) => a - b)
  sorted.forEach((dow, i) => map.set(dow, i + 1))
  return map
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
  const currentDays = program.weeks?.[program.currentWeek] ?? program.weeks?.[allWeekKeys[0]] ?? []
  const totalExercises = currentDays.reduce((sum, d) => sum + d.exercises.length, 0)
  const loggedToday = currentDays.reduce((sum, d) => sum + d.exercises.filter((e) => e.loggedToday).length, 0)
  const totalToday = currentDays.filter((d) => d.day === todayDow).reduce((sum, d) => sum + d.exercises.length, 0)

  const weekProgressPct =
    program.totalWeeks > 0 ? Math.round(((program.currentWeek - 1) / program.totalWeeks) * 100) : 0

  return (
    <button
      onClick={onSelect}
      className="w-full text-left bg-white rounded-xl border border-border p-4 hover:border-primary/30 hover:shadow-sm transition-all active:scale-[0.98]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground text-sm">{program.programName}</h3>
          <span className="inline-flex gap-1 mt-1 flex-wrap">
            {(Array.isArray(program.category) ? program.category : [program.category]).map((cat) => (
              <span
                key={cat}
                className="inline-block rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium capitalize"
              >
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

      {/* Week progress bar on card */}
      {program.totalWeeks > 1 && (
        <div className="mt-2.5">
          <Progress value={weekProgressPct} className="h-1.5" />
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <span className="inline-flex items-center gap-1 rounded-full bg-success px-3 py-1 text-xs font-medium text-white">
          {loggedToday > 0 ? "Resume" : "Start"}
        </span>
      </div>
    </button>
  )
}

// ─── Week Progress Indicator ─────────────────────────────────────────────

function WeekProgressIndicator({ currentWeek, totalWeeks }: { currentWeek: number; totalWeeks: number }) {
  if (totalWeeks <= 1) return null

  const completedWeeks = currentWeek - 1
  const progressPct = Math.round((completedWeeks / totalWeeks) * 100)

  return (
    <div className="mb-4 bg-white rounded-xl border border-border px-4 py-3">
      <div className="flex items-center justify-between text-xs mb-2">
        <span className="text-muted-foreground">Program Progress</span>
        <span className="font-semibold text-foreground">
          {completedWeeks}/{totalWeeks} weeks
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: totalWeeks }, (_, i) => {
          const weekNum = i + 1
          const isCompleted = weekNum < currentWeek
          const isCurrent = weekNum === currentWeek
          return (
            <div
              key={weekNum}
              className={cn(
                "flex-1 h-2 rounded-full transition-colors",
                isCompleted ? "bg-success" : isCurrent ? "bg-primary" : "bg-muted",
              )}
            />
          )
        })}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5">{progressPct}% complete</p>
    </div>
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
  const router = useRouter()
  const [isPurchasing, setIsPurchasing] = useState(false)
  const lockedWeeks = program.lockedWeeks ?? {}

  async function handlePurchaseWeek(weekNumber: number) {
    setIsPurchasing(true)
    try {
      const res = await fetch("/api/stripe/week-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId: program.assignmentId,
          weekNumber,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to start checkout")
      }
      const { url } = await res.json()
      if (url) {
        window.location.href = url
      }
    } catch (err) {
      const { toast } = await import("sonner")
      toast.error(err instanceof Error ? err.message : "Failed to start checkout")
    } finally {
      setIsPurchasing(false)
    }
  }

  const weekKeys = Object.keys(program.weeks ?? {})
    .map(Number)
    .sort((a, b) => a - b)
  // currentWeek=0 means program hasn't started yet — default to week 1
  const effectiveCurrentWeek = program.currentWeek || 1
  const safeCurrentWeek = weekKeys.includes(effectiveCurrentWeek) ? effectiveCurrentWeek : (weekKeys[0] ?? 1)

  const [selectedWeek, setSelectedWeek] = useState(safeCurrentWeek)
  const [sessionLoggedIds, setSessionLoggedIds] = useState<Set<string>>(new Set())

  const days = program.weeks?.[selectedWeek] ?? []
  const allDays = days.map((d) => d.day).sort((a, b) => a - b)
  const programStarted = program.currentWeek > 0

  // Default to the first incomplete day (resume where you left off)
  // If all days are complete, show the last day. If none started, show Day 1.
  const firstIncompleteDay = (() => {
    for (const day of allDays) {
      const dayData = days.find((d) => d.day === day)
      if (!dayData || dayData.exercises.length === 0) continue
      const allLogged = dayData.exercises.every((e) => e.loggedToday)
      if (!allLogged) return day
    }
    // All complete — show last day; or fallback to first
    return allDays[allDays.length - 1] ?? allDays[0] ?? 1
  })()
  const [selectedDay, setSelectedDay] = useState(firstIncompleteDay)

  // Reset selected day when week changes and current day isn't in new week
  function handleWeekChange(week: number) {
    setSelectedWeek(week)
    const newDays = (program.weeks?.[week] ?? []).map((d) => d.day).sort((a, b) => a - b)
    if (!newDays.includes(selectedDay)) {
      setSelectedDay(newDays[0] ?? 1)
    }
  }

  function isDayComplete(day: number): boolean {
    const dayData = days.find((d) => d.day === day)
    if (!dayData || dayData.exercises.length === 0) return true
    return dayData.exercises.every((e) => e.loggedToday || sessionLoggedIds.has(e.exercise.id))
  }

  const dayData = days.find((d) => d.day === selectedDay)

  // Progress calculation for selected day
  const dayExercises = dayData?.exercises ?? []
  const loggedCount = dayExercises.filter((e) => e.loggedToday || sessionLoggedIds.has(e.exercise.id)).length
  const totalCount = dayExercises.length
  const progressPct = totalCount > 0 ? Math.round((loggedCount / totalCount) * 100) : 0
  const remaining = totalCount - loggedCount

  // Check if ALL exercises across ALL days in the current week are logged
  const allWeekExercisesLogged =
    days.length > 0 &&
    days.every(
      (d) => d.exercises.length === 0 || d.exercises.every((e) => e.loggedToday || sessionLoggedIds.has(e.exercise.id)),
    )

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
        <h2 className="text-base font-semibold text-foreground">{program.programName}</h2>
        {(Array.isArray(program.category) ? program.category : [program.category]).map((cat) => (
          <span
            key={cat}
            className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium capitalize"
          >
            {cat.replace("_", " ")}
          </span>
        ))}
      </div>

      {/* Week progress indicator */}
      <WeekProgressIndicator currentWeek={effectiveCurrentWeek} totalWeeks={program.totalWeeks} />

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
              {lockedWeeks[selectedWeek] && <Lock className="inline size-3 ml-1 text-warning" />}
              <span className="text-muted-foreground font-normal"> / {program.totalWeeks}</span>
            </p>
            {isCurrentWeek && !lockedWeeks[selectedWeek] && (
              <p className="text-[10px] text-primary font-medium">Current week</p>
            )}
            {lockedWeeks[selectedWeek] && <p className="text-[10px] text-warning font-medium">Payment required</p>}
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
      {allDays.length > 0 &&
        (() => {
          const dayIndexMap = buildDayIndexMap(allDays)
          return (
            <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4 -mx-1 px-1 scrollbar-none">
              {allDays.map((day) => {
                const dayIndex = dayIndexMap.get(day) ?? 1
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
                          : "bg-white border border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "text-[10px] uppercase",
                        isSelected
                          ? "text-primary-foreground/70"
                          : isComplete
                            ? "text-success/70"
                            : "text-muted-foreground/60",
                      )}
                    >
                      Day
                    </span>
                    <span className="text-sm font-semibold">{dayIndex}</span>
                    {/* Today indicator removed for cleaner look */}
                  </button>
                )
              })}
            </div>
          )
        })()}

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
            <span className="font-semibold text-foreground">{progressPct}%</span>
          </div>
          <Progress
            value={progressPct}
            className={cn("h-2", progressPct === 100 && "[&>[data-slot=progress-indicator]]:bg-success")}
          />
          {remaining === 1 && <p className="text-xs text-success font-medium">Almost there! 1 to go</p>}
        </div>
      )}

      {/* Workout content for selected day */}
      <div className="space-y-6">
        <AnimatePresence mode="wait">
          {lockedWeeks[selectedWeek] ? (
            <motion.div
              key={`locked-${selectedWeek}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="bg-white rounded-xl border-2 border-warning/30 p-8 text-center space-y-4">
                <div className="flex justify-center">
                  <div className="size-14 rounded-full bg-warning/10 flex items-center justify-center">
                    <Lock className="size-7 text-warning" />
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground mb-1">Week {selectedWeek} is Locked</h3>
                  <p className="text-sm text-muted-foreground">Purchase access to unlock this week&apos;s workouts.</p>
                </div>
                {lockedWeeks[selectedWeek].priceCents > 0 && (
                  <p className="text-2xl font-bold text-foreground">
                    ${(lockedWeeks[selectedWeek].priceCents / 100).toFixed(2)}
                  </p>
                )}
                <Button
                  onClick={() => handlePurchaseWeek(selectedWeek)}
                  disabled={isPurchasing}
                  className="min-w-[160px]"
                >
                  {isPurchasing ? "Processing..." : "Unlock Week"}
                </Button>
                <p className="text-xs text-muted-foreground">Or contact your coach to arrange payment.</p>
              </div>
            </motion.div>
          ) : dayData && dayData.exercises.length > 0 ? (
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
                programContext={{
                  programName: program.programName,
                  difficulty: program.difficulty,
                  category: program.category,
                  periodization: program.periodization,
                  splitType: program.splitType,
                  currentWeek: effectiveCurrentWeek,
                  totalWeeks: program.totalWeeks,
                }}
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
                  {allDays.length === 0 ? "No exercises for this week." : "Rest day — no exercises scheduled."}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Complete Week button — only shown on the current week when all exercises are logged and week is not locked */}
      {isCurrentWeek && !lockedWeeks[selectedWeek] && (
        <CompleteWeekButton
          assignmentId={program.assignmentId}
          currentWeek={effectiveCurrentWeek}
          totalWeeks={program.totalWeeks}
          allExercisesLogged={allWeekExercisesLogged}
        />
      )}
    </div>
  )
}

/** Compute today's day-of-week using the browser's local timezone (1=Mon … 7=Sun) */
function getLocalDow(): number {
  const jsDay = new Date().getDay()
  return jsDay === 0 ? 7 : jsDay
}

// ─── Main Component ───────────────────────────────────────────────────────

export function WorkoutTabs({ programs, todayDow: serverDow }: WorkoutTabsProps) {
  // Override server-computed day with client-local day after hydration
  const [todayDow, setTodayDow] = useState(serverDow)
  useEffect(() => {
    setTodayDow(getLocalDow())
  }, [])
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(
    programs.length === 1 ? programs[0].assignmentId : null,
  )

  const selectedProgram = programs.find((p) => p.assignmentId === selectedProgramId)

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
      <p className="text-sm text-muted-foreground mb-1">Select a workout program to get started.</p>
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
