"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { Search, Ban, X, ChevronUp, Plus, Check, Loader2, AlertTriangle } from "lucide-react"
import Image from "next/image"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { extractYouTubeId, getYouTubeThumbnailUrl } from "@/lib/youtube"
import type { Exercise } from "@/types/database"
import type { ExerciseBlockRow } from "@/lib/db/exercise-blocks"

const CATEGORY_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "strength", label: "Strength" },
  { value: "power", label: "Power" },
  { value: "speed", label: "Speed" },
  { value: "plyometric", label: "Plyo" },
  { value: "mobility", label: "Mobility" },
  { value: "flexibility", label: "Flex" },
]

interface BlockedExercisePanelProps {
  /** All exercises in the library */
  allExercises: Exercise[]
  /** Present only when the program has an assigned client. */
  clientId?: string
  clientName?: string
  onClose: () => void
}

type Scope = "studio" | "client"

/**
 * The blocklist, shaped like the Exercise Pool because the coach already knows
 * that shape: search the library on top, the curated list below, click to add,
 * click to remove.
 *
 * It is the OPPOSITE list, so it is deliberately not styled like one. The pool
 * is accent/primary and says "prefer these"; this is destructive-red with a ⊘
 * and says "never these". They are also mutually exclusive in the builder — two
 * opposite lists open side by side is exactly how a coach ends up adding to the
 * wrong one.
 *
 * Unlike the pool, which lives in sessionStorage and dies with the tab, every
 * change here is a write: blocks are permanent and apply to every future
 * generation, not just this program.
 */
