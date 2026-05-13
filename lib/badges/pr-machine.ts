import type { BadgeRule } from "./types"

export const prMachine: BadgeRule = (input) => {
  const since = new Date(input.asOf + "T00:00:00Z")
  since.setUTCDate(since.getUTCDate() - 30)
  const sinceStr = since.toISOString().slice(0, 10)
  const recentPrs = input.tests.filter((t) => t.is_pr && t.test_date >= sinceStr)
  if (recentPrs.length < 3) return null
  return {
    id: "pr_machine",
    name: "PR Machine",
    description: `${recentPrs.length} PRs in the last 30 days`,
    icon: "Trophy",
    tier: recentPrs.length >= 6 ? "gold" : recentPrs.length >= 4 ? "silver" : "bronze",
  }
}
