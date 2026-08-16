"use client"

// Examples — worked ones first, then the owner's own funnels.
//
// The curated set is above because it is the answer to "show me one", and it is
// there on day one when the account has nothing. The owner's funnels are below
// because by the time they have any, they know what a funnel is and are looking
// for a shape to copy rather than a lesson.
//
// "Start from this" and "Copy this structure" both go through `onApply` — the
// SAME path Ask AI uses — so there is exactly one way anything writes to the
// create dialog's fields.

import { BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DataTableBadge } from "@/components/ui/data-table"
import { FUNNEL_EXAMPLES } from "@/lib/funnels/examples"
import { getTemplate } from "@/lib/funnels/templates"
import type { FunnelPlan } from "@/lib/funnels/ai-plan"

/** One of the owner's funnels, derived from what the board already loaded. */
export interface OwnExample {
  id: string
  name: string
  template: string | null
  stepNames: string[]
  live: boolean
}

interface ExamplesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onApply: (plan: FunnelPlan) => void
  ownExamples: OwnExample[]
}

export function ExamplesDialog({ open, onOpenChange, onApply, ownExamples }: ExamplesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="size-4 text-accent" aria-hidden />
            Examples
          </DialogTitle>
          <DialogDescription>
            What a good one looks like. Start from any of these and change whatever you like.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {FUNNEL_EXAMPLES.map((example) => {
            const template = getTemplate(example.template)
            return (
              <article
                key={example.slug}
                data-testid="curated-example"
                className="rounded-lg border border-border p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {template?.label ?? example.template}
                    </p>
                    <h3 className="mt-0.5 font-medium text-primary">{example.name}</h3>
                    <p className="font-mono text-xs text-muted-foreground">/go/{example.slug}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onApply({
                        template: example.template,
                        name: example.name,
                        steps: example.steps.map((step) => ({ ...step })),
                        audience: example.audience,
                        description: example.description,
                        offer: null,
                        startsAt: null,
                        endsAt: null,
                      })
                      onOpenChange(false)
                    }}
                  >
                    Start from this
                  </Button>
                </div>

                <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {example.steps.map((step, index) => (
                    <li key={step.slug}>
                      {index + 1}. {step.name}
                    </li>
                  ))}
                </ol>

                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">For:</span> {example.audience}
                </p>
                <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                  {example.description}
                </p>
                <p className="mt-2 border-t border-border pt-2 text-xs text-foreground">
                  <span className="font-medium">Why it works:</span> {example.whyItWorks}
                </p>
              </article>
            )
          })}
        </div>

        {/* Absent, not an empty state: the curated set above already answers
            "show me one", so a "you have no funnels yet" panel would be a box
            saying nothing directly under six boxes saying plenty. */}
        {ownExamples.length > 0 ? (
          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-medium">Your funnels</h3>
            {ownExamples.map((own) => (
              <div
                key={own.id}
                data-testid="own-example"
                className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-primary">{own.name}</p>
                    <DataTableBadge tone={own.live ? "success" : "neutral"}>
                      {own.live ? "live" : "draft"}
                    </DataTableBadge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {own.stepNames.length} {own.stepNames.length === 1 ? "step" : "steps"} ·{" "}
                    {own.stepNames.join(" → ")}
                  </p>
                </div>
                {/* Template only, because without one there is no step plan to
                    copy — the shape lives in the registry, not on the row. */}
                {own.template && getTemplate(own.template) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const template = getTemplate(own.template!)!
                      onApply({
                        template: template.value,
                        // NEVER the name or the slug. Both must stay unique, and
                        // copying them hands the owner a guaranteed 409.
                        name: "",
                        steps: template.steps.map((step) => ({ ...step })),
                        audience: null,
                        description: null,
                        offer: null,
                        startsAt: null,
                        endsAt: null,
                      })
                      onOpenChange(false)
                    }}
                  >
                    Copy this structure
                  </Button>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
