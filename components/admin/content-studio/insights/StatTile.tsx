// components/admin/content-studio/insights/StatTile.tsx
// One number, one label, one optional hint line. The building block for both
// bands on the Insights tab.

interface StatTileProps {
  label: string
  value: string
  hint?: string
  /** Lets a test scope its query to this one tile instead of matching by value alone. */
  testId?: string
}

export function StatTile({ label, value, hint, testId }: StatTileProps) {
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm" data-testid={testId}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-2xl text-primary tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
