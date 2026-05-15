// lib/agents/outcome-scoring.ts
// Pure function for computing memo impact_score. Used by SEO, Ads, and Social
// outcome trackers when flipping a memo's outcome_status to 'measured'.

export interface ImpactScoreInput {
  delta: number
  predicted_direction: "increase" | "decrease"
  baseline_p95: number
  baseline_n_measured: number
}

const WARM_UP_THRESHOLD = 5

export function computeImpactScore(input: ImpactScoreInput): number {
  const { delta, predicted_direction, baseline_p95, baseline_n_measured } =
    input

  if (delta === 0) return 0

  const movedAsPredicted =
    predicted_direction === "increase" ? delta > 0 : delta < 0
  const sign = movedAsPredicted ? 1 : -1

  // Warm-up: not enough data for a stable baseline.
  if (baseline_n_measured < WARM_UP_THRESHOLD) {
    return sign * 50
  }

  // Stable baseline: normalize.
  if (baseline_p95 === 0) return 0
  const magnitude = Math.abs(delta) / baseline_p95
  const score = Math.round(sign * magnitude * 100)
  return Math.max(-100, Math.min(100, score))
}
