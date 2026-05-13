import type { BadgeRule } from "./types"
import { currentStreak } from "@/lib/coach-intel/streak"

export const ironStreak: BadgeRule = (input) => {
  const streak = currentStreak(input.dailyLoads, input.asOf)
  if (streak < 30) return null
  const tier = streak >= 100 ? "gold" : streak >= 60 ? "silver" : "bronze"
  return {
    id: "iron_streak",
    name: "Iron Streak",
    description: `${streak} consecutive training days`,
    icon: "Flame",
    tier,
  }
}
