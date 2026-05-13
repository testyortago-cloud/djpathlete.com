import type { BadgeRule } from "./types"

export const consistent: BadgeRule = (input) => {
  if (input.monthlyCompliancePct === null) return null
  if (input.monthlyCompliancePct < 90) return null
  return {
    id: "consistent",
    name: "Consistent",
    description: `${input.monthlyCompliancePct}% program compliance last month`,
    icon: "CheckCircle2",
    tier: input.monthlyCompliancePct === 100 ? "gold" : "silver",
  }
}
