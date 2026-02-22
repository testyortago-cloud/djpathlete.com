"use client"

import Image from "next/image"
import { ChevronUp, ChevronDown, Pencil, Trash2, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { extractYouTubeId, getYouTubeThumbnailUrl } from "@/lib/youtube"
import type { Exercise, ProgramExercise } from "@/types/database"

interface ExerciseCardProps {
  programExercise: ProgramExercise & { exercises: Exercise }
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
  onRemove: () => void
  onDuplicate?: () => void
}

const CATEGORY_BORDER_COLORS: Record<string, string> = {
  strength: "border-l-primary",
  cardio: "border-l-destructive",
  flexibility: "border-l-success",
  plyometric: "border-l-warning",
  sport_specific: "border-l-accent",
  recovery: "border-l-muted-foreground",
}

export function ExerciseCard({
  programExercise,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onEdit,
  onRemove,
  onDuplicate,
}: ExerciseCardProps) {
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
    <div className={`group relative rounded-lg border border-border bg-white ${borderColor} border-l-4 p-3 transition-shadow hover:shadow-sm`}>
      <div className="flex gap-3">
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
            {programExercise.group_tag && (
              <span className="shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-primary/10 text-primary">
                {programExercise.group_tag}
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
          onClick={onMoveUp}
          disabled={isFirst}
          title="Move up"
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onMoveDown}
          disabled={isLast}
          title="Move down"
        >
          <ChevronDown className="size-3.5" />
        </Button>
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
