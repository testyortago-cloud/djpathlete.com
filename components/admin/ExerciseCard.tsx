"use client"

import { forwardRef } from "react"
import Image from "next/image"
import { GripVertical, Pencil, Trash2, Copy } from "lucide-react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { extractYouTubeId, getYouTubeThumbnailUrl } from "@/lib/youtube"
import type { Exercise, ProgramExercise, TrainingTechnique } from "@/types/database"

const TECHNIQUE_BADGE_LABELS: Partial<Record<TrainingTechnique, string>> = {
  dropset: "Drop Set",
  rest_pause: "Rest-Pause",
  amrap: "AMRAP",
}

interface ExerciseCardProps {
  programExercise: ProgramExercise & { exercises: Exercise }
  onEdit: () => void
  onRemove: () => void
  onDuplicate?: () => void
}

const CATEGORY_BORDER_COLORS: Record<string, string> = {
  strength: "border-l-primary",
  speed: "border-l-destructive",
  power: "border-l-warning",
  plyometric: "border-l-warning",
  flexibility: "border-l-success",
  mobility: "border-l-success",
  motor_control: "border-l-accent",
  strength_endurance: "border-l-primary",
  relative_strength: "border-l-primary",
}

export function ExerciseCard({
  programExercise,
  onEdit,
  onRemove,
  onDuplicate,
}: ExerciseCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: programExercise.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const exercise = programExercise.exercises
  const categories = Array.isArray(exercise.category) ? exercise.category : [exercise.category]
  const borderColor = CATEGORY_BORDER_COLORS[categories[0]] ?? "border-l-muted-foreground"

  const youtubeId = exercise.video_url ? extractYouTubeId(exercise.video_url) : null
  const thumbnailUrl = youtubeId ? getYouTubeThumbnailUrl(youtubeId) : null

  const details: string[] = []
  if (programExercise.sets) details.push(`${programExercise.sets} sets`)
  if (programExercise.reps) details.push(`${programExercise.reps} reps`)
  if (programExercise.rest_seconds) details.push(`${programExercise.rest_seconds}s rest`)
  if (programExercise.duration_seconds) details.push(`${programExercise.duration_seconds}s`)
  if (programExercise.rpe_target) details.push(`RPE ${programExercise.rpe_target}`)
  if (programExercise.intensity_pct) details.push(`${programExercise.intensity_pct}% 1RM`)
  if (programExercise.tempo) details.push(`Tempo ${programExercise.tempo}`)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative rounded-lg border border-border bg-white ${borderColor} border-l-4 p-3 transition-shadow hover:shadow-sm ${isDragging ? "opacity-50 shadow-lg z-50" : ""}`}
    >
      <div className="flex gap-3">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="shrink-0 flex items-center cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-foreground -ml-1"
          title="Drag to reorder"
        >
          <GripVertical className="size-4" />
        </button>
        {thumbnailUrl && (
          <div className="shrink-0 overflow-hidden rounded-md">
            <Image
              src={thumbnailUrl}
              alt={exercise.name}
              width={64}
              height={48}
              className="size-auto max-h-12 max-w-16 object-cover"
              unoptimized
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-medium text-foreground truncate">{exercise.name}</p>
            {categories.map((cat) => (
              <span key={cat} className="shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground capitalize">
                {cat.replace("_", " ")}
              </span>
            ))}
            {programExercise.technique &&
              programExercise.technique !== "straight_set" &&
              TECHNIQUE_BADGE_LABELS[programExercise.technique as TrainingTechnique] && (
              <span className="shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-accent/15 text-accent">
                {TECHNIQUE_BADGE_LABELS[programExercise.technique as TrainingTechnique]}
              </span>
            )}
          </div>
          {details.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">{details.join(" / ")}</p>
          )}
          {programExercise.notes && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate italic">
              {programExercise.notes}
            </p>
          )}
        </div>
      </div>

      {/* Hover actions */}
      <div className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-md p-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onEdit}
          title="Edit parameters"
        >
          <Pencil className="size-3.5" />
        </Button>
        {onDuplicate && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDuplicate}
            title="Duplicate exercise"
          >
            <Copy className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          title="Remove"
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
