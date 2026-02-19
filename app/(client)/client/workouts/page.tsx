import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getAssignments } from "@/lib/db/assignments"
import { getProgramExercises } from "@/lib/db/program-exercises"
import { EmptyState } from "@/components/ui/empty-state"
import { Dumbbell, Clock, Weight } from "lucide-react"
import type { Program, ProgramAssignment, Exercise, ProgramExercise } from "@/types/database"

export const metadata = { title: "My Workouts | DJP Athlete" }

type AssignmentWithProgram = ProgramAssignment & {
  programs: Program | null
}

type ProgramExerciseWithExercise = ProgramExercise & {
  exercises: Exercise | null
}

const dayLabels: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
}

function formatRestTime(seconds: number | null): string {
  if (!seconds) return ""
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60)
    const remaining = seconds % 60
    return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`
  }
  return `${seconds}s`
}

export default async function ClientWorkoutsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id

  const assignments = (await getAssignments(userId)) as AssignmentWithProgram[]
  const activeAssignments = assignments.filter((a) => a.status === "active")

  // Fetch exercises for each active program in parallel
  const programExercises = await Promise.all(
    activeAssignments.map(async (assignment) => {
      if (!assignment.programs) return { assignment, exercises: [] }
      const exercises = (await getProgramExercises(
        assignment.program_id
      )) as ProgramExerciseWithExercise[]
      return { assignment, exercises }
    })
  )

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">My Workouts</h1>

      {activeAssignments.length === 0 ? (
        <EmptyState
          icon={Dumbbell}
          heading="No active programs"
          description="You don't have any active workout programs. Once a program is assigned to you, your exercises will appear here."
        />
      ) : (
        <div className="space-y-8">
          {programExercises.map(({ assignment, exercises }) => {
            const program = assignment.programs
            if (!program) return null

            // Group exercises by day_of_week
            const exercisesByDay = exercises.reduce<
              Record<number, ProgramExerciseWithExercise[]>
            >((acc, ex) => {
              const day = ex.day_of_week
              if (!acc[day]) acc[day] = []
              acc[day].push(ex)
              return acc
            }, {})

            const sortedDays = Object.keys(exercisesByDay)
              .map(Number)
              .sort((a, b) => a - b)

            return (
              <div key={assignment.id}>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-lg font-semibold text-foreground">
                    {program.name}
                  </h2>
                  <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium capitalize">
                    {program.category.replace("_", " ")}
                  </span>
                </div>

                {exercises.length === 0 ? (
                  <p className="text-sm text-muted-foreground bg-white rounded-xl border border-border p-6">
                    No exercises have been added to this program yet.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {sortedDays.map((day) => (
                      <div
                        key={day}
                        className="bg-white rounded-xl border border-border overflow-hidden"
                      >
                        <div className="bg-surface px-4 py-3 border-b border-border">
                          <h3 className="text-sm font-semibold text-primary">
                            {dayLabels[day] ?? `Day ${day}`}
                          </h3>
                        </div>
                        <div className="divide-y divide-border">
                          {exercisesByDay[day].map((pe) => {
                            const exercise = pe.exercises
                            if (!exercise) return null

                            return (
                              <div
                                key={pe.id}
                                className="px-4 py-3 flex items-center justify-between gap-4"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-foreground text-sm">
                                    {exercise.name}
                                  </p>
                                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                    {pe.sets && pe.reps && (
                                      <span className="flex items-center gap-1">
                                        <Dumbbell
                                          className="size-3"
                                          strokeWidth={1.5}
                                        />
                                        {pe.sets} x {pe.reps}
                                      </span>
                                    )}
                                    {pe.duration_seconds && (
                                      <span className="flex items-center gap-1">
                                        <Clock
                                          className="size-3"
                                          strokeWidth={1.5}
                                        />
                                        {formatRestTime(pe.duration_seconds)}
                                      </span>
                                    )}
                                    {exercise.equipment && (
                                      <span className="flex items-center gap-1">
                                        <Weight
                                          className="size-3"
                                          strokeWidth={1.5}
                                        />
                                        {exercise.equipment}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {pe.rest_seconds && (
                                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                                    Rest: {formatRestTime(pe.rest_seconds)}
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
