"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import {
  Search,
  Plus,
  Trash2,
  ChevronDown,
  ArrowUpRight,
  ArrowDownRight,
  Repeat2,
  GitBranch,
  Loader2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import type { Exercise, ExerciseRelationshipType } from "@/types/database"

interface ExerciseRelationshipsProps {
  exerciseId: string
  exerciseName: string
}

interface RelationshipWithExercise {
  id: string
  exercise_id: string
  related_exercise_id: string
  relationship_type: ExerciseRelationshipType
  notes: string | null
  created_at: string
  exercises: Exercise
}

const RELATIONSHIP_CONFIG: Record<
  ExerciseRelationshipType,
  { label: string; icon: typeof ArrowUpRight; color: string; badgeClass: string; description: string }
> = {
  progression: {
    label: "Progressions",
    icon: ArrowUpRight,
    color: "text-success",
    badgeClass: "bg-success/10 text-success border-success/20",
    description: "Harder variations to progress toward",
  },
  regression: {
    label: "Regressions",
    icon: ArrowDownRight,
    color: "text-warning",
    badgeClass: "bg-warning/10 text-warning border-warning/20",
    description: "Easier variations to regress to",
  },
  alternative: {
    label: "Alternatives",
    icon: Repeat2,
    color: "text-primary",
    badgeClass: "bg-primary/10 text-primary border-primary/20",
    description: "Exercises targeting similar muscles/patterns",
  },
  variation: {
    label: "Variations",
    icon: GitBranch,
    color: "text-accent",
    badgeClass: "bg-accent/10 text-accent-foreground border-accent/20",
    description: "Different forms of this exercise",
  },
}

const RELATIONSHIP_TYPES: ExerciseRelationshipType[] = [
  "progression",
  "regression",
  "alternative",
  "variation",
]

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

export function ExerciseRelationships({
  exerciseId,
  exerciseName,
}: ExerciseRelationshipsProps) {
  const [relationships, setRelationships] = useState<RelationshipWithExercise[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isOpen, setIsOpen] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  // Add form state
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<Exercise[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null)
  const [relationshipType, setRelationshipType] = useState<ExerciseRelationshipType>("progression")
  const [notes, setNotes] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchRelationships = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/admin/exercise-relationships?exerciseId=${exerciseId}`
      )
      if (!response.ok) throw new Error("Failed to fetch")
      const data = await response.json()
      setRelationships(data)
    } catch {
      toast.error("Failed to load relationships")
    } finally {
      setIsLoading(false)
    }
  }, [exerciseId])

  useEffect(() => {
    fetchRelationships()
  }, [fetchRelationships])

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
        // Filter out the current exercise from results
        setSearchResults(
          data.filter((ex: Exercise) => ex.id !== exerciseId)
        )
      } catch {
        toast.error("Failed to search exercises")
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, exerciseId])

  async function handleAdd() {
    if (!selectedExercise) return
    setIsSubmitting(true)

    try {
      const response = await fetch("/api/admin/exercise-relationships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exercise_id: exerciseId,
          related_exercise_id: selectedExercise.id,
          relationship_type: relationshipType,
          notes: notes || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to create relationship")
      }

      toast.success(`${selectedExercise.name} added as ${relationshipType}`)
      setAddDialogOpen(false)
      resetAddForm()
      fetchRelationships()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add relationship")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete(id: string, relatedName: string) {
    setDeletingId(id)
    try {
      const response = await fetch(`/api/admin/exercise-relationships/${id}`, {
        method: "DELETE",
      })

      if (!response.ok) throw new Error("Failed to delete")

      toast.success(`Removed ${relatedName}`)
      fetchRelationships()
    } catch {
      toast.error("Failed to remove relationship")
    } finally {
      setDeletingId(null)
    }
  }

  function resetAddForm() {
    setSearchQuery("")
    setSearchResults([])
    setSelectedExercise(null)
    setRelationshipType("progression")
    setNotes("")
  }

  // Group relationships by type
  const grouped = RELATIONSHIP_TYPES.reduce(
    (acc, type) => {
      acc[type] = relationships.filter((r) => r.relationship_type === type)
      return acc
    },
    {} as Record<ExerciseRelationshipType, RelationshipWithExercise[]>
  )

  const totalCount = relationships.length

  return (
    <div className="border border-border rounded-lg">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-surface/50 transition-colors rounded-lg"
      >
        <span className="flex items-center gap-2">
          Relationships
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
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Relationship groups */}
              {RELATIONSHIP_TYPES.map((type) => {
                const config = RELATIONSHIP_CONFIG[type]
                const items = grouped[type]
                const Icon = config.icon

                if (items.length === 0) return null

                return (
                  <div key={type} className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Icon className={`size-3.5 ${config.color}`} />
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {config.label}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {items.map((rel) => (
                        <div
                          key={rel.id}
                          className="flex items-center gap-2 rounded-md border border-border bg-surface/30 px-3 py-2 group"
                        >
                          <Badge
                            className={`shrink-0 text-[10px] border ${config.badgeClass}`}
                          >
                            {type}
                          </Badge>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">
                              {rel.exercises?.name ?? "Unknown exercise"}
                            </p>
                            {rel.notes && (
                              <p className="text-xs text-muted-foreground truncate">
                                {rel.notes}
                              </p>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() =>
                              handleDelete(
                                rel.id,
                                rel.exercises?.name ?? "relationship"
                              )
                            }
                            disabled={deletingId === rel.id}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                          >
                            {deletingId === rel.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Trash2 className="size-3" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}

              {totalCount === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No relationships defined for this exercise.
                </p>
              )}

              {/* Add button */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddDialogOpen(true)}
                className="w-full"
              >
                <Plus className="size-3.5" />
                Add Relationship
              </Button>
            </>
          )}
        </div>
      )}

      {/* Add Relationship Dialog */}
      <Dialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          if (!open) resetAddForm()
          setAddDialogOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Relationship</DialogTitle>
            <DialogDescription>
              Link a related exercise to {exerciseName}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Relationship Type */}
            <div className="space-y-2">
              <Label htmlFor="rel-type">Relationship Type</Label>
              <select
                id="rel-type"
                value={relationshipType}
                onChange={(e) =>
                  setRelationshipType(e.target.value as ExerciseRelationshipType)
                }
                className={selectClass}
              >
                {RELATIONSHIP_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {RELATIONSHIP_CONFIG[type].label.slice(0, -1)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {RELATIONSHIP_CONFIG[relationshipType].description}
              </p>
            </div>

            {/* Exercise Search */}
            <div className="space-y-2">
              <Label>Related Exercise</Label>
              {selectedExercise ? (
                <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                  <span className="text-sm font-medium flex-1 truncate">
                    {selectedExercise.name}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setSelectedExercise(null)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      placeholder="Search exercises..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 h-9"
                    />
                    {isSearching && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {searchResults.length > 0 && (
                    <div className="max-h-[200px] overflow-y-auto space-y-0.5 rounded-md border border-border bg-white">
                      {searchResults.map((ex) => (
                        <button
                          key={ex.id}
                          type="button"
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface/50 transition-colors text-sm"
                          onClick={() => {
                            setSelectedExercise(ex)
                            setSearchQuery("")
                            setSearchResults([])
                          }}
                        >
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
                </>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="rel-notes">Notes (optional)</Label>
              <textarea
                id="rel-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Use when client has limited mobility..."
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAddDialogOpen(false)
                resetAddForm()
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAdd}
              disabled={!selectedExercise || isSubmitting}
            >
              {isSubmitting ? "Adding..." : "Add Relationship"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
