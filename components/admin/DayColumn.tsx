"use client"

import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ExerciseCard } from "@/components/admin/ExerciseCard"
import type { Exercise, ProgramExercise } from "@/types/database"

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

interface DayColumnProps {
  dayOfWeek: number // 1-7
  exercises: (ProgramExercise & { exercises: Exercise })[]
  onAddExercise: (day: number) => void
  onEditExercise: (pe: ProgramExercise & { exercises: Exercise }) => void
  onRemoveExercise: (pe: ProgramExercise & { exercises: Exercise }) => void
  onMoveUp: (pe: ProgramExercise & { exercises: Exercise }) => void
  onMoveDown: (pe: ProgramExercise & { exercises: Exercise }) => void
  onDuplicateExercise?: (pe: ProgramExercise & { exercises: Exercise }) => void
}

export function DayColumn({
  dayOfWeek,
  exercises,
  onAddExercise,
  onEditExercise,
  onRemoveExercise,
  onMoveUp,
  onMoveDown,
  onDuplicateExercise,
}: DayColumnProps) {
  const dayName = DAY_NAMES[dayOfWeek - 1]

  return (
    <div className="rounded-xl border border-border bg-surface/30">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-sm font-medium text-foreground">{dayName}</h3>
        <span className="text-xs text-muted-foreground">
          {exercises.length} exercise{exercises.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="p-2 space-y-2 min-h-[100px]">
        {exercises.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No exercises</p>
        ) : (
          exercises.map((pe, index) => (
            <ExerciseCard
              key={pe.id}
              programExercise={pe}
              isFirst={index === 0}
              isLast={index === exercises.length - 1}
              onMoveUp={() => onMoveUp(pe)}
              onMoveDown={() => onMoveDown(pe)}
              onEdit={() => onEditExercise(pe)}
              onRemove={() => onRemoveExercise(pe)}
              onDuplicate={onDuplicateExercise ? () => onDuplicateExercise(pe) : undefined}
            />
          ))
        )}
      </div>
      <div className="border-t border-border p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground hover:text-foreground"
          onClick={() => onAddExercise(dayOfWeek)}
        >
          <Plus className="size-3.5" />
          Add Exercise
        </Button>
      </div>
    </div>
  )
}
