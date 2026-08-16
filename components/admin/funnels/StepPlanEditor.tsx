"use client"

// The step plan, as editable rows.
//
// WHY ROWS AND NOT A COUNT. The obvious control for "how many steps" is a
// number spinner, and it is the wrong one: setting it to four still leaves the
// owner four things to name, so the spinner answers a question nobody was
// actually asking. The plan IS the answer — the count is however many rows
// survive.
//
// Its own file rather than more of `CreateFunnelDialog` because it carries
// reorder, add, remove, per-row slug derivation and the entry-row pin. Folded
// in, the dialog becomes a file that cannot be held in one screenful, which is
// how the create dialogs drifted apart in the first place.

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { slugify } from "@/lib/funnels/slug"
import { ENTRY_STEP_SLUG, MAX_FUNNEL_STEPS } from "@/lib/funnels/templates"
import { FUNNEL_SLUG_PATTERN } from "@/lib/validators/funnel"
import type { FunnelGoal } from "@/types/database"

export interface PlannedStep {
  name: string
  slug: string
  goal: FunnelGoal | null
}

interface StepPlanEditorProps {
  /** The funnel's own slug, for showing each step's full address. */
  funnelSlug: string
  steps: PlannedStep[]
  onChange: (steps: PlannedStep[]) => void
}

/**
 * Per-row problems, computed here so the dialog's submit gate and the row's own
 * message come from ONE calculation. Two would drift and the owner would meet a
 * disabled button with nothing marked red.
 */
export function stepPlanErrors(steps: PlannedStep[]): (string | null)[] {
  const seen = new Map<string, number>()
  steps.forEach((step, index) => {
    if (!seen.has(step.slug)) seen.set(step.slug, index)
  })
  return steps.map((step, index) => {
    if (step.name.trim().length < 2) return "Name this step."
    // The entry row's path is not editable, so it cannot be wrong.
    if (index === 0) return null
    if (step.slug.length < 2) return "Give it a path."
    if (!FUNNEL_SLUG_PATTERN.test(step.slug)) return "Lowercase letters, numbers and hyphens only."
    if (step.slug === ENTRY_STEP_SLUG) return "That path belongs to the first step."
    if (seen.get(step.slug) !== index) return "Two steps cannot share a path."
    return null
  })
}

export function StepPlanEditor({ funnelSlug, steps, onChange }: StepPlanEditorProps) {
  const errors = stepPlanErrors(steps)
  const base = `/go/${funnelSlug || "…"}`

  function update(index: number, patch: Partial<PlannedStep>) {
    onChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)))
  }

  function move(index: number, delta: number) {
    const target = index + delta
    // Row 0 is the entry step and stays row 0 — moving anything into or out of
    // that slot would silently change which page /go/<slug> serves.
    if (target < 1 || target >= steps.length || index < 1) return
    const next = [...steps]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  function remove(index: number) {
    if (index === 0) return
    onChange(steps.filter((_, i) => i !== index))
  }

  function add() {
    if (steps.length >= MAX_FUNNEL_STEPS) return
    onChange([...steps, { name: "", slug: "", goal: null }])
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">Steps</span>
        <span className="text-xs text-muted-foreground">
          {steps.length} {steps.length === 1 ? "step" : "steps"}
        </span>
      </div>

      <ul className="space-y-2 rounded-lg border border-border p-2">
        {steps.map((step, index) => {
          const isEntry = index === 0
          return (
            <li key={index} data-testid="step-row" className="flex items-start gap-2">
              <span className="mt-2.5 w-4 shrink-0 text-xs text-muted-foreground">{index + 1}</span>

              <div className="min-w-0 flex-1 space-y-1">
                <Input
                  aria-label={`Step ${index + 1} name`}
                  value={step.name}
                  onChange={(event) => update(index, { name: event.target.value })}
                  placeholder="Thank you"
                  className="h-8"
                />
                <div className="flex items-center gap-1 rounded-md border border-border bg-surface/40 px-2">
                  <span className="shrink-0 text-xs text-muted-foreground">{base}/</span>
                  <Input
                    aria-label={`Step ${index + 1} path`}
                    value={isEntry ? "" : step.slug}
                    // The entry step IS the funnel's address. Letting it be
                    // re-pathed leaves /go/<slug> serving nothing, so the field
                    // shows the bare address and refuses input rather than
                    // pretending it is a choice.
                    disabled={isEntry}
                    placeholder={isEntry ? "(the funnel's own address)" : "thank-you"}
                    onChange={(event) => update(index, { slug: slugify(event.target.value) })}
                    className="h-7 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
                  />
                </div>
                {errors[index] ? (
                  <p className="text-xs text-[var(--error)]">{errors[index]}</p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Move step ${index + 1} up`}
                  disabled={index < 2}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Move step ${index + 1} down`}
                  disabled={isEntry || index === steps.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
                {/* No remove button on the entry row at all, rather than a
                    disabled one: there is no circumstance in which removing it
                    is the right thing, and a greyed-out control invites the
                    owner to look for the way to enable it. */}
                {isEntry ? (
                  <span className="inline-block size-7" aria-hidden />
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Remove step ${index + 1}`}
                    onClick={() => remove(index)}
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {steps.length >= MAX_FUNNEL_STEPS ? (
        <p className="text-xs text-muted-foreground">
          That is the most a funnel can start with. You can add more once it exists.
        </p>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="size-3.5" />
          Add step
        </Button>
      )}
    </div>
  )
}
