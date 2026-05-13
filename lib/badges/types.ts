import type { Badge, PerformanceTest, DailyReadiness } from "@/types/database"
import type { DailyLoad } from "@/lib/coach-intel/load"

export interface BadgeInput {
  asOf: string
  dailyLoads: DailyLoad[]
  tests: PerformanceTest[]
  readiness: DailyReadiness[]
  monthlyCompliancePct: number | null
}

export type BadgeRule = (input: BadgeInput) => Badge | null

export type { Badge }
