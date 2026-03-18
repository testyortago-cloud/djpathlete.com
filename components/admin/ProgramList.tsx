"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import Link from "next/link"
import { Search, ChevronLeft, ChevronRight, Plus, Pencil, Trash2, ClipboardList, LayoutGrid, Sparkles, Globe, Lock, Users, UserCheck, MessageSquare } from "lucide-react"
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
import { ProgramFormDialog } from "@/components/admin/ProgramFormDialog"
import { AiGenerateDialog } from "@/components/admin/AiGenerateDialog"
import { AiProgramChatDialog } from "@/components/admin/AiProgramChatDialog"
import { PROGRAM_CATEGORIES, PROGRAM_DIFFICULTIES, PROGRAM_TIERS } from "@/lib/validators/program"
import type { Program } from "@/types/database"

interface ProgramListProps {
  programs: Program[]
  athleteCounts?: Record<string, number>
}

const CATEGORY_LABELS: Record<string, string> = {
  strength: "Strength",
  conditioning: "Conditioning",
  sport_specific: "Sport Specific",
  recovery: "Recovery",
  nutrition: "Nutrition",
  hybrid: "Hybrid",
}

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  elite: "Elite",
}

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-success/10 text-success",
  intermediate: "bg-warning/10 text-warning",
  advanced: "bg-destructive/10 text-destructive",
  elite: "bg-primary/10 text-primary",
}

const TIER_LABELS: Record<string, string> = {
  generalize: "Generalize",
  premium: "Premium",
}

const TIER_COLORS: Record<string, string> = {
  generalize: "bg-muted text-muted-foreground",
  premium: "bg-accent/15 text-accent",
}

const PAGE_SIZE_OPTIONS = [10, 25, 50]

function formatPrice(cents: number | null): string {
  if (cents == null) return "Free"
  return `$${(cents / 100).toFixed(2)}`
}

