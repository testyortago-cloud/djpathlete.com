"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { Search, Plus, X, Dumbbell, Loader2, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Exercise } from "@/types/database"

interface TrackedItem {
  id: string
  exercise_id: string
  exercises: Pick<Exercise, "id" | "name" | "muscle_group" | "equipment"> | null
}

interface ExerciseTrackerProps {
  initialTracked: TrackedItem[]
}

type SearchResult = Pick<Exercise, "id" | "name" | "muscle_group" | "equipment" | "category">

export function ExerciseTracker({ initialTracked }: ExerciseTrackerProps) {
  const [tracked, setTracked] = useState<TrackedItem[]>(initialTracked)
  const [searching, setSearching] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trackedIds = new Set(tracked.map((t) => t.exercise_id))

  // Search exercises with debounce
  useEffect(() => {
    if (!searching) return

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/client/exercises/search?q=${encodeURIComponent(searchQuery)}`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        setResults(data)
      } catch {
        toast.error("Failed to search exercises")
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchQuery, searching])

  async function handleAdd(exercise: SearchResult) {
    setAdding(exercise.id)
    try {
      const res = await fetch("/api/client/tracked-exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseId: exercise.id }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? "Failed to track exercise")
      }
      const newTracked = await res.json()
      setTracked((prev) => [
        ...prev,
        {
          id: newTracked.id,
          exercise_id: exercise.id,
          exercises: {
            id: exercise.id,
            name: exercise.name,
            muscle_group: exercise.muscle_group,
            equipment: exercise.equipment,
          },
        },
      ])
      toast.success(`Now tracking ${exercise.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to track exercise")
    } finally {
      setAdding(null)
    }
  }

  async function handleRemove(trackedItem: TrackedItem) {
    setRemoving(trackedItem.id)
    try {
      const res = await fetch(`/api/client/tracked-exercises?id=${encodeURIComponent(trackedItem.id)}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error()
      setTracked((prev) => prev.filter((t) => t.id !== trackedItem.id))
      toast.success(`Stopped tracking ${trackedItem.exercises?.name ?? "exercise"}`)
    } catch {
      toast.error("Failed to remove tracked exercise")
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Target className="size-4 text-primary" strokeWidth={1.5} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Tracked Exercises</h3>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Pick exercises to monitor your progress</p>
          </div>
        </div>
        {!searching && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1 text-xs"
            onClick={() => {
              setSearching(true)
              setTimeout(() => inputRef.current?.focus(), 100)
            }}
          >
            <Plus className="size-3" />
            Add
          </Button>
        )}
      </div>

      {/* Search panel */}
      {searching && (
        <div className="px-4 sm:px-5 py-3 border-b border-border bg-muted/30 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search exercises (e.g. squat, bench, deadlift)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-8 rounded-md border border-input bg-white pl-8 pr-3 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              />
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="size-8 p-0 shrink-0"
              onClick={() => {
                setSearching(false)
                setSearchQuery("")
                setResults([])
              }}
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Results */}
          <div className="max-h-52 overflow-y-auto -mx-1 px-1">
            {loading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && results.length === 0 && searchQuery && (
              <p className="text-xs text-muted-foreground text-center py-4">No exercises found</p>
            )}
            {!loading && results.length > 0 && (
              <div className="space-y-0.5">
                {results.map((ex) => {
                  const isTracked = trackedIds.has(ex.id)
                  const isAdding = adding === ex.id
                  return (
                    <button
                      key={ex.id}
                      disabled={isTracked || isAdding}
                      onClick={() => handleAdd(ex)}
                      className={cn(
                        "w-full text-left rounded-md px-3 py-2 flex items-center gap-3 transition-colors",
                        isTracked ? "opacity-50 cursor-default bg-muted/50" : "hover:bg-muted/50 cursor-pointer",
                      )}
                    >
                      <div className="size-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Dumbbell className="size-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{ex.name}</p>
                        <p className="text-[10px] text-muted-foreground capitalize">
                          {[ex.muscle_group, ex.equipment].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      {isAdding ? (
                        <Loader2 className="size-3.5 animate-spin text-muted-foreground shrink-0" />
                      ) : isTracked ? (
                        <span className="text-[10px] text-muted-foreground shrink-0">Tracking</span>
                      ) : (
                        <Plus className="size-3.5 text-primary shrink-0" />
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tracked exercises list */}
      {tracked.length === 0 ? (
        <div className="px-4 sm:px-5 py-8 text-center">
          <Dumbbell className="size-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No exercises tracked yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Add exercises you want to monitor — like your main lifts
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {tracked.map((item) => {
            const ex = item.exercises
            const isRemoving = removing === item.id
            return (
              <div key={item.id} className="px-4 sm:px-5 py-3 flex items-center gap-3">
                <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Dumbbell className="size-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{ex?.name ?? "Unknown Exercise"}</p>
                  {ex?.muscle_group && (
                    <p className="text-[10px] text-muted-foreground capitalize">
                      {[ex.muscle_group, ex.equipment].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => handleRemove(item)}
                  disabled={isRemoving}
                  aria-label={`Remove ${ex?.name ?? "exercise"}`}
                >
                  {isRemoving ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
