/** Horizontal category bar — the reference's "where time is won or lost" row. */
export function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 font-mono text-xs uppercase text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
        <div
          data-testid="score-fill"
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right font-heading text-sm font-bold">{score}</span>
    </div>
  )
}
