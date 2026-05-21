"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowRight, Calendar, ClipboardCopy, Layers, Search, User, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface CopySource {
  programId: string
  programName: string
  durationWeeks: number
  assignees: { id: string; name: string }[]
}

interface ExerciseCounts {
  total: number
  byWeek: Record<string, number>
  byWeekDay: Record<string, number>
}

interface CopyFromProgramDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetProgramId: string
  targetTotalWeeks: number
  defaultTargetWeek: number
  defaultTargetDay?: number
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

type Scope = "day" | "week" | "program"

function pluralise(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

function sourceLabel(s: CopySource): string {
  if (s.assignees.length === 0) return "Unassigned template"
  if (s.assignees.length === 1) return s.assignees[0].name
  return `${s.assignees.length} clients`
}

export function CopyFromProgramDialog({
  open,
  onOpenChange,
  targetProgramId,
  targetTotalWeeks,
  defaultTargetWeek,
  defaultTargetDay,
}: CopyFromProgramDialogProps) {
  const router = useRouter()

  const [sources, setSources] = useState<CopySource[]>([])
  const [loadingSources, setLoadingSources] = useState(false)
  const [search, setSearch] = useState("")

  const [sourceProgramId, setSourceProgramId] = useState<string>("")
  const [scope, setScope] = useState<Scope>("week")
  const [sourceWeek, setSourceWeek] = useState<number>(1)
  const [sourceDay, setSourceDay] = useState<number>(defaultTargetDay ?? 1)
  const [targetWeek, setTargetWeek] = useState<number>(defaultTargetWeek)
  const [targetDay, setTargetDay] = useState<number>(defaultTargetDay ?? 1)
  const [includeWeights, setIncludeWeights] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [counts, setCounts] = useState<ExerciseCounts | null>(null)
  const [loadingCounts, setLoadingCounts] = useState(false)

  // Reset on each open
  useEffect(() => {
    if (!open) return
    setSearch("")
    setSourceProgramId("")
    setScope("week")
    setSourceWeek(1)
    setSourceDay(defaultTargetDay ?? 1)
    setTargetWeek(defaultTargetWeek)
    setTargetDay(defaultTargetDay ?? 1)
    setIncludeWeights(false)
    setCounts(null)
  }, [open, defaultTargetWeek, defaultTargetDay])

  // Load sources on open
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingSources(true)
    fetch(`/api/admin/programs/copy-sources?exclude=${targetProgramId}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || "Failed to load programs")
        }
        const data = (await res.json()) as { sources: CopySource[] }
        if (!cancelled) setSources(data.sources ?? [])
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Failed to load programs")
      })
      .finally(() => {
        if (!cancelled) setLoadingSources(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, targetProgramId])

  // Fetch exercise counts whenever source program changes
  useEffect(() => {
    if (!sourceProgramId) {
      setCounts(null)
      return
    }
    let cancelled = false
    setLoadingCounts(true)
    fetch(`/api/admin/programs/${sourceProgramId}/exercise-counts`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load preview")
        const data = (await res.json()) as ExerciseCounts
        if (!cancelled) setCounts(data)
      })
      .catch(() => {
        if (!cancelled) setCounts(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingCounts(false)
      })
    return () => {
      cancelled = true
    }
  }, [sourceProgramId])

  const filteredSources = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sources
    return sources.filter((s) => {
      if (s.programName.toLowerCase().includes(q)) return true
      if (s.assignees.some((a) => a.name.toLowerCase().includes(q))) return true
      if (s.assignees.length === 0 && "unassigned template".includes(q)) return true
      return false
    })
  }, [sources, search])

  const selectedSource = sources.find((s) => s.programId === sourceProgramId) ?? null
  const maxSourceWeek = selectedSource?.durationWeeks ?? 1

  // Clamp source week when source program changes
  useEffect(() => {
    if (selectedSource && sourceWeek > selectedSource.durationWeeks) {
      setSourceWeek(selectedSource.durationWeeks)
    }
  }, [selectedSource, sourceWeek])

  // Preview text for the chosen source slice
  const sourcePreview = useMemo(() => {
    if (!counts) return null
    if (scope === "day") {
      const n = counts.byWeekDay[`${sourceWeek}:${sourceDay}`] ?? 0
      return n === 0 ? "This day is empty — nothing to copy" : `${pluralise(n, "exercise")} on this day`
    }
    if (scope === "week") {
      const n = counts.byWeek[String(sourceWeek)] ?? 0
      if (n === 0) return "This week is empty — nothing to copy"
      const days = Object.keys(counts.byWeekDay).filter((k) => k.startsWith(`${sourceWeek}:`)).length
      return `${pluralise(n, "exercise")} across ${pluralise(days, "day")}`
    }
    if (scope === "program") {
      const totalWeeks = selectedSource?.durationWeeks ?? 0
      const copyableWeeks = Math.min(totalWeeks, targetTotalWeeks)
      const copied = Object.entries(counts.byWeek)
        .filter(([w]) => Number(w) <= copyableWeeks)
        .reduce((sum, [, n]) => sum + n, 0)
      const skipped = counts.total - copied
      if (copied === 0) return "Source program is empty"
      const base = `${pluralise(copied, "exercise")} across ${pluralise(copyableWeeks, "week")}`
      return skipped > 0
        ? `${base} (${pluralise(skipped, "exercise")} in later weeks will be skipped)`
        : base
    }
    return null
  }, [counts, scope, sourceWeek, sourceDay, selectedSource, targetTotalWeeks])

  const canSubmit = !submitting && !!sourceProgramId

  async function handleSubmit() {
    if (!sourceProgramId) {
      toast.error("Pick a source program")
      return
    }
    if (scope === "program" && sourceProgramId === targetProgramId) {
      toast.error("Cannot copy a whole program onto itself")
      return
    }

    setSubmitting(true)
    try {
      const body: Record<string, unknown> = { sourceProgramId, scope, includeWeights }
      if (scope === "day") {
        body.sourceWeek = sourceWeek
        body.sourceDay = sourceDay
        body.targetWeek = targetWeek
        body.targetDay = targetDay
      } else if (scope === "week") {
        body.sourceWeek = sourceWeek
        body.targetWeek = targetWeek
      }

      const res = await fetch(`/api/admin/programs/${targetProgramId}/copy-from`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed to copy")

      const inserted = (data as { inserted?: number }).inserted ?? 0
      if (inserted === 0) {
        toast.warning("Nothing was copied — the selected source was empty")
      } else {
        toast.success(`Copied ${pluralise(inserted, "exercise")} into this program`)
        onOpenChange(false)
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to copy")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCopy className="size-4" />
            Copy from another program
          </DialogTitle>
          <DialogDescription>
            Pick a source program, then choose what to copy. Existing exercises on the target day are kept — copied
            ones are added after them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* ─── Step 1: Pick source ─────────────────────────────── */}
          {!sourceProgramId ? (
            <div className="space-y-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Step 1 · Pick a source program
              </Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  autoFocus
                  placeholder="Search by client name or program name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                  disabled={loadingSources}
                />
              </div>
              <div className="border rounded-md max-h-72 overflow-y-auto divide-y">
                {loadingSources && (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading programs…</div>
                )}
                {!loadingSources && filteredSources.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {sources.length === 0
                      ? "No other programs available to copy from."
                      : "No programs match your search."}
                  </div>
                )}
                {filteredSources.map((s) => (
                  <button
                    key={s.programId}
                    type="button"
                    onClick={() => setSourceProgramId(s.programId)}
                    className="w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{s.programName}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <User className="size-3" />
                        <span className="truncate">{sourceLabel(s)}</span>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {pluralise(s.durationWeeks, "week")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Selected source banner */}
              <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Source</div>
                  <div className="text-sm font-medium truncate">{selectedSource?.programName}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <User className="size-3" />
                    <span className="truncate">{selectedSource ? sourceLabel(selectedSource) : ""}</span>
                    <span>·</span>
                    <span>{pluralise(selectedSource?.durationWeeks ?? 0, "week")}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSourceProgramId("")
                    setCounts(null)
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  <X className="size-3" />
                  Change
                </button>
              </div>

              {/* Step 2 — scope */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Step 2 · What to copy</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { value: "day", label: "One day", icon: Calendar },
                      { value: "week", label: "Whole week", icon: Layers },
                      { value: "program", label: "Whole program", icon: ClipboardCopy },
                    ] as const
                  ).map((opt) => {
                    const Icon = opt.icon
                    const active = scope === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setScope(opt.value)}
                        disabled={submitting}
                        className={`flex flex-col items-center gap-1 rounded-md border px-2 py-2.5 text-xs transition-colors ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input hover:bg-muted/60"
                        }`}
                      >
                        <Icon className="size-4" />
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Step 3 — source → target */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Step 3 · From source → into this program
                </Label>

                {scope === "program" ? (
                  <div className="rounded-md border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                    Every source week maps to the same week here (Week 1 → Week 1, Week 2 → Week 2, …). Source weeks
                    beyond Week {targetTotalWeeks} are skipped.
                  </div>
                ) : (
                  <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
                    {/* Source side */}
                    <div className="space-y-2 rounded-md border p-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">From source</div>
                      <div className="space-y-1.5">
                        <Label htmlFor="copySourceWeek" className="text-xs">
                          Week
                        </Label>
                        <Select
                          value={String(sourceWeek)}
                          onValueChange={(v) => setSourceWeek(Number(v))}
                          disabled={submitting}
                        >
                          <SelectTrigger id="copySourceWeek">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: maxSourceWeek }, (_, i) => i + 1).map((w) => (
                              <SelectItem key={w} value={String(w)}>
                                Week {w}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {scope === "day" && (
                        <div className="space-y-1.5">
                          <Label htmlFor="copySourceDay" className="text-xs">
                            Day
                          </Label>
                          <Select
                            value={String(sourceDay)}
                            onValueChange={(v) => setSourceDay(Number(v))}
                            disabled={submitting}
                          >
                            <SelectTrigger id="copySourceDay">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DAYS.map((name, i) => (
                                <SelectItem key={i + 1} value={String(i + 1)}>
                                  {name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>

                    <ArrowRight className="size-5 text-muted-foreground mb-3" />

                    {/* Target side */}
                    <div className="space-y-2 rounded-md border p-3 bg-accent/5">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Into this program</div>
                      <div className="space-y-1.5">
                        <Label htmlFor="copyTargetWeek" className="text-xs">
                          Week
                        </Label>
                        <Select
                          value={String(targetWeek)}
                          onValueChange={(v) => setTargetWeek(Number(v))}
                          disabled={submitting}
                        >
                          <SelectTrigger id="copyTargetWeek">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: targetTotalWeeks }, (_, i) => i + 1).map((w) => (
                              <SelectItem key={w} value={String(w)}>
                                Week {w}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {scope === "day" && (
                        <div className="space-y-1.5">
                          <Label htmlFor="copyTargetDay" className="text-xs">
                            Day
                          </Label>
                          <Select
                            value={String(targetDay)}
                            onValueChange={(v) => setTargetDay(Number(v))}
                            disabled={submitting}
                          >
                            <SelectTrigger id="copyTargetDay">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DAYS.map((name, i) => (
                                <SelectItem key={i + 1} value={String(i + 1)}>
                                  {name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Preview line */}
                <div className="text-xs text-muted-foreground min-h-[1.25rem]">
                  {loadingCounts ? "Loading preview…" : sourcePreview}
                </div>
              </div>

              {/* Include weights */}
              <label className="flex items-start gap-2 cursor-pointer rounded-md border p-3 hover:bg-muted/40 transition-colors">
                <Checkbox
                  checked={includeWeights}
                  onCheckedChange={(v) => setIncludeWeights(v === true)}
                  disabled={submitting}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  <span className="font-medium">Include suggested weights</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Off by default — sets, reps, RPE, tempo, and notes are always copied; weights rarely transfer
                    cleanly between athletes.
                  </span>
                </span>
              </label>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? "Copying…" : "Copy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
