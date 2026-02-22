"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import {
  Search,
  Plus,
  Trash2,
  ChevronDown,
  Repeat2,
  Loader2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import type { Exercise } from "@/types/database"

interface ExerciseRelationshipsProps {
  exerciseId: string
  exerciseName: string
}

interface AlternativeWithExercise {
  id: string
  related_exercise_id: string
  notes: string | null
  exercises: Exercise
}

export function ExerciseRelationships({
  exerciseId,
  exerciseName,
}: ExerciseRelationshipsProps) {
  const [alternatives, setAlternatives] = useState<AlternativeWithExercise[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isOpen, setIsOpen] = useState(false)

  // Search state
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<Exercise[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchAlternatives = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/admin/exercise-relationships?exerciseId=${exerciseId}`
      )
      if (!response.ok) throw new Error("Failed to fetch")
      const data = await response.json()
      // Only show alternatives
      const alts = data.filter((r: { relationship_type: string }) => r.relationship_type === "alternative")
      setAlternatives(alts)
      if (alts.length > 0) setIsOpen(true)
    } catch {
      toast.error("Failed to load alternatives")
    } finally {
      setIsLoading(false)
    }
  }, [exerciseId])

  useEffect(() => {
    fetchAlternatives()
  }, [fetchAlternatives])

  // Debounced exercise search
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const response = await fetch(
          `/api/admin/exercises?search=${encodeURIComponent(searchQuery)}`
        )
        if (!response.ok) throw new Error("Search failed")
        const data = await response.json()
        const existingIds = new Set([exerciseId, ...alternatives.map((a) => a.related_exercise_id)])
        setSearchResults(data.filter((ex: Exercise) => !existingIds.has(ex.id)))
      } catch {
        toast.error("Failed to search exercises")
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, exerciseId, alternatives])

  async function handleAdd(relatedExercise: Exercise) {
    if (!relatedExercise?.id) {
      toast.error("Selected exercise has no ID")
      return
    }
    if (!exerciseId) {
      toast.error("Current exercise has no ID")
      return
    }
    setIsAdding(true)
    const payload = {
      exercise_id: exerciseId,
      related_exercise_id: relatedExercise.id,
      relationship_type: "alternative",
    }
    console.log("[ExerciseRelationships] Adding alternative:", payload)
    try {
      const response = await fetch("/api/admin/exercise-relationships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json()
        const details = data.details
          ? Object.entries(data.details)
              .map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`)
              .join("; ")
          : ""
        throw new Error(details || data.error || "Failed to add alternative")
      }

      toast.success(`${relatedExercise.name} added as alternative`)
      setSearchQuery("")
      setSearchResults([])
      setIsOpen(true)
      await fetchAlternatives()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add alternative")
      // Refetch in case it already exists but isn't showing
      await fetchAlternatives()
    } finally {
      setIsAdding(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    setDeletingId(id)
    try {
      const response = await fetch(`/api/admin/exercise-relationships/${id}`, {
        method: "DELETE",
      })
      if (!response.ok) throw new Error("Failed to delete")
      // Optimistically remove from list
      setAlternatives((prev) => prev.filter((a) => a.id !== id))
      toast.success(`Removed ${name}`)
    } catch {
      toast.error("Failed to remove alternative")
      await fetchAlternatives()
    } finally {
      setDeletingId(null)
    }
  }

  const totalCount = alternatives.length

  return (
    <div className="border border-border rounded-lg">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-surface/50 transition-colors rounded-lg"
      >
        <span className="flex items-center gap-2">
          <Repeat2 className="size-4 text-primary" />
          Alternative Exercises
          {totalCount > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {totalCount}
            </Badge>
          )}
        </span>
        <ChevronDown
          className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Exercises clients can swap to during their workouts.
              </p>

              {/* Existing alternatives */}
              {alternatives.length > 0 && (
                <div className="space-y-1">
                  {alternatives.map((alt) => (
                    <div
                      key={alt.id}
                      className="flex items-center gap-2 rounded-md border border-border bg-surface/30 px-3 py-2 group"
                    >
                      <p className="text-sm font-medium text-foreground truncate flex-1">
                        {alt.exercises?.name ?? "Unknown exercise"}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() =>
                          handleDelete(alt.id, alt.exercises?.name ?? "alternative")
                        }
                        disabled={deletingId === alt.id}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                      >
                        {deletingId === alt.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Trash2 className="size-3" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {alternatives.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  No alternatives yet.
                </p>
              )}

              {/* Search to add */}
              <div className="space-y-1.5">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    placeholder="Search exercises to add..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-9"
                    disabled={isAdding}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery("")
                        setSearchResults([])
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                    >
                      <X className="size-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  )}
                </div>

                {isSearching && (
                  <div className="flex items-center justify-center py-2">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                )}

                {searchResults.length > 0 && (
                  <div className="max-h-[180px] overflow-y-auto space-y-0.5 rounded-md border border-border bg-white">
                    {searchResults.map((ex) => (
                      <button
                        key={ex.id}
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface/50 transition-colors text-sm"
                        onClick={() => handleAdd(ex)}
                        disabled={isAdding}
                      >
                        <Plus className="size-3.5 text-primary shrink-0" />
                        <span className="font-medium truncate flex-1">
                          {ex.name}
                        </span>
                        <span className="text-xs text-muted-foreground capitalize shrink-0">
                          {Array.isArray(ex.category) ? ex.category.join(", ") : ex.category}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {searchQuery.length >= 2 &&
                  !isSearching &&
                  searchResults.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      No exercises found.
                    </p>
                  )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
