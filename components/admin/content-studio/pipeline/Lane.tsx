"use client"

import type { ReactNode } from "react"
import { useDroppable } from "@dnd-kit/core"
import { HelpCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type LaneTone = "neutral" | "progress" | "success" | "published" | "warning" | "failed"

function InfoTip({ children, srLabel }: { children: ReactNode; srLabel: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={srLabel}
            onPointerDown={(e) => e.stopPropagation()}
            className="inline-flex items-center text-muted-foreground/70 hover:text-primary focus-visible:outline-none focus-visible:text-primary transition"
          >
            <HelpCircle className="size-3.5" strokeWidth={1.75} />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-xs leading-relaxed">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

const TONE_STYLES: Record<LaneTone, { rule: string; pill: string; label: string }> = {
  neutral:   { rule: "bg-border",           pill: "bg-muted/60 text-muted-foreground",          label: "text-muted-foreground" },
  progress:  { rule: "bg-accent/70",        pill: "bg-accent/15 text-accent-foreground",        label: "text-accent-foreground" },
  success:   { rule: "bg-success/80",       pill: "bg-success/10 text-success",                 label: "text-success" },
  published: { rule: "bg-primary/80",       pill: "bg-primary/10 text-primary",                 label: "text-primary" },
  warning:   { rule: "bg-warning/80",       pill: "bg-warning/10 text-warning",                 label: "text-warning" },
  failed:    { rule: "bg-error/80",         pill: "bg-error/10 text-error",                     label: "text-error" },
}

export function LaneColumn({
  id,
  label,
  count,
  accepts,
  tone = "neutral",
  help,
  children,
}: {
  id: string
  label: string
  count: number
  /** If false, this column is read-only; drops are ignored. */
  accepts: boolean
  tone?: LaneTone
  /** Optional explainer copy shown via a help-icon tooltip beside the label. */
  help?: ReactNode
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !accepts })
  const styles = TONE_STYLES[tone]
  return (
    <div
      ref={setNodeRef}
      className={cn(
        // flex-1 + basis-0 = grow to share row equally; min-w keeps columns readable
        // and triggers overflow-x-auto on the parent when the viewport is narrow.
        "group/col flex flex-col rounded-xl bg-white/80 min-h-[220px] min-w-[240px] flex-1 basis-0",
        "border border-border/60 shadow-[0_1px_0_rgba(15,23,42,0.03)]",
        "transition",
        accepts && isOver && "ring-2 ring-primary/50 bg-primary/[0.04]",
      )}
    >
      {/* top rule — tone-coded thread at the very top of each column */}
      <div className={cn("h-[3px] rounded-t-xl", styles.rule)} aria-hidden />
      <header className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className={cn("font-heading text-[10.5px] uppercase tracking-[0.14em] truncate", styles.label)}>
            {label}
          </p>
          {help && <InfoTip srLabel={`What is ${label}?`}>{help}</InfoTip>}
        </div>
        <span
          className={cn(
            "inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 py-0.5",
            "font-mono text-[10.5px] font-medium tabular-nums leading-none",
            styles.pill,
          )}
        >
          {count}
        </span>
      </header>
      <div className="flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-2.5">{children}</div>
    </div>
  )
}

interface LaneProps {
  title: string
  subtitle?: string
  /** Optional compact stat (e.g. "6 total · 1 with posts"). Shown inline with header. */
  meta?: React.ReactNode
  /** Subtle tinted background behind the whole lane — conveys "band" separation. */
  tone?: "neutral" | "primary"
  /** Optional explainer shown via help icon next to the section title. */
  help?: ReactNode
  children: React.ReactNode
}

export function Lane({ title, subtitle, meta, tone = "neutral", help, children }: LaneProps) {
  return (
    <section
      aria-label={title}
      className={cn(
        "rounded-2xl px-4 pt-4 pb-3 sm:px-5",
        tone === "primary" ? "bg-primary/[0.035]" : "bg-surface/70",
        "border border-border/50",
      )}
    >
      <header className="flex items-end justify-between gap-4 pb-3 mb-3 border-b border-border/60">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={cn(
              "inline-block h-5 w-[3px] shrink-0 rounded-full",
              tone === "primary" ? "bg-primary" : "bg-accent",
            )}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="font-heading text-[15px] font-semibold text-primary tracking-tight leading-none">
                {title}
              </h2>
              {help && <InfoTip srLabel={`About ${title}`}>{help}</InfoTip>}
            </div>
            {subtitle && (
              <p className="mt-1 text-[11.5px] text-muted-foreground leading-snug">{subtitle}</p>
            )}
          </div>
        </div>
        {meta && (
          <div className="text-[11px] text-muted-foreground font-mono tabular-nums whitespace-nowrap">
            {meta}
          </div>
        )}
      </header>
      <div className="flex gap-3 overflow-x-auto pb-1">{children}</div>
    </section>
  )
}
