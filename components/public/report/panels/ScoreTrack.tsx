/**
 * The ONLY way a score is drawn in this report.
 *
 * The scale is not decoration — it is the definition. `normalize()` maps a result
 * linearly from the bottom of its reference range to the top, so the left edge is
 * the range floor, the midpoint tick is Trained, and the right edge is Elite.
 * Drawing that scale is how the report answers "where do these numbers come from"
 * without a paragraph of explanation.
 *
 * Replaces KpiTile, ScoreBar, RangeBar, MetricCompare and CategoryChips, which
 * between them drew the same quantity five different ways.
 */
export function ScoreTrack({ score, tone = "primary" }: { score: number; tone?: "primary" | "accent" }) {
  const pct = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0
  return (
    <div
      className="score-track"
      data-tone={tone}
      role="img"
      aria-label={`Scores ${pct} out of 100. Trained is 50, Elite is 100.`}
    >
      <div className="score-track-fill" style={{ width: `${pct}%` }} />
      <span className="score-track-tick" aria-hidden />
      <span className="score-track-dot" style={{ left: `${pct}%` }} />
    </div>
  )
}