export function BlockedExercisePanel({ allExercises, clientId, clientName, onClose }: BlockedExercisePanelProps) {
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [browseOpen, setBrowseOpen] = useState(true)
  const [scope, setScope] = useState<Scope>("studio")
  const [blocks, setBlocks] = useState<ExerciseBlockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const urls = ["/api/admin/exercises/blocks"]
      if (clientId) urls.push(`/api/admin/exercises/blocks?client_id=${clientId}`)
      const results = await Promise.all(urls.map((u) => fetch(u).then((r) => (r.ok ? r.json() : { blocks: [] }))))
      setBlocks(results.flatMap((r) => r.blocks as ExerciseBlockRow[]))
    } catch {
      toast.error("Could not load blocked exercises")
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  const blockedIds = useMemo(() => new Set(blocks.map((b) => b.exercise_id)), [blocks])

  const filtered = useMemo(() => {
    if (!search && categoryFilter === "all") return allExercises.slice(0, 50)
    return allExercises
      .filter((ex) => {
        const q = search.toLowerCase()
        const matchesSearch =
          !search ||
          ex.name.toLowerCase().includes(q) ||
          (ex.muscle_group?.toLowerCase().includes(q) ?? false) ||
          ex.primary_muscles.some((m) => m.toLowerCase().includes(q))
        const cats: string[] = Array.isArray(ex.category) ? ex.category : [ex.category]
        const matchesCategory = categoryFilter === "all" || cats.includes(categoryFilter)
        return matchesSearch && matchesCategory
      })
      .slice(0, 50)
  }, [allExercises, search, categoryFilter])

  async function block(exercise: Exercise) {
    if (blockedIds.has(exercise.id)) return
    setBusyId(exercise.id)
    try {
      const res = await fetch("/api/admin/exercises/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exercise_id: exercise.id,
          ...(scope === "client" && clientId ? { client_id: clientId } : {}),
        }),
      })
      if (!res.ok) throw new Error("Could not block this exercise")
      const data = await res.json()
      await load()
      if (data.remainingInPattern === 0 && data.movementPattern) {
        // Not a toast: a toast is gone in four seconds and this one changes
        // what the coach should expect from every future generation.
        toast.warning(`${exercise.name} was the last usable ${data.movementPattern}`, {
          description: `Days that ask for a ${data.movementPattern} will fall back to a related movement.`,
          duration: 10000,
        })
      } else {
        toast.success(`${exercise.name} blocked`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not block this exercise")
    } finally {
      setBusyId(null)
    }
  }

  async function unblock(row: ExerciseBlockRow) {
    setBusyId(row.exercise_id)
    try {
      const res = await fetch(`/api/admin/exercises/blocks/${row.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Could not unblock this exercise")
      setBlocks((prev) => prev.filter((b) => b.id !== row.id))
      toast.success(`${row.exercises?.name ?? "Exercise"} unblocked`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not unblock this exercise")
    } finally {
      setBusyId(null)
    }
  }

  const firstName = clientName?.split(" ")[0] ?? "this client"

  return (
    <div className="w-72 xl:w-80 shrink-0 flex flex-col max-h-[calc(100vh-8rem)] sticky top-4 rounded-xl border border-destructive/30 bg-white overflow-hidden shadow-sm">
      {/* Header — destructive, never the pool's accent. */}
      <div className="flex items-center justify-between border-b border-destructive/20 px-3 py-2 bg-destructive/5 shrink-0">
        <div className="flex items-center gap-2">
          <Ban className="size-4 text-destructive" />
          <h3 className="text-sm font-semibold text-foreground">Blocked</h3>
          {blocks.length > 0 && (
            <span className="text-[10px] font-medium bg-destructive/10 text-destructive rounded-full px-1.5 py-0.5">
              {blocks.length}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      <p className="px-3 py-1.5 text-[10px] leading-relaxed text-muted-foreground border-b border-border shrink-0">
        The AI will never program these — in this program or any other. They stay in your library.
      </p>

      {/* Browse & block — mirrors the pool's collapsible browse section */}
      <div className="border-b border-border shrink-0">
        <button
          className="flex items-center justify-between w-full px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setBrowseOpen(!browseOpen)}
        >
          <span className="flex items-center gap-1.5">
            <Plus className="size-3" />
            Browse &amp; Block Exercises
          </span>
          <ChevronUp className={`size-3 transition-transform ${browseOpen ? "" : "rotate-180"}`} />
        </button>

        {browseOpen && (
          <div className="px-2 pb-2 space-y-2">
            {clientId && (
              <div className="flex gap-1">
                <button
                  className={`flex-1 text-[9px] font-medium px-1.5 py-1 rounded-full transition-colors ${
                    scope === "studio" ? "bg-destructive text-white" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setScope("studio")}
                >
                  For every client
                </button>
                <button
                  className={`flex-1 text-[9px] font-medium px-1.5 py-1 rounded-full transition-colors ${
                    scope === "client" ? "bg-destructive text-white" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setScope("client")}
                >
                  {firstName} only
                </button>
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search exercises..."
                className="h-7 pl-7 text-xs"
              />
            </div>

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

            <div className="max-h-48 overflow-y-auto space-y-0.5 rounded-md border border-border">
              {filtered.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center py-4">No exercises found</p>
              ) : (
                filtered.map((exercise) => {
                  const isBlocked = blockedIds.has(exercise.id)
                  const youtubeId = exercise.video_url ? extractYouTubeId(exercise.video_url) : null
                  const thumb = youtubeId ? getYouTubeThumbnailUrl(youtubeId) : null
                  const cats = Array.isArray(exercise.category) ? exercise.category : [exercise.category]
                  return (
                    <button
                      key={exercise.id}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors ${
                        isBlocked ? "bg-destructive/5 cursor-default" : "hover:bg-muted/50 cursor-pointer"
                      }`}
                      onClick={() => !isBlocked && block(exercise)}
                      disabled={isBlocked || busyId === exercise.id}
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
                      {busyId === exercise.id ? (
                        <Loader2 className="size-3.5 text-muted-foreground shrink-0 animate-spin" />
                      ) : isBlocked ? (
                        <Check className="size-3.5 text-destructive shrink-0" />
                      ) : (
                        <Ban className="size-3.5 text-muted-foreground shrink-0" />
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* The blocked list */}
      <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-1.5">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading blocks…
          </div>
        ) : blocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <p className="text-xs text-muted-foreground">Nothing blocked</p>
            <p className="text-[10px] text-muted-foreground/70 px-4 leading-relaxed">
              Search above, or use the ⊘ on any exercise in a day. Blocking is permanent until you undo it here.
            </p>
          </div>
        ) : (
          blocks.map((row) => (
            <div
              key={row.id}
              className="group flex items-center gap-2 rounded-lg border border-border bg-white px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-foreground truncate">
                  {row.exercises?.name ?? "Removed exercise"}
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  {row.exercises?.movement_pattern && (
                    <span className="text-[8px] text-muted-foreground capitalize">
                      {row.exercises.movement_pattern}
                    </span>
                  )}
                  {row.client_id ? (
                    <span className="text-[8px] font-medium text-destructive">{firstName} only</span>
                  ) : (
                    <span className="text-[8px] font-medium text-muted-foreground">everyone</span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                title="Unblock"
                disabled={busyId === row.exercise_id}
                onClick={() => unblock(row)}
                className="text-muted-foreground hover:text-primary"
              >
                {busyId === row.exercise_id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <X className="size-3.5" />
                )}
              </Button>
            </div>
          ))
        )}
      </div>

      {blocks.length > 0 && (
        <div className="border-t border-border px-3 py-1.5 shrink-0 flex items-start gap-1.5">
          <AlertTriangle className="size-3 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-[9px] leading-relaxed text-muted-foreground">
            Blocks apply to every program, not just this one.
          </p>
        </div>
      )}
    </div>
  )
}
