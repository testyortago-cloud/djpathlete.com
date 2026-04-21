"use client"

import { useDroppable } from "@dnd-kit/core"
import { cn } from "@/lib/utils"

export function LaneColumn({
  id,
  label,
  count,
  accepts,
  children,
}: {
  id: string
  label: string
  count: number
  /** If false, this column is read-only; drops are ignored. */
  accepts: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !accepts })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-lg bg-surface/40 min-h-[200px] min-w-[260px] w-[260px] transition",
        accepts && isOver && "bg-primary/5 ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <p className="text-xs font-semibold text-primary uppercase tracking-wide">{label}</p>
        <span className="text-[11px] text-muted-foreground">{count}</span>
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">{children}</div>
    </div>
  )
}

export function Lane({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <div>
        <h3 className="font-heading text-sm text-primary uppercase tracking-wide">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">{children}</div>
    </section>
  )
}
