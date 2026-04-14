"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Ban, CheckCircle2, Sparkles, FileText } from "lucide-react"
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
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Disallowed */}
      <section className="bg-white rounded-xl border border-border p-6">
        <div className="flex items-start gap-2 mb-5">
          <Ban className="size-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <h2 className="text-lg font-semibold text-primary leading-tight">Disallowed Techniques</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              The AI will <span className="font-medium text-foreground">never</span> use these in any program. Useful if
              you don&apos;t program circuits, EMOMs, etc.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {TECHNIQUES.map((t) => {
            const checked = disallowed.includes(t.id)
            return (
              <label
                key={t.id}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                  checked
                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                    : "border-border hover:border-primary/30 hover:bg-surface/50"
                }`}
              >
                <Checkbox checked={checked} onCheckedChange={() => toggle(setDisallowed, t.id)} />
                <span className="select-none">{t.label}</span>
              </label>
            )
          })}
        </div>
      </section>

      {/* Preferred */}
      <section className="bg-white rounded-xl border border-border p-6">
        <div className="flex items-start gap-2 mb-5">
          <CheckCircle2 className="size-5 text-success mt-0.5 shrink-0" />
          <div>
            <h2 className="text-lg font-semibold text-primary leading-tight">Preferred Techniques</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              When the AI has a choice, favor these. Leave blank to let the AI decide by goal and phase.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {TECHNIQUES.map((t) => {
            const checked = preferred.includes(t.id)
            const disabled = disallowed.includes(t.id)
            return (
              <label
                key={t.id}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                  disabled
                    ? "border-border bg-muted/40 text-muted-foreground cursor-not-allowed opacity-60"
                    : checked
                      ? "border-success/40 bg-success/5 text-success cursor-pointer"
                      : "border-border hover:border-primary/30 hover:bg-surface/50 cursor-pointer"
                }`}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggle(setPreferred, t.id)}
                  disabled={disabled}
                />
                <span className="select-none">{t.label}</span>
              </label>
            )
          })}
        </div>
        {disallowed.length > 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            Techniques marked disallowed above are locked out here.
          </p>
        )}
      </section>

      {/* Progression */}
      <section className="bg-white rounded-xl border border-border p-6">
        <div className="flex items-start gap-2 mb-5">
          <Sparkles className="size-5 text-primary mt-0.5 shrink-0" />
          <div>
            <h2 className="text-lg font-semibold text-primary leading-tight">Phase-Based Progression</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Control how the AI introduces variety across training weeks.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface/30 p-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {progression ? "Variety across weeks" : "Consistent each week"}
            </p>
            <p className="text-xs text-muted-foreground">
              {progression
                ? "Straight sets early, supersets later, etc. Keeps programs fresh."
                : "Same technique repeats every week. Simpler, more predictable."}
            </p>
          </div>
          <Switch checked={progression} onCheckedChange={setProgression} />
        </div>
      </section>

      {/* Notes */}
      <section className="bg-white rounded-xl border border-border p-6">
        <div className="flex items-start gap-2 mb-5">
          <FileText className="size-5 text-primary mt-0.5 shrink-0" />
          <div>
            <h2 className="text-lg font-semibold text-primary leading-tight">Programming Notes</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Anything the AI should always know about how you program. Injected as coach instructions.
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes" className="sr-only">
            Programming notes
          </Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={6}
            placeholder="e.g., My athletes do sport conditioning outside the gym — keep gym work strength-focused."
            maxLength={4000}
          />
          <p className="text-xs text-muted-foreground text-right tabular-nums">{notes.length} / 4000</p>
        </div>
      </section>

      {/* Save bar */}
      <div className="sticky bottom-0 bg-white/95 backdrop-blur-sm border border-border rounded-xl p-4 flex items-center justify-between gap-3 shadow-sm">
        <p className="text-xs text-muted-foreground">
          Changes apply to your <span className="font-medium text-foreground">next</span> AI program generation.
        </p>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : "Save Policy"}
        </Button>
      </div>
    </form>
  )
}
