"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from "lucide-react"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { ImageUploader } from "@/components/admin/content-studio/upload/ImageUploader"

interface Slot {
  id: string
  assetId: string | null
  fileName: string | null
}

interface CarouselComposerProps {
  onChange: (mediaAssetIds: string[]) => void
  minSlides?: number
  maxSlides?: number
}

let slotSeq = 0
function newSlot(): Slot {
  slotSeq += 1
  return { id: `slot-${slotSeq}`, assetId: null, fileName: null }
}

interface SortableSlotProps {
  slot: Slot
  index: number
  totalSlots: number
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
  onRemove: (id: string) => void
  onUploaded: (id: string, assetId: string, fileName: string) => void
}

function SortableSlot({
  slot,
  index,
  totalSlots,
  onMoveUp,
  onMoveDown,
  onRemove,
  onUploaded,
}: SortableSlotProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slot.id,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border border-border rounded p-2 bg-white"
    >
      {slot.assetId ? (
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            aria-label={`Drag ${slot.fileName ?? "slide"} to reorder`}
            {...attributes}
            {...listeners}
            className="cursor-grab touch-none text-muted-foreground hover:text-primary p-1"
          >
            <GripVertical className="size-3" />
          </button>
          <span className="font-mono text-muted-foreground">{index + 1}.</span>
          <span className="flex-1 truncate">{slot.fileName}</span>
          <button
            type="button"
            aria-label="Move up"
            disabled={index === 0}
            onClick={() => onMoveUp(index)}
            className="p-1 disabled:opacity-30"
          >
            <ArrowUp className="size-3" />
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={index === totalSlots - 1}
            onClick={() => onMoveDown(index)}
            className="p-1 disabled:opacity-30"
          >
            <ArrowDown className="size-3" />
          </button>
          <button
            type="button"
            aria-label="Remove"
            onClick={() => onRemove(slot.id)}
            className="p-1 text-error"
          >
            <X className="size-3" />
          </button>
        </div>
      ) : (
        <ImageUploader
          onUploaded={(e) => {
            const fileName = e.storagePath.split("/").pop() ?? "image"
            onUploaded(slot.id, e.mediaAssetId, fileName)
          }}
        />
      )}
    </div>
  )
}

export function CarouselComposer({
  onChange,
  minSlides = 2,
  maxSlides = 10,
}: CarouselComposerProps) {
  const [slots, setSlots] = useState<Slot[]>(() => [newSlot()])
  // Use a sentinel (null) for "never emitted" so the initial empty-array emission fires.
  const lastEmittedRef = useRef<string | null>(null)

  const filledCount = slots.filter((s) => s.assetId).length
  const remainingForMin = Math.max(0, minSlides - filledCount)

  // Emit only when the filled-asset list actually changes, to avoid infinite onChange loops.
  useEffect(() => {
    const ids = slots.filter((s) => s.assetId).map((s) => s.assetId as string)
    const key = ids.join("|")
    if (key !== lastEmittedRef.current) {
      lastEmittedRef.current = key
      onChange(ids)
    }
  }, [slots, onChange])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setSlots((current) => {
      const oldIndex = current.findIndex((s) => s.id === active.id)
      const newIndex = current.findIndex((s) => s.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return current
      return arrayMove(current, oldIndex, newIndex)
    })
  }, [])

  const addSlide = useCallback(() => {
    setSlots((s) => (s.length >= maxSlides ? s : [...s, newSlot()]))
  }, [maxSlides])

  const removeSlot = useCallback(
    (id: string) =>
      setSlots((s) => {
        const next = s.filter((slot) => slot.id !== id)
        return next.length === 0 ? [newSlot()] : next
      }),
    [],
  )

  const moveUp = useCallback((index: number) => {
    setSlots((s) => {
      if (index <= 0) return s
      const next = s.slice()
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      return next
    })
  }, [])

  const moveDown = useCallback((index: number) => {
    setSlots((s) => {
      if (index >= s.length - 1) return s
      const next = s.slice()
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      return next
    })
  }, [])

  const markUploaded = useCallback((id: string, assetId: string, fileName: string) => {
    setSlots((s) => s.map((slot) => (slot.id === id ? { ...slot, assetId, fileName } : slot)))
  }, [])

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={slots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {slots.map((slot, index) => (
            <SortableSlot
              key={slot.id}
              slot={slot}
              index={index}
              totalSlots={slots.length}
              onMoveUp={moveUp}
              onMoveDown={moveDown}
              onRemove={removeSlot}
              onUploaded={markUploaded}
            />
          ))}
        </SortableContext>
      </DndContext>

      <button
        type="button"
        onClick={addSlide}
        disabled={slots.length >= maxSlides}
        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-primary disabled:opacity-50"
      >
        <Plus className="size-3" /> Add slide
      </button>

      {remainingForMin > 0 ? (
        <p className="text-xs text-muted-foreground">
          Add at least {remainingForMin} more slide{remainingForMin === 1 ? "" : "s"} to create a carousel.
        </p>
      ) : null}
      {slots.length >= maxSlides ? (
        <p className="text-xs text-muted-foreground">
          Carousel limit reached (max {maxSlides}).
        </p>
      ) : null}
    </div>
  )
}
