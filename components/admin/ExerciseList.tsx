"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Search, ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Dumbbell, Upload, Download } from "lucide-react"
import { EXERCISE_TEMPLATE_CSV, EXERCISE_RELATIONSHIPS_TEMPLATE_CSV } from "@/lib/csv-templates"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { ExerciseFormDialog } from "@/components/admin/ExerciseFormDialog"
import { ExerciseImportDialog } from "@/components/admin/ExerciseImportDialog"
import { EXERCISE_CATEGORIES, EXERCISE_DIFFICULTIES } from "@/lib/validators/exercise"
import type { Exercise } from "@/types/database"

interface ExerciseListProps {
  exercises: Exercise[]
}

const CATEGORY_LABELS: Record<string, string> = {
  strength: "Strength",
  cardio: "Cardio",
  flexibility: "Flexibility",
  plyometric: "Plyometric",
  sport_specific: "Sport Specific",
  recovery: "Recovery",
}

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
}

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-success/10 text-success",
  intermediate: "bg-warning/10 text-warning",
  advanced: "bg-destructive/10 text-destructive",
}

const PAGE_SIZE_OPTIONS = [10, 25, 50]

export function ExerciseList({ exercises }: ExerciseListProps) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [difficultyFilter, setDifficultyFilter] = useState<string>("all")
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  // Dialog states
  const [formOpen, setFormOpen] = useState(false)
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Exercise | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false)
  const templateMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) {
        setTemplateMenuOpen(false)
      }
    }
    if (templateMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [templateMenuOpen])

  function downloadTemplate(type: "exercises" | "relationships") {
    const csv = type === "exercises" ? EXERCISE_TEMPLATE_CSV : EXERCISE_RELATIONSHIPS_TEMPLATE_CSV
    const filename = type === "exercises" ? "exercises_import_template.csv" : "exercise_relationships_template.csv"
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    setTemplateMenuOpen(false)
  }

  // Selection states
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [isBulkActing, setIsBulkActing] = useState(false)

  const filtered = exercises.filter((ex) => {
    const matchesSearch =
      !search ||
      ex.name.toLowerCase().includes(search.toLowerCase()) ||
      (ex.muscle_group?.toLowerCase().includes(search.toLowerCase()) ?? false)
    const cats: string[] = Array.isArray(ex.category) ? ex.category : [ex.category]
    const matchesCategory = categoryFilter === "all" || cats.includes(categoryFilter)
    const matchesDifficulty = difficultyFilter === "all" || ex.difficulty === difficultyFilter
    return matchesSearch && matchesCategory && matchesDifficulty
  })

  const totalPages = Math.ceil(filtered.length / perPage)
  const paginated = filtered.slice((page - 1) * perPage, page * perPage)

  const allPageSelected = paginated.length > 0 && paginated.every((ex) => selectedIds.has(ex.id))

  function toggleSelectAll() {
    const next = new Set(selectedIds)
    if (allPageSelected) {
      paginated.forEach((ex) => next.delete(ex.id))
    } else {
      paginated.forEach((ex) => next.add(ex.id))
    }
    setSelectedIds(next)
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setSelectedIds(next)
  }

  function handleCreate() {
    setEditingExercise(null)
    setFormOpen(true)
  }

  function handleEdit(exercise: Exercise) {
    setEditingExercise(exercise)
    setFormOpen(true)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)

    try {
      const response = await fetch(`/api/admin/exercises/${deleteTarget.id}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to delete")
      }

      toast.success("Exercise deleted successfully")
      setDeleteTarget(null)
      router.refresh()
    } catch {
      toast.error("Failed to delete exercise")
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleBulkAction(action: "delete" | "activate" | "deactivate") {
    if (selectedIds.size === 0) return
    if (action === "delete") {
      setBulkDeleteOpen(true)
      return
    }

    setIsBulkActing(true)
    try {
      const response = await fetch("/api/admin/exercises/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: Array.from(selectedIds) }),
      })
      if (!response.ok) throw new Error("Bulk action failed")
      toast.success(`${selectedIds.size} exercise${selectedIds.size !== 1 ? "s" : ""} updated`)
      setSelectedIds(new Set())
      router.refresh()
    } catch {
      toast.error("Failed to perform bulk action")
    } finally {
      setIsBulkActing(false)
    }
  }

  async function confirmBulkDelete() {
    setIsBulkActing(true)
    try {
      const response = await fetch("/api/admin/exercises/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", ids: Array.from(selectedIds) }),
      })
      if (!response.ok) throw new Error("Bulk delete failed")
      toast.success(`${selectedIds.size} exercise${selectedIds.size !== 1 ? "s" : ""} deleted`)
      setSelectedIds(new Set())
      setBulkDeleteOpen(false)
      router.refresh()
    } catch {
      toast.error("Failed to delete exercises")
    } finally {
      setIsBulkActing(false)
    }
  }

  // Show empty state when no exercises at all (not just filtered)
  if (exercises.length === 0) {
    return (
      <div>
        <EmptyState
          icon={Dumbbell}
          heading="No exercises yet"
          description="Create your exercise library to build training programs. Add exercises with descriptions, videos, and difficulty levels."
        />
        <div className="flex justify-center gap-2">
          <div className="relative" ref={templateMenuRef}>
            <Button variant="outline" onClick={() => setTemplateMenuOpen(!templateMenuOpen)}>
              <Download className="size-4" />
              Download Template
            </Button>
            {templateMenuOpen && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg border border-border shadow-lg z-50 py-1">
                <button
                  className="w-full text-left px-4 py-2 text-sm hover:bg-surface/50 transition-colors"
                  onClick={() => downloadTemplate("exercises")}
                >
                  Exercise Library Template
                </button>
                <button
                  className="w-full text-left px-4 py-2 text-sm hover:bg-surface/50 transition-colors"
                  onClick={() => downloadTemplate("relationships")}
                >
                  Exercise Relationships Template
                </button>
              </div>
            )}
          </div>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" />
            Import CSV
          </Button>
          <Button onClick={handleCreate}>
            <Plus className="size-4" />
            Add Exercise
          </Button>
        </div>
        <ExerciseFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          exercise={editingExercise}
        />
        <ExerciseImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
        />
      </div>
    )
  }

  return (
    <div>
      {/* Header with Add + Import buttons */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {exercises.length} exercise{exercises.length !== 1 ? "s" : ""} in library
        </p>
        <div className="flex items-center gap-2">
          <div className="relative" ref={templateMenuRef}>
            <Button variant="outline" onClick={() => setTemplateMenuOpen(!templateMenuOpen)}>
              <Download className="size-4" />
              Download Template
            </Button>
            {templateMenuOpen && (
              <div className="absolute top-full right-0 mt-1 w-64 bg-white rounded-lg border border-border shadow-lg z-50 py-1">
                <button
                  className="w-full text-left px-4 py-2 text-sm hover:bg-surface/50 transition-colors"
                  onClick={() => downloadTemplate("exercises")}
                >
                  Exercise Library Template
                </button>
                <button
                  className="w-full text-left px-4 py-2 text-sm hover:bg-surface/50 transition-colors"
                  onClick={() => downloadTemplate("relationships")}
                >
                  Exercise Relationships Template
                </button>
              </div>
            )}
          </div>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" />
            Import CSV
          </Button>
          <Button onClick={handleCreate}>
            <Plus className="size-4" />
            Add Exercise
          </Button>
        </div>
      </div>

      {/* Bulk Actions Toolbar */}
      {selectedIds.size > 0 && (
        <div className="mb-3 flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5">
          <span className="text-sm font-medium text-primary">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleBulkAction("deactivate")}
              disabled={isBulkActing}
            >
              Deactivate
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleBulkAction("delete")}
              disabled={isBulkActing}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border shadow-sm">
        {/* Toolbar */}
        <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search exercises..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="pl-9 h-9"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }}
              className="h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground"
            >
              <option value="all">All Categories</option>
              {EXERCISE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
              ))}
            </select>
            <select
              value={difficultyFilter}
              onChange={(e) => { setDifficultyFilter(e.target.value); setPage(1) }}
              className="h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground"
            >
              <option value="all">All Difficulties</option>
              {EXERCISE_DIFFICULTIES.map((diff) => (
                <option key={diff} value={diff}>{DIFFICULTY_LABELS[diff]}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/50">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={toggleSelectAll}
                    className="size-4 rounded border-border accent-primary"
                  />
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Difficulty</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Muscle Group</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Equipment</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((exercise) => (
                <tr key={exercise.id} className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(exercise.id)}
                      onChange={() => toggleSelect(exercise.id)}
                      className="size-4 rounded border-border accent-primary"
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">{exercise.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      {(Array.isArray(exercise.category) ? exercise.category : [exercise.category]).map((cat) => (
                        <span key={cat} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary capitalize">
                          {CATEGORY_LABELS[cat] ?? cat}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${DIFFICULTY_COLORS[exercise.difficulty] ?? "bg-muted text-muted-foreground"}`}>
                      {DIFFICULTY_LABELS[exercise.difficulty] ?? exercise.difficulty}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                    {exercise.muscle_group || "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                    {exercise.equipment || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleEdit(exercise)}
                        title="Edit exercise"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setDeleteTarget(exercise)}
                        title="Delete exercise"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    No exercises found matching your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-border flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>Rows per page:</span>
            <select
              value={perPage}
              onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1) }}
              className="h-8 rounded border border-border bg-white px-2 text-sm"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span className="ml-2">
              {filtered.length === 0
                ? "0"
                : `${(page - 1) * perPage + 1}-${Math.min(page * perPage, filtered.length)}`}{" "}
              of {filtered.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="p-1.5 rounded-lg hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Create/Edit Dialog */}
      <ExerciseFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        exercise={editingExercise}
      />

      {/* Import Dialog */}
      <ExerciseImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Exercise</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This action can be undone by an administrator.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.size} Exercises</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedIds.size} exercise{selectedIds.size !== 1 ? "s" : ""}? This action can be undone by an administrator.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={isBulkActing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmBulkDelete}
              disabled={isBulkActing}
            >
              {isBulkActing ? "Deleting..." : "Delete All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