export function ProgramList({ programs, athleteCounts = {} }: ProgramListProps) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [difficultyFilter, setDifficultyFilter] = useState<string>("all")
  const [tierFilter, setTierFilter] = useState<string>("all")
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  // Dialog states
  const [formOpen, setFormOpen] = useState(false)
  const [aiDialogOpen, setAiDialogOpen] = useState(false)
  const [chatDialogOpen, setChatDialogOpen] = useState(false)
  const [editingProgram, setEditingProgram] = useState<Program | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Program | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const filtered = programs.filter((prog) => {
    const matchesSearch =
      !search ||
      prog.name.toLowerCase().includes(search.toLowerCase()) ||
      (prog.description?.toLowerCase().includes(search.toLowerCase()) ?? false)
    const cats: string[] = Array.isArray(prog.category) ? prog.category : [prog.category]
    const matchesCategory = categoryFilter === "all" || cats.includes(categoryFilter)
    const matchesDifficulty = difficultyFilter === "all" || prog.difficulty === difficultyFilter
    const matchesTier = tierFilter === "all" || prog.tier === tierFilter
    return matchesSearch && matchesCategory && matchesDifficulty && matchesTier
  })

  const totalPages = Math.ceil(filtered.length / perPage)
  const paginated = filtered.slice((page - 1) * perPage, page * perPage)

  function handleCreate() {
    setEditingProgram(null)
    setFormOpen(true)
  }

  function handleEdit(program: Program) {
    setEditingProgram(program)
    setFormOpen(true)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)

    try {
      const response = await fetch(`/api/admin/programs/${deleteTarget.id}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to delete")
      }

      toast.success("Program deleted successfully")
      setDeleteTarget(null)
      router.refresh()
    } catch {
      toast.error("Failed to delete program")
    } finally {
      setIsDeleting(false)
    }
  }

  // Show empty state when no programs at all (not just filtered)
  if (programs.length === 0) {
    return (
      <div>
        <EmptyState
          icon={ClipboardList}
          heading="No programs yet"
          description="Build structured training programs by combining exercises into weekly schedules. Assign programs to clients to track their progress."
        />
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={handleCreate}>
            <Plus className="size-4" />
            Add Program
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAiDialogOpen(true)}>
            <Sparkles className="size-4" />
            Generate
          </Button>
          <Button variant="outline" size="sm" onClick={() => setChatDialogOpen(true)}>
            <MessageSquare className="size-4" />
            Chat
          </Button>
        </div>
        <ProgramFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          program={editingProgram}
        />
        <AiGenerateDialog
          open={aiDialogOpen}
          onOpenChange={setAiDialogOpen}
        />
        <AiProgramChatDialog
          open={chatDialogOpen}
          onOpenChange={setChatDialogOpen}
        />
      </div>
    )
  }

  return (
    <div>
      {/* Header with Add button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <p className="text-sm text-muted-foreground">
          {programs.length} program{programs.length !== 1 ? "s" : ""} in library
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setChatDialogOpen(true)}>
            <MessageSquare className="size-4" />
            <span className="hidden sm:inline">AI Chat</span>
            <span className="sm:hidden">Chat</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAiDialogOpen(true)}>
            <Sparkles className="size-4" />
            <span className="hidden sm:inline">AI Generate</span>
            <span className="sm:hidden">Generate</span>
          </Button>
          <Button size="sm" onClick={handleCreate}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm">
        {/* Toolbar */}
        <div className="p-3 sm:p-4 border-b border-border space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search programs..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="pl-9 h-9"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-1 px-1">
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }}
              className="h-9 rounded-lg border border-border bg-white px-2 sm:px-3 text-xs sm:text-sm text-foreground shrink-0"
            >
              <option value="all">Category</option>
              {PROGRAM_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
              ))}
            </select>
            <select
              value={difficultyFilter}
              onChange={(e) => { setDifficultyFilter(e.target.value); setPage(1) }}
              className="h-9 rounded-lg border border-border bg-white px-2 sm:px-3 text-xs sm:text-sm text-foreground shrink-0"
            >
              <option value="all">Difficulty</option>
              {PROGRAM_DIFFICULTIES.map((diff) => (
                <option key={diff} value={diff}>{DIFFICULTY_LABELS[diff]}</option>
              ))}
            </select>
            <select
              value={tierFilter}
              onChange={(e) => { setTierFilter(e.target.value); setPage(1) }}
              className="h-9 rounded-lg border border-border bg-white px-2 sm:px-3 text-xs sm:text-sm text-foreground shrink-0"
            >
              <option value="all">Tier</option>
              {PROGRAM_TIERS.map((t) => (
                <option key={t} value={t}>{TIER_LABELS[t]}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Difficulty</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Duration</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Sessions/Wk</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Price</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Athletes</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((program) => (
                <tr key={program.id} className="border-b border-border last:border-b-0 hover:bg-surface/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Link href={`/admin/programs/${program.id}`} className="hover:underline">
                        {program.name}
                      </Link>
                      <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${TIER_COLORS[program.tier] ?? "bg-muted text-muted-foreground"}`} title={`${TIER_LABELS[program.tier] ?? program.tier} tier`}>
                        {TIER_LABELS[program.tier] ?? program.tier}
                      </span>
                      {program.is_ai_generated && (
                        <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-accent/20 text-accent shrink-0" title="AI Generated">
                          <Sparkles className="size-2.5" />
                          AI
                        </span>
                      )}
                      {program.is_public ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-success/10 text-success shrink-0" title="Public — visible in store">
                          <Globe className="size-2.5" />
                          Public
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground shrink-0" title="Private — assigned clients only">
                          <Lock className="size-2.5" />
                          Private
                        </span>
                      )}
                      {program.target_user_id && (
                        <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-accent/15 text-accent shrink-0" title="Targeted — visible to specific client only">
                          <UserCheck className="size-2.5" />
                          Targeted
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(Array.isArray(program.category) ? program.category : [program.category]).map((cat) => (
                        <span key={cat} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary capitalize whitespace-nowrap">
                          {CATEGORY_LABELS[cat] ?? cat}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${DIFFICULTY_COLORS[program.difficulty] ?? "bg-muted text-muted-foreground"}`}>
                      {DIFFICULTY_LABELS[program.difficulty] ?? program.difficulty}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                    {program.duration_weeks} week{program.duration_weeks !== 1 ? "s" : ""}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                    {program.sessions_per_week}x
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                    {formatPrice(program.price_cents)}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {(() => {
                      const count = athleteCounts[program.id] ?? 0
                      return (
                        <span className={`inline-flex items-center gap-1 text-sm ${count > 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                          <Users className="size-3.5" />
                          {count}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/admin/programs/${program.id}`}>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="Build program"
                        >
                          <LayoutGrid className="size-3.5" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleEdit(program)}
                        title="Edit program"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setDeleteTarget(program)}
                        title="Delete program"
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
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    No programs found matching your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-3 sm:p-4 border-t border-border flex items-center justify-between text-sm gap-2">
          <div className="flex items-center gap-2 text-muted-foreground min-w-0">
            <span className="hidden sm:inline">Rows per page:</span>
            <select
              value={perPage}
              onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1) }}
              className="h-8 rounded border border-border bg-white px-2 text-sm"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span className="text-xs sm:text-sm">
              {filtered.length === 0
                ? "0"
                : `${(page - 1) * perPage + 1}-${Math.min(page * perPage, filtered.length)}`}{" "}
              of {filtered.length}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
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
      <ProgramFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        program={editingProgram}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Program</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This will permanently remove the program, all its exercises, and all client assignments. This action cannot be undone.
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

      {/* AI Generate Dialog */}
      <AiGenerateDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
      />

      {/* AI Chat Builder Dialog */}
      <AiProgramChatDialog
        open={chatDialogOpen}
        onOpenChange={setChatDialogOpen}
      />
    </div>
  )
}
