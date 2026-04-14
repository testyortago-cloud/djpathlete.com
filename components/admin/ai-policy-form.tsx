"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import type { CoachAiPolicy } from "@/lib/db/coach-ai-policy"

const TECHNIQUES = [
  { id: "straight_set", label: "Straight sets" },
  { id: "superset", label: "Supersets" },
  { id: "dropset", label: "Drop sets" },
  { id: "giant_set", label: "Giant sets" },
  { id: "circuit", label: "Circuits" },
  { id: "rest_pause", label: "Rest-pause" },
  { id: "amrap", label: "AMRAP" },
  { id: "cluster_set", label: "Cluster sets" },
  { id: "complex", label: "Complexes" },
  { id: "emom", label: "EMOM" },
  { id: "wave_loading", label: "Wave loading" },
] as const

export function AiPolicyForm({ initialPolicy }: { initialPolicy: CoachAiPolicy | null }) {
  const [disallowed, setDisallowed] = useState<string[]>(initialPolicy?.disallowed_techniques ?? [])
  const [preferred, setPreferred] = useState<string[]>(initialPolicy?.preferred_techniques ?? [])
  const [progression, setProgression] = useState(initialPolicy?.technique_progression_enabled ?? true)
  const [notes, setNotes] = useState(initialPolicy?.programming_notes ?? "")
  const [isPending, startTransition] = useTransition()

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>, id: string) =>
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const res = await fetch("/api/admin/ai-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disallowed_techniques: disallowed,
          preferred_techniques: preferred,
          technique_progression_enabled: progression,
          programming_notes: notes.trim(),
        }),
      })
      if (!res.ok) {
        toast.error("Failed to save policy")
        return
      }
      toast.success("AI policy updated — applies to your next generation")
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <section className="space-y-3">
        <Label className="text-base">Disallowed techniques</Label>
        <p className="text-sm text-muted-foreground">
          The AI will NEVER use these in any program. Useful if you don&apos;t program circuits, EMOMs, etc.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {TECHNIQUES.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={disallowed.includes(t.id)} onCheckedChange={() => toggle(setDisallowed, t.id)} />
              {t.label}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <Label className="text-base">Preferred techniques</Label>
        <p className="text-sm text-muted-foreground">
          When the AI has a choice, favor these. Leave blank to let the AI decide by goal and phase.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {TECHNIQUES.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={preferred.includes(t.id)}
                onCheckedChange={() => toggle(setPreferred, t.id)}
                disabled={disallowed.includes(t.id)}
              />
              {t.label}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base">Phase-based technique progression</Label>
            <p className="text-sm text-muted-foreground">
              When ON, the AI introduces variety across weeks (e.g., straight sets early, supersets later). When OFF, it
              keeps the same technique every week.
            </p>
          </div>
          <Switch checked={progression} onCheckedChange={setProgression} />
        </div>
      </section>

      <section className="space-y-3">
        <Label htmlFor="notes" className="text-base">
          Programming notes (free-form)
        </Label>
        <p className="text-sm text-muted-foreground">
          Anything the AI should always know about how you program. Injected as coach instructions.
        </p>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={6}
          placeholder="e.g., My athletes do sport conditioning outside the gym — keep gym work strength-focused."
          maxLength={4000}
        />
      </section>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Save policy"}
      </Button>
    </form>
  )
}
