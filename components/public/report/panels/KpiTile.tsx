/** Headline number tile — the reference report's "49/100 SPEED SCORE" block. */
export function KpiTile({
  value,
  unit,
  label,
  caption,
  isPr = false,
}: {
  value: string
  unit?: string
  label: string
  caption?: string
  isPr?: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline gap-1">
        <span className="font-heading text-3xl font-bold text-primary">{value}</span>
        {unit && <span className="font-mono text-xs text-muted-foreground">{unit}</span>}
        {isPr && (
          <span className="ml-auto rounded-full bg-accent/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent">
            PR
          </span>
        )}
      </div>
      <p className="djp-eyebrow mt-2 text-muted-foreground">{label}</p>
      {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
    </div>
  )
}
