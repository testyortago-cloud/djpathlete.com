"use client"

import { Link2, Check, AlertCircle } from "lucide-react"
import type { Exercise, ProgramExercise } from "@/types/database"

type ProgramExerciseWithExercise = ProgramExercise & { exercises: Exercise }

const TECHNIQUE_LIMITS: Record<string, { min: number; label: string; hint: string }> = {
  superset: { min: 1, label: "Superset", hint: "Select 1 exercise to pair with" },
  giant_set: { min: 2, label: "Giant Set", hint: "Select 2+ exercises to group with" },
  circuit: { min: 3, label: "Circuit", hint: "Select 3+ exercises to group with" },
}

interface ExerciseLinkerProps {
  technique: "superset" | "giant_set" | "circuit"
  dayExercises: ProgramExerciseWithExercise[]
  excludeId?: string
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
}

export function ExerciseLinker({
  technique,
  dayExercises,
  excludeId,
  selectedIds,
  onSelectionChange,
}: ExerciseLinkerProps) {
  const config = TECHNIQUE_LIMITS[technique]
  const available = dayExercises.filter((pe) => pe.id !== excludeId)

  function toggleExercise(id: string) {
    if (technique === "superset") {
      // Superset: toggle single selection (exactly 1)
      if (selectedIds.includes(id)) {
        onSelectionChange([])
      } else {
        onSelectionChange([id])
      }
    } else {
      // Giant set / circuit: multi-select
      if (selectedIds.includes(id)) {
        onSelectionChange(selectedIds.filter((s) => s !== id))
      } else {
        onSelectionChange([...selectedIds, id])
      }
    }
  }

  const isValid = selectedIds.length >= config.min
  const isEmpty = available.length === 0

  return (
    <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div className="flex items-center gap-2">
        <Link2 className="size-4 text-primary" />
        <span className="text-sm font-medium text-foreground">Link Exercises — {config.label}</span>
      </div>

      {isEmpty ? (
        <div className="flex items-center gap-2 py-3">
          <AlertCircle className="size-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Add other exercises to this day first, then come back to link them.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{config.hint}</p>

          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {available.map((pe) => {
              const isSelected = selectedIds.includes(pe.id)
              const existingGroup = pe.group_tag ? pe.group_tag.charAt(0).toUpperCase() : null

              return (
                <button
                  key={pe.id}
                  type="button"
                  onClick={() => toggleExercise(pe.id)}
                  className={`w-full flex items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                      : "border-border bg-white hover:bg-surface/50"
                  }`}
                >
                  <div
                    className={`flex items-center justify-center size-4.5 rounded border transition-colors ${
                      isSelected ? "bg-primary border-primary text-white" : "border-border bg-white"
                    }`}
                  >
                    {isSelected && <Check className="size-3" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{pe.exercises.name}</p>
                    {pe.sets && (
                      <p className="text-[11px] text-muted-foreground">
                        {pe.sets} sets{pe.reps ? ` × ${pe.reps}` : ""}
                      </p>
                    )}
                  </div>

                  {existingGroup && !isSelected && (
                    <span className="shrink-0 text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                      Group {existingGroup}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {!isValid && selectedIds.length > 0 && (
            <p className="text-xs text-warning">
              Select at least {config.min} exercise{config.min > 1 ? "s" : ""} for a {config.label.toLowerCase()}.
            </p>
          )}
        </>
      )}
    </div>
  )
}
