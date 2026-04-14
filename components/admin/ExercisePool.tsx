"use client"

import { useState, useMemo } from "react"
import { Search, Sparkles, Trash2, X, ChevronUp, Plus, Check } from "lucide-react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { extractYouTubeId, getYouTubeThumbnailUrl } from "@/lib/youtube"
import { ExercisePoolCard } from "@/components/admin/ExercisePoolCard"
import type { Exercise, ExerciseCategory } from "@/types/database"

const CATEGORY_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "strength", label: "Strength" },
  { value: "power", label: "Power" },
  { value: "speed", label: "Speed" },
  { value: "plyometric", label: "Plyo" },
  { value: "mobility", label: "Mobility" },
  { value: "flexibility", label: "Flex" },
]

interface ExercisePoolProps {
  /** All exercises in the library */
  allExercises: Exercise[]
  /** Exercises currently in the pool (curated shortlist) */
  poolExercises: Exercise[]
  onPoolChange: (exercises: Exercise[]) => void
  onClose: () => void
}

export function ExercisePool({ allExercises, poolExercises, onPoolChange, onClose }: ExercisePoolProps) {
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [browseOpen, setBrowseOpen] = useState(poolExercises.length === 0)

  const poolIds = useMemo(() => new Set(poolExercises.map((e) => e.id)), [poolExercises])

  // Filter the full library for browse
  const filtered = useMemo(() => {
    if (!search && categoryFilter === "all") return allExercises.slice(0, 50)

    return allExercises
      .filter((ex) => {
        const matchesSearch =
          !search ||
          ex.name.toLowerCase().includes(search.toLowerCase()) ||
          (ex.muscle_group?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
          ex.primary_muscles.some((m) => m.toLowerCase().includes(search.toLowerCase()))
        const cats: string[] = Array.isArray(ex.category) ? ex.category : [ex.category]
        const matchesCategory = categoryFilter === "all" || cats.includes(categoryFilter)
        return matchesSearch && matchesCategory
      })
      .slice(0, 50)
  }, [allExercises, search, categoryFilter])

  function addToPool(exercise: Exercise) {
    if (poolIds.has(exercise.id)) return
    onPoolChange([...poolExercises, exercise])
  }

  function removeFromPool(exerciseId: string) {
    onPoolChange(poolExercises.filter((e) => e.id !== exerciseId))
  }

  function clearPool() {
    onPoolChange([])
    setBrowseOpen(true)
  }

  return (
    <div className="w-72 xl:w-80 shrink-0 flex flex-col max-h-[calc(100vh-8rem)] sticky top-4 rounded-xl border border-border bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-surface/30 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent" />
          <h3 className="text-sm font-semibold text-foreground">Exercise Pool</h3>
          {poolExercises.length > 0 && (
            <span className="text-[10px] font-medium bg-primary/10 text-primary rounded-full px-1.5 py-0.5">
              {poolExercises.length}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Browse / Add section — collapsible */}
      <div className="border-b border-border shrink-0">
        <button
          className="flex items-center justify-between w-full px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setBrowseOpen(!browseOpen)}
        >
          <span className="flex items-center gap-1.5">
            <Plus className="size-3" />
            Browse & Add Exercises
          </span>
          <ChevronUp className={`size-3 transition-transform ${browseOpen ? "" : "rotate-180"}`} />
        </button>

        {browseOpen && (
          <div className="px-2 pb-2 space-y-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search exercises..."
                className="h-7 pl-7 text-xs"
              />
            </div>

            {/* Category filter pills */}
            <div className="flex gap-1 flex-wrap">
              {CATEGORY_FILTERS.map((cat) => (
                <button
                  key={cat.value}
                  className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full transition-colors ${
                    categoryFilter === cat.value
                      ? "bg-primary text-white"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setCategoryFilter(cat.value)}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Browse results */}
            <div className="max-h-48 overflow-y-auto space-y-0.5 rounded-md border border-border">
              {filtered.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center py-4">No exercises found</p>
              ) : (
                filtered.map((exercise) => {
                  const inPool = poolIds.has(exercise.id)
                  const youtubeId = exercise.video_url ? extractYouTubeId(exercise.video_url) : null
                  const thumb = youtubeId ? getYouTubeThumbnailUrl(youtubeId) : null
                  const cats = Array.isArray(exercise.category) ? exercise.category : [exercise.category]

                  return (
                    <button
                      key={exercise.id}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors ${
                        inPool ? "bg-primary/5 cursor-default" : "hover:bg-muted/50 cursor-pointer"
                      }`}
                      onClick={() => !inPool && addToPool(exercise)}
                      disabled={inPool}
                    >
                      {thumb && (
                        <div className="shrink-0 overflow-hidden rounded">
                          <Image
                            src={thumb}
                            alt=""
                            width={32}
                            height={24}
                            className="size-auto max-h-6 max-w-8 object-cover"
                            unoptimized
                          />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-foreground truncate">{exercise.name}</p>
                        <div className="flex gap-1 mt-0.5">
                          {cats.slice(0, 1).map((c) => (
                            <span key={c} className="text-[8px] font-medium text-muted-foreground capitalize">
                              {c.replace("_", " ")}
                            </span>
                          ))}
                          {exercise.muscle_group && (
                            <span className="text-[8px] text-primary font-medium capitalize">
                              {exercise.muscle_group}
                            </span>
                          )}
                        </div>
                      </div>
                      {inPool ? (
                        <Check className="size-3.5 text-primary shrink-0" />
                      ) : (
                        <Plus className="size-3.5 text-muted-foreground shrink-0" />
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pool exercises — scrollable list */}
      <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-1.5">
        {poolExercises.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <p className="text-xs text-muted-foreground">No exercises in pool</p>
            <p className="text-[10px] text-muted-foreground/70 px-4 leading-relaxed">
              Browse and add exercises above. The AI will use these when generating days and weeks.
            </p>
          </div>
        ) : (
          <>
            <p className="text-[10px] text-muted-foreground px-1 pb-0.5">
              AI generation will use these exercises. Drag to add to days manually.
            </p>
            {poolExercises.map((exercise) => (
              <ExercisePoolCard key={exercise.id} exercise={exercise} onRemove={() => removeFromPool(exercise.id)} />
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      {poolExercises.length > 0 && (
        <div className="border-t border-border p-1.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-[11px] h-7 text-muted-foreground hover:text-destructive gap-1.5"
            onClick={clearPool}
          >
            <Trash2 className="size-3" />
            Clear Pool
          </Button>
        </div>
      )}
    </div>
  )
}
