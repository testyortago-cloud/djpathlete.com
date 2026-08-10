import { BAND_DEVELOPING_MIN, BAND_LABELS, BAND_STRENGTH_MIN, bandFor } from "@/lib/test-report/scoring"

/**
 * The ONLY way a score is drawn in this report.
 *
 * The scale is not decoration — it is the definition. `normalize()` maps a result
 * linearly from the bottom of its reference range to the top, so the left edge is
 * the range floor, the midpoint tick is Trained, and the right edge is Elite.
 * The zones are the band cut-points made visible — red below the developing
 * threshold, green from the strength threshold up — imported from the same
 * constants `bandFor()` judges with, so the picture and the pill cannot disagree.
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
      aria-label={
        Number.isFinite(score)
          ? `Scores ${pct} out of 100 — ${BAND_LABELS[bandFor(pct)]}. Trained is 50, Elite is 100.`
          : `Scores 0 out of 100. Trained is 50, Elite is 100.`
      }
    >
      <span className="score-track-zone-low" style={{ width: `${BAND_DEVELOPING_MIN}%` }} aria-hidden />
      <span className="score-track-zone-high" style={{ left: `${BAND_STRENGTH_MIN}%` }} aria-hidden />
      <span className="score-track-tick" aria-hidden />
      <span className="score-track-dot" style={{ left: `${pct}%` }} />
    </div>
  )
}
