"use client"

import { useState, useEffect, useMemo } from "react"
import { ArrowLeftRight, Loader2, Dumbbell, Sparkles, Search, Play } from "lucide-react"
import { extractYouTubeId } from "@/lib/youtube"
import { motion, AnimatePresence } from "framer-motion"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import type { Exercise, ExerciseRelationshipType } from "@/types/database"

// ─── Types ──────────────────────────────────────────────────────────────────

type ExerciseWithRelationship = Exercise & {
  relationship_type?: ExerciseRelationshipType
}

interface ExerciseSwapSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  exerciseId: string
  exerciseName: string
  muscleGroup: string | null
  equipment: string | null
  onSwap: (exercise: Exercise) => void
}

const EQUIPMENT_FILTERS = [
  { label: "All", value: "all" },
  { label: "Bodyweight", value: "bodyweight" },
  { label: "Dumbbells", value: "dumbbells" },
  { label: "Barbell", value: "barbell" },
  { label: "Cable", value: "cable" },
  { label: "Machine", value: "machine" },
] as const

// ─── Exercise Row ───────────────────────────────────────────────────────────

function ExerciseRow({
  exercise,
  isCurated,
  onSelect,
  index,
}: {
  exercise: ExerciseWithRelationship
  isCurated: boolean
  onSelect: () => void
  index: number
}) {
  const videoId = exercise.video_url ? extractYouTubeId(exercise.video_url) : null
  const thumbnailUrl =
    exercise.thumbnail_url ?? (videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null)

  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center gap-3"
      onClick={onSelect}
    >
      {/* Video thumbnail or fallback icon */}
      {thumbnailUrl ? (
        <div className="size-10 rounded-lg overflow-hidden bg-muted shrink-0 relative">
          <img src={thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <Play className="size-3.5 text-white fill-white" />
          </div>
        </div>
      ) : (
        <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Dumbbell className="size-4 text-primary" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{exercise.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {exercise.equipment && <span className="text-[10px] text-muted-foreground">{exercise.equipment}</span>}
          {isCurated && (
            <Badge variant="outline" className="text-[9px] h-4 border-accent/30 text-accent gap-0.5">
              <Sparkles className="size-2.5" />
              Curated
            </Badge>
          )}
        </div>
      </div>
      <ArrowLeftRight className="size-3.5 text-muted-foreground shrink-0" />
    </motion.button>
  )
}

// ─── Confirm dialog ─────────────────────────────────────────────────────────

function ConfirmSwap({
  exercise,
  originalName,
  onConfirm,
  onCancel,
}: {
  exercise: Exercise
  originalName: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="p-5 space-y-4"
    >
      <div className="text-center space-y-2">
        <div className="mx-auto size-12 rounded-full bg-primary/10 flex items-center justify-center">
          <ArrowLeftRight className="size-6 text-primary" />
        </div>
        <p className="text-sm font-medium">Swap exercise?</p>
        <p className="text-xs text-muted-foreground">
          Replace <span className="font-medium text-foreground">{originalName}</span> with{" "}
          <span className="font-medium text-foreground">{exercise.name}</span> for this session.
        </p>
        <p className="text-[10px] text-muted-foreground/70">
          This won&apos;t change your program — just today&apos;s workout.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" className="flex-1 gap-1" onClick={onConfirm}>
          <ArrowLeftRight className="size-3" />
          Swap
        </Button>
      </div>
    </motion.div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────

export function ExerciseSwapSheet({
  open,
  onOpenChange,
  exerciseId,
  exerciseName,
  muscleGroup,
  equipment,
  onSwap,
}: ExerciseSwapSheetProps) {
  const [loading, setLoading] = useState(false)
  const [linked, setLinked] = useState<ExerciseWithRelationship[]>([])
  const [similar, setSimilar] = useState<ExerciseWithRelationship[]>([])
  const [equipmentFilter, setEquipmentFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [confirmExercise, setConfirmExercise] = useState<Exercise | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setConfirmExercise(null)
      setEquipmentFilter("all")
      setSearchQuery("")
      return
    }

    async function fetchAlternatives() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/client/workouts/alternatives?exerciseId=${encodeURIComponent(exerciseId)}`)
        if (!res.ok) throw new Error("Failed to fetch alternatives")
        const data = await res.json()
        setLinked(data.linked ?? [])
        setSimilar(data.similar ?? [])
      } catch {
        setError("Could not load alternatives. Try again later.")
      } finally {
        setLoading(false)
      }
    }

    fetchAlternatives()
  }, [open, exerciseId])

  const filteredLinked = useMemo(
    () => filterExercises(linked, equipmentFilter, searchQuery),
    [linked, equipmentFilter, searchQuery],
  )
  const filteredSimilar = useMemo(
    () => filterExercises(similar, equipmentFilter, searchQuery),
    [similar, equipmentFilter, searchQuery],
  )

  // Split similar exercises: same equipment vs different equipment
  const normalizedEquipment = equipment?.toLowerCase().trim() ?? ""
  const similarSameEquip = useMemo(
    () =>
      normalizedEquipment
        ? filteredSimilar.filter((ex) => (ex.equipment ?? "").toLowerCase().trim() === normalizedEquipment)
        : filteredSimilar,
    [filteredSimilar, normalizedEquipment],
  )
  const similarDiffEquip = useMemo(
    () =>
      normalizedEquipment
        ? filteredSimilar.filter((ex) => (ex.equipment ?? "").toLowerCase().trim() !== normalizedEquipment)
        : [],
    [filteredSimilar, normalizedEquipment],
  )

  const totalResults = filteredLinked.length + filteredSimilar.length

  function handleConfirmSwap() {
    if (confirmExercise) {
      onSwap(confirmExercise)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md max-h-[85dvh] overflow-hidden p-0 flex flex-col gap-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-5 pt-5 pb-2">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <ArrowLeftRight className="size-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-heading">Swap Exercise</DialogTitle>
              <DialogDescription className="text-xs">{exerciseName}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {confirmExercise ? (
            <ConfirmSwap
              key="confirm"
              exercise={confirmExercise}
              originalName={exerciseName}
              onConfirm={handleConfirmSwap}
              onCancel={() => setConfirmExercise(null)}
            />
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col flex-1 overflow-hidden"
            >
              {/* Search + filter bar */}
              <div className="px-5 pb-3 space-y-2">
                {/* Search input */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search exercises..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full h-8 rounded-md border border-input bg-transparent pl-8 pr-3 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  />
                </div>
                {/* Equipment filter chips */}
                <div className="flex flex-wrap gap-1.5">
                  {EQUIPMENT_FILTERS.map((filter) => (
                    <button
                      key={filter.value}
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                        equipmentFilter === filter.value
                          ? "bg-primary text-white"
                          : "bg-muted text-muted-foreground hover:bg-muted/80",
                      )}
                      onClick={() => setEquipmentFilter(filter.value)}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scrollable list */}
              <div className="flex-1 overflow-y-auto">
                {loading && (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                )}

                {error && (
                  <div className="px-5 py-8 text-center">
                    <p className="text-sm text-muted-foreground">{error}</p>
                  </div>
                )}

                {!loading && !error && totalResults === 0 && (
                  <div className="px-5 py-8 text-center">
                    <Dumbbell className="size-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No alternatives found</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Try adjusting your equipment filter</p>
                  </div>
                )}

                {!loading && !error && (
                  <>
                    {/* Curated alternatives */}
                    {filteredLinked.length > 0 && (
                      <div>
                        <div className="flex items-center gap-3 px-5 py-2">
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                            Curated Alternatives
                          </p>
                          <Separator className="flex-1" />
                        </div>
                        <div className="divide-y divide-border">
                          {filteredLinked.map((exercise, idx) => (
                            <ExerciseRow
                              key={exercise.id}
                              exercise={exercise}
                              isCurated
                              onSelect={() => setConfirmExercise(exercise)}
                              index={idx}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Similar exercises — same equipment */}
                    {similarSameEquip.length > 0 && (
                      <div>
                        <div className="flex items-center gap-3 px-5 py-2">
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                            Similar Exercises
                          </p>
                          <Separator className="flex-1" />
                        </div>
                        <div className="divide-y divide-border">
                          {similarSameEquip.map((exercise, idx) => (
                            <ExerciseRow
                              key={exercise.id}
                              exercise={exercise}
                              isCurated={false}
                              onSelect={() => setConfirmExercise(exercise)}
                              index={idx}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Different equipment alternatives */}
                    {similarDiffEquip.length > 0 && (
                      <div>
                        <div className="flex items-center gap-3 px-5 py-2">
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                            Equipment Unavailable?
                          </p>
                          <Separator className="flex-1" />
                        </div>
                        <p className="px-5 pb-2 text-[11px] text-muted-foreground/70">
                          Same movement, different equipment
                        </p>
                        <div className="divide-y divide-border">
                          {similarDiffEquip.map((exercise, idx) => (
                            <ExerciseRow
                              key={exercise.id}
                              exercise={exercise}
                              isCurated={false}
                              onSelect={() => setConfirmExercise(exercise)}
                              index={idx}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function filterExercises(
  exercises: ExerciseWithRelationship[],
  equipmentFilter: string,
  searchQuery: string,
): ExerciseWithRelationship[] {
  return exercises.filter((ex) => {
    // Equipment filter
    if (equipmentFilter !== "all") {
      if (equipmentFilter === "bodyweight") {
        if (!ex.is_bodyweight) return false
      } else {
        const equip = (ex.equipment ?? "").toLowerCase()
        const equipReq = ex.equipment_required.map((e) => e.toLowerCase())
        const match = equip.includes(equipmentFilter) || equipReq.some((e) => e.includes(equipmentFilter))
        if (!match) return false
      }
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const nameMatch = ex.name.toLowerCase().includes(q)
      const muscleMatch = ex.muscle_group?.toLowerCase().includes(q) ?? false
      if (!nameMatch && !muscleMatch) return false
    }

    return true
  })
}
