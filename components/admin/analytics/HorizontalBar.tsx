import { cn } from "@/lib/utils"

export interface HorizontalBarItem {
  label: string
  count: number
  badge?: string
  secondBadge?: string
}

interface HorizontalBarProps {
  items: HorizontalBarItem[]
  maxValue?: number
  colorClass?: string
  formatValue?: (v: number) => string
  emptyMessage?: string
}

export function HorizontalBar({
  items,
  maxValue,
  colorClass = "bg-primary",
  formatValue = (v) => String(v),
  emptyMessage = "No data yet.",
}: HorizontalBarProps) {
  if (items.length === 0) {
    return <div className="p-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
  }

  const max = maxValue ?? Math.max(...items.map((i) => i.count), 1)

  return (
    <div className="p-4 space-y-3">
      {items.map((item) => {
        const pct = Math.round((item.count / max) * 100)
        return (
          <div key={item.label}>
            <div className="flex items-center justify-between mb-1 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{item.label}</p>
                {item.badge && (
                  <span className="shrink-0 inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {item.badge}
                  </span>
                )}
                {item.secondBadge && (
                  <span className="shrink-0 inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {item.secondBadge}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground whitespace-nowrap">{formatValue(item.count)}</p>
            </div>
            <div className="h-2 rounded-full bg-surface overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", colorClass)}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
