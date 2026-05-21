"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface CopySource {
  programId: string
  programName: string
  durationWeeks: number
  assignees: { id: string; name: string }[]
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

export function CopyFromProgramDialog({
  open,
  onOpenChange,
  targetProgramId,
  targetTotalWeeks,
  defaultTargetWeek,
  defaultTargetDay,
}: CopyFromProgramDialogProps) {
  const router = useRouter()

  const [scope, setScope] = useState<Scope>("week")
  const [sources, setSources] = useState<CopySource[]>([])
  const [loadingSources, setLoadingSources] = useState(false)

  const [clientFilter, setClientFilter] = useState<string>("all")
  const [sourceProgramId, setSourceProgramId] = useState<string>("")
  const [sourceWeek, setSourceWeek] = useState<number>(1)
  const [sourceDay, setSourceDay] = useState<number>(defaultTargetDay ?? 1)

  const [targetWeek, setTargetWeek] = useState<number>(defaultTargetWeek)
  const [targetDay, setTargetDay] = useState<number>(defaultTargetDay ?? 1)

  const [includeWeights, setIncludeWeights] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Reset transient state on each open
  useEffect(() => {
    if (!open) return
    setScope("week")
    setClientFilter("all")
    setSourceProgramId("")
    setSourceWeek(1)
    setSourceDay(defaultTargetDay ?? 1)
    setTargetWeek(defaultTargetWeek)
    setTargetDay(defaultTargetDay ?? 1)
    setIncludeWeights(false)
  }, [open, defaultTargetWeek, defaultTargetDay])

  // Load sources on open
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingSources(true)
    fetch(`/api/admin/programs/copy-sources?exclude=${targetProgramId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load programs")
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

  const allClients = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of sources) {
      for (const a of s.assignees) map.set(a.id, a.name)
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [sources])

  const filteredSources = useMemo(() => {
    if (clientFilter === "all") return sources
    if (clientFilter === "unassigned") return sources.filter((s) => s.assignees.length === 0)
    return sources.filter((s) => s.assignees.some((a) => a.id === clientFilter))
  }, [sources, clientFilter])

  const selectedSource = sources.find((s) => s.programId === sourceProgramId) ?? null
  const maxSourceWeek = selectedSource?.durationWeeks ?? 1

  // Clamp source week when source program changes
  useEffect(() => {
    if (selectedSource && sourceWeek > selectedSource.durationWeeks) {
      setSourceWeek(selectedSource.durationWeeks)
    }
  }, [selectedSource, sourceWeek])

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
      const body: Record<string, unknown> = {
        sourceProgramId,
        scope,
        includeWeights,
      }
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
      toast.success(`Copied ${inserted} exercise${inserted === 1 ? "" : "s"} into this program`)
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to copy")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy from another program</DialogTitle>
          <DialogDescription>
            Copy a single day, a full week, or every week from another client&apos;s program into this one. Existing
            exercises on the target day are kept — copied ones are appended after them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Scope */}
          <div className="space-y-2">
            <Label>What to copy</Label>
            <div className="flex gap-2">
              {(["day", "week", "program"] as const).map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant={scope === s ? "default" : "outline"}
                  size="sm"
                  className="flex-1 capitalize"
                  onClick={() => setScope(s)}
                  disabled={submitting}
                >
                  {s === "program" ? "Whole program" : s}
                </Button>
              ))}
            </div>
          </div>

          {/* Client filter */}
          <div className="space-y-2">
            <Label htmlFor="copyClientFilter">Filter by client</Label>
            <Select value={clientFilter} onValueChange={setClientFilter} disabled={submitting || loadingSources}>
              <SelectTrigger id="copyClientFilter">
                <SelectValue placeholder="All clients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                <SelectItem value="unassigned">Unassigned templates</SelectItem>
                {allClients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Source program */}
          <div className="space-y-2">
            <Label htmlFor="copySourceProgram">Source program</Label>
            <Select value={sourceProgramId} onValueChange={setSourceProgramId} disabled={submitting || loadingSources}>
              <SelectTrigger id="copySourceProgram">
                <SelectValue placeholder={loadingSources ? "Loading…" : "Pick a program"} />
              </SelectTrigger>
              <SelectContent>
                {filteredSources.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No programs match this filter.</div>
                )}
                {filteredSources.map((s) => {
                  const tag =
                    s.assignees.length === 0
                      ? "unassigned"
                      : s.assignees.length === 1
                        ? s.assignees[0].name
                        : `${s.assignees.length} clients`
                  return (
                    <SelectItem key={s.programId} value={s.programId}>
                      {s.programName} — {tag} · {s.durationWeeks}w
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Source week + optional day */}
          {scope !== "program" && selectedSource && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="copySourceWeek">Source week</Label>
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
                <div className="space-y-2">
                  <Label htmlFor="copySourceDay">Source day</Label>
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
          )}

          {/* Target week + optional day */}
          {scope !== "program" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="copyTargetWeek">Target week (this program)</Label>
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
                <div className="space-y-2">
                  <Label htmlFor="copyTargetDay">Target day</Label>
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
          )}

          {scope === "program" && selectedSource && (
            <p className="text-xs text-muted-foreground">
              Source has {selectedSource.durationWeeks} week{selectedSource.durationWeeks === 1 ? "" : "s"}; this
              program has {targetTotalWeeks}. Weeks 1 → 1, 2 → 2, etc. Any source week beyond Week {targetTotalWeeks}{" "}
              is skipped.
            </p>
          )}

          {/* Include weights */}
          <label className="flex items-start gap-2 cursor-pointer">
            <Checkbox
              checked={includeWeights}
              onCheckedChange={(v) => setIncludeWeights(v === true)}
              disabled={submitting}
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium">Include suggested weights</span>
              <span className="block text-xs text-muted-foreground">
                Off by default — the source client&apos;s loading rarely matches another athlete. Sets, reps, RPE,
                tempo, and notes are always copied.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !sourceProgramId}>
            {submitting ? "Copying…" : "Copy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
