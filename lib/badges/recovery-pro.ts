import type { BadgeRule } from "./types"

export const recoveryPro: BadgeRule = (input) => {
  const since = new Date(input.asOf + "T00:00:00Z")
  since.setUTCDate(since.getUTCDate() - 13)
  const sinceStr = since.toISOString().slice(0, 10)
  const window = input.readiness.filter(
    (r) => r.date >= sinceStr && r.date <= input.asOf,
  )
  if (window.length < 14) return null
  if (!window.every((r) => r.readiness_score >= 80)) return null
  return {
    id: "recovery_pro",
    name: "Recovery Pro",
    description: "Readiness ≥ 80 for 14 consecutive days",
    icon: "Heart",
    tier: "silver",
  }
}
