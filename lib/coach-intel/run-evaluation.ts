import { listByUser as listTrainingSessions } from "@/lib/db/training-sessions"
import { listByUser as listReadiness } from "@/lib/db/daily-readiness"
import { createIfNew, closeStaleByType } from "@/lib/db/risk-flags"
import { evaluateRules } from "./evaluate-rules"
import type { RiskFlag, RiskFlagType } from "@/types/database"

const ALL_FLAG_TYPES: RiskFlagType[] = ["load_spike", "fatigue", "overtraining", "high_strain", "rpe_creep"]

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export interface RunEvaluationResult {
  created: RiskFlag[]
  closedTypes: RiskFlagType[]
}

export async function runEvaluation(clientUserId: string, asOf: string): Promise<RunEvaluationResult> {
  const from = addDays(asOf, -35)

  const [sessions, readiness] = await Promise.all([
    listTrainingSessions(clientUserId, { from, to: asOf }),
    listReadiness(clientUserId, { from, to: asOf }),
  ])

  const proposed = evaluateRules({
    sessions: sessions.map((s) => ({
      date: s.date,
      rpe: s.rpe,
      duration_min: s.duration_min,
      session_load: s.session_load,
    })),
    readiness: readiness.map((r) => ({
      date: r.date,
      readiness_score: r.readiness_score,
    })),
    asOf,
  })

  const created: RiskFlag[] = []
  for (const p of proposed) {
    const c = await createIfNew(clientUserId, p)
    if (c) created.push(c)
  }

  const firedTypes = new Set(proposed.map((p) => p.flag_type))
  const closedTypes: RiskFlagType[] = []
  for (const t of ALL_FLAG_TYPES) {
    if (!firedTypes.has(t)) {
      await closeStaleByType(clientUserId, t)
      closedTypes.push(t)
    }
  }

  return { created, closedTypes }
}
