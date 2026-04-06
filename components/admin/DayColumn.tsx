"use client"

import { Plus, Sparkles, Copy, Trash2 } from "lucide-react"
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { useDroppable } from "@dnd-kit/core"
import { Button } from "@/components/ui/button"
import { ExerciseCard } from "@/components/admin/ExerciseCard"
import type { Exercise, ProgramExercise, TrainingTechnique } from "@/types/database"

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

const GROUP_TECHNIQUE_LABELS: Partial<Record<TrainingTechnique, string>> = {
  superset: "Superset",
  giant_set: "Giant Set",
  circuit: "Circuit",
  complex: "Complex",
}

type ProgramExerciseWithExercise = ProgramExercise & { exercises: Exercise }

/** A single exercise or a group of exercises that share a group_tag letter */
type ExerciseSlot =
  | { type: "single"; exercise: ProgramExerciseWithExercise; index: number }
  | { type: "group"; letter: string; label: string; exercises: { exercise: ProgramExerciseWithExercise; index: number }[] }

/** Group exercises by their group_tag letter while preserving order */
function buildSlots(exercises: ProgramExerciseWithExercise[]): ExerciseSlot[] {
  const slots: ExerciseSlot[] = []
  const grouped = new Map<string, { exercise: ProgramExerciseWithExercise; index: number }[]>()
  const insertionOrder: (string | { exercise: ProgramExerciseWithExercise; index: number })[] = []
  const seenLetters = new Set<string>()

  exercises.forEach((pe, index) => {
    const letter = pe.group_tag ? pe.group_tag.charAt(0).toUpperCase() : null
    if (letter) {
      if (!grouped.has(letter)) {
        grouped.set(letter, [])
      }
      grouped.get(letter)!.push({ exercise: pe, index })
      if (!seenLetters.has(letter)) {
        seenLetters.add(letter)
        insertionOrder.push(letter)
      }
    } else {
      insertionOrder.push({ exercise: pe, index })
    }
  })

  for (const item of insertionOrder) {
    if (typeof item === "string") {
      const group = grouped.get(item)!
      if (group.length === 1) {
        // Single exercise with a tag — show as single card
        slots.push({ type: "single", exercise: group[0].exercise, index: group[0].index })
      } else {
        // Determine group label from the technique of the first exercise
        const technique = group[0].exercise.technique as TrainingTechnique | undefined
        const label = (technique && GROUP_TECHNIQUE_LABELS[technique]) || "Superset"
        slots.push({ type: "group", letter: item, label, exercises: group })
      }
    } else {
      slots.push({ type: "single", exercise: item.exercise, index: item.index })
    }
  }

  return slots
}

interface DayColumnProps {
  dayOfWeek: number // 1-7
  exercises: ProgramExerciseWithExercise[]
  onAddExercise: (day: number) => void
  onEditExercise: (pe: ProgramExerciseWithExercise) => void
  onRemoveExercise: (pe: ProgramExerciseWithExercise) => void
  onDuplicateExercise?: (pe: ProgramExerciseWithExercise) => void
  onDuplicateGroup?: (exercises: ProgramExerciseWithExercise[]) => void
  onGenerateDay?: (day: number) => void
  onClearDay?: (day: number) => void
}

export function DayColumn({
  dayOfWeek,
  exercises,
  onAddExercise,
  onEditExercise,
  onRemoveExercise,
  onDuplicateExercise,
  onDuplicateGroup,
  onGenerateDay,
  onClearDay,
}: DayColumnProps) {
  const dayName = DAY_NAMES[dayOfWeek - 1]
  const slots = buildSlots(exercises)
  const exerciseIds = exercises.map((pe) => pe.id)

  const { setNodeRef, isOver } = useDroppable({ id: `day-${dayOfWeek}` })

  return (
    <div className={`rounded-xl border bg-surface/30 transition-colors ${isOver ? "border-primary border-2 bg-primary/5" : "border-border"}`}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-sm font-medium text-foreground">{dayName}</h3>
        <div className="flex items-center gap-1.5">
          {onGenerateDay && exercises.length === 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-accent hover:text-accent"
              onClick={() => onGenerateDay(dayOfWeek)}
              title={`AI Generate ${dayName}`}
            >
              <Sparkles className="size-3.5" />
            </Button>
          )}
          {onClearDay && exercises.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-destructive"
              onClick={() => onClearDay(dayOfWeek)}
              title={`Clear ${dayName}`}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {exercises.length} exercise{exercises.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
      <div ref={setNodeRef} className="p-2 space-y-2 min-h-[100px]">
        {exercises.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <p className="text-xs text-muted-foreground">No exercises</p>
            {onGenerateDay && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => onGenerateDay(dayOfWeek)}
              >
                <Sparkles className="size-3" />
                AI Generate
              </Button>
            )}
          </div>
        ) : (
          <SortableContext items={exerciseIds} strategy={verticalListSortingStrategy}>
            {slots.map((slot) => {
              if (slot.type === "single") {
                return (
                  <ExerciseCard
                    key={slot.exercise.id}
                    programExercise={slot.exercise}
                    onEdit={() => onEditExercise(slot.exercise)}
                    onRemove={() => onRemoveExercise(slot.exercise)}
                    onDuplicate={onDuplicateExercise ? () => onDuplicateExercise(slot.exercise) : undefined}
                  />
                )
              }

              // Grouped exercises (superset / giant set / circuit)
              return (
                <div
                  key={`group-${slot.letter}`}
                  className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/[0.02] p-1.5 space-y-1.5"
                >
                  <div className="flex items-center gap-1.5 px-1.5">
                    <span className="inline-flex items-center justify-center size-5 rounded bg-primary/10 text-[10px] font-bold text-primary">
                      {slot.letter}
                    </span>
                    <span className="text-[11px] font-medium text-primary">
                      {slot.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      ({slot.exercises.length} exercises)
                    </span>
                    {onDuplicateGroup && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="ml-auto size-5 text-muted-foreground hover:text-primary"
                        onClick={() => onDuplicateGroup(slot.exercises.map((e) => e.exercise))}
                        title={`Duplicate ${slot.label}`}
                      >
                        <Copy className="size-3" />
                      </Button>
                    )}
                  </div>
                  {slot.exercises.map(({ exercise: pe }) => (
                    <ExerciseCard
                      key={pe.id}
                      programExercise={pe}
                      onEdit={() => onEditExercise(pe)}
                      onRemove={() => onRemoveExercise(pe)}
                      onDuplicate={onDuplicateExercise ? () => onDuplicateExercise(pe) : undefined}
                    />
                  ))}
                </div>
              )
            })}
          </SortableContext>
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
