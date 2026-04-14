"use client"

import Image from "next/image"
import { GripVertical, X } from "lucide-react"
import { useDraggable } from "@dnd-kit/core"
import { Button } from "@/components/ui/button"
import { extractYouTubeId, getYouTubeThumbnailUrl } from "@/lib/youtube"
import type { Exercise } from "@/types/database"

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

interface ExercisePoolCardProps {
  exercise: Exercise
  onRemove: () => void
  isOverlay?: boolean
}

export function ExercisePoolCard({ exercise, onRemove, isOverlay }: ExercisePoolCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `pool-${exercise.id}`,
    data: { type: "pool", exercise },
    disabled: isOverlay,
  })

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined

  const categories = Array.isArray(exercise.category) ? exercise.category : [exercise.category]
  const borderColor = CATEGORY_BORDER_COLORS[categories[0]] ?? "border-l-muted-foreground"

  const youtubeId = exercise.video_url ? extractYouTubeId(exercise.video_url) : null
  const thumbnailUrl = youtubeId ? getYouTubeThumbnailUrl(youtubeId) : null

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative rounded-lg border border-border bg-white ${borderColor} border-l-4 p-2.5 transition-shadow hover:shadow-sm ${isDragging ? "opacity-50 shadow-lg z-50" : ""}`}
    >
      <div className="flex gap-2">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="shrink-0 flex items-center cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-foreground -ml-0.5"
          title="Drag to a day"
        >
          <GripVertical className="size-3.5" />
        </button>
        {thumbnailUrl && (
          <div className="shrink-0 overflow-hidden rounded">
            <Image
              src={thumbnailUrl}
              alt={exercise.name}
              width={48}
              height={36}
              className="size-auto max-h-9 max-w-12 object-cover"
              unoptimized
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground truncate">{exercise.name}</p>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {categories.slice(0, 2).map((cat) => (
              <span
                key={cat}
                className="inline-flex items-center rounded px-1 py-0.5 text-[9px] font-medium bg-muted text-muted-foreground capitalize"
              >
                {cat.replace("_", " ")}
              </span>
            ))}
            {exercise.muscle_group && (
              <span className="inline-flex items-center rounded px-1 py-0.5 text-[9px] font-medium bg-primary/10 text-primary capitalize">
                {exercise.muscle_group}
              </span>
            )}
          </div>
        </div>
        {/* Remove from pool */}
        <Button
          variant="ghost"
          size="icon"
          className="size-5 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          title="Remove from pool"
        >
          <X className="size-3" />
        </Button>
      </div>
    </div>
  )
}
