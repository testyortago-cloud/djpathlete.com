"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Ban, AlertTriangle, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

interface BlockExerciseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  exerciseId: string
  exerciseName: string
  movementPattern: string | null
  /** Present only when the program has an assigned client. */
  clientId?: string
  clientName?: string
  /** Called after a block is successfully written. */
  onBlocked: () => void
}

type Scope = "studio" | "client"

/**
 * Block an exercise from AI generation.
 *
 * The copy carries two facts the coach would otherwise have to discover: the
 * block does not remove this exercise from the day in front of them, and it
 * does not remove it from the library. Both were deliberate design decisions —
 * see docs/superpowers/specs/2026-08-28-exercise-blocklist-design.md §3.
 */
export function BlockExerciseDialog({
  open,
  onOpenChange,
  exerciseId,
  exerciseName,
  movementPattern,
  clientId,
  clientName,
  onBlocked,
}: BlockExerciseDialogProps) {
  const [scope, setScope] = useState<Scope>("studio")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [starved, setStarved] = useState<string | null>(null)

  // A reopened dialog must not inherit the last exercise's answers — most of
  // all `starved`, which would otherwise warn about the wrong exercise.
  useEffect(() => {
    if (open) {
      setScope("studio")
      setReason("")
      setStarved(null)
      setSaving(false)
    }
  }, [open, exerciseId])

  async function handleBlock() {
    setSaving(true)
    try {
      const res = await fetch("/api/admin/exercises/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exercise_id: exerciseId,
          ...(scope === "client" && clientId ? { client_id: clientId } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? "Could not block this exercise")
      }
      const data = await res.json()
      onBlocked()

      // Hold the dialog open on the starved case so the warning is actually
      // read. Closing straight into a toast is how a coach ends up wondering
      // why carries stopped appearing weeks later.
      if (data.remainingInPattern === 0 && data.movementPattern) {
        setStarved(data.movementPattern as string)
        return
      }
      toast.success(`${exerciseName} blocked`)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not block this exercise")
    } finally {
      setSaving(false)
    }
  }

  const pattern = starved ?? movementPattern

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="size-4 text-destructive" />
            Block {exerciseName}?
          </DialogTitle>
          <DialogDescription>
            The AI won&apos;t program this again. It stays in your library and stays in programs you&apos;ve already
            built.
          </DialogDescription>
        </DialogHeader>

        {starved ? (
          <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <AlertTriangle className="size-4 shrink-0 text-warning mt-0.5" />
            <p className="text-sm text-foreground">
              This is the last usable <span className="font-medium">{pattern}</span> in your library. Days that ask for
              a {pattern} will fall back to a related movement.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground mb-2">Who does this apply to?</legend>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="block-scope-studio"
                  name="block-scope"
                  value="studio"
                  checked={scope === "studio"}
                  onChange={() => setScope("studio")}
                  className="size-4 accent-primary"
                />
                <Label htmlFor="block-scope-studio" className="font-normal cursor-pointer">
                  For every client
                </Label>
              </div>
              {clientId && (
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    id="block-scope-client"
                    name="block-scope"
                    value="client"
                    checked={scope === "client"}
                    onChange={() => setScope("client")}
                    className="size-4 accent-primary"
                  />
                  <Label htmlFor="block-scope-client" className="font-normal cursor-pointer">
                    For {clientName ?? "this client"} only
                  </Label>
                </div>
              )}
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="block-reason" className="font-normal">
                Reason <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="block-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this one off the table?"
                rows={2}
                maxLength={500}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {starved ? (
            <Button onClick={() => onOpenChange(false)}>Got it</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleBlock} disabled={saving}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                Block
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
