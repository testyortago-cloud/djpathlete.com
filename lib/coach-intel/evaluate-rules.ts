import type { RiskFlagType, RiskFlagSeverity, RiskFlagEvidence } from "@/types/database"
import { dailyLoads, acuteLoad, chronicLoad, acwr, type SessionInput } from "./load"
import { weeklyStats } from "./monotony"
import { weekOverWeek } from "./week-over-week"
import {
  ACWR_DANGER,
  READINESS_FATIGUE_THRESHOLD,
  FATIGUE_CONSECUTIVE_DAYS,
  WEEKLY_LOAD_SPIKE_PCT,
  MONOTONY_HIGH,
  RPE_CREEP_THRESHOLD,
  RPE_CREEP_CONSECUTIVE_SESSIONS,
} from "./thresholds"

export interface SessionWithRpe extends SessionInput {
  rpe: number
}

export interface ReadinessInput {
  date: string
  readiness_score: number
}

export interface ProposedFlag {
  flag_type: RiskFlagType
  severity: RiskFlagSeverity
  message: string
  evidence: RiskFlagEvidence
  triggered_at: string
}

export interface EvaluateInput {
  sessions: SessionWithRpe[]
  readiness: ReadinessInput[]
  asOf: string // YYYY-MM-DD
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function loadSpike(input: EvaluateInput): ProposedFlag | null {
  const from = addDays(input.asOf, -28)
  const daily = dailyLoads(input.sessions, from, input.asOf)
  const ratio = acwr(daily, input.asOf)
  if (ratio === null || ratio <= ACWR_DANGER) return null
  return {
    flag_type: "load_spike",
    severity: "high",
    message: `ACWR ${ratio.toFixed(2)} — high load spike (target ≤ ${ACWR_DANGER})`,
    evidence: {
      asOf: input.asOf,
      acwr: Number(ratio.toFixed(2)),
      acuteLoad: Math.round(acuteLoad(daily, input.asOf)),
      chronicLoad: Math.round(chronicLoad(daily, input.asOf)),
    },
    triggered_at: input.asOf,
  }
}

function fatigue(input: EvaluateInput): ProposedFlag | null {
  const need = FATIGUE_CONSECUTIVE_DAYS
  const recent = [...input.readiness]
    .filter((r) => r.date <= input.asOf)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, need)
  if (recent.length < need) return null
  if (!recent.every((r) => r.readiness_score < READINESS_FATIGUE_THRESHOLD)) return null
  return {
    flag_type: "fatigue",
    severity: "medium",
    message: `Readiness < ${READINESS_FATIGUE_THRESHOLD} for ${need} consecutive days`,
    evidence: { asOf: input.asOf, recentReadinessScores: recent },
    triggered_at: input.asOf,
  }
}

function overtraining(input: EvaluateInput): ProposedFlag | null {
  const currentWeekStart = addDays(input.asOf, -6)
  const from = addDays(currentWeekStart, -7)
  const daily = dailyLoads(input.sessions, from, input.asOf)
  const wow = weekOverWeek(daily, currentWeekStart)
  if (wow.deltaPct === null || wow.deltaPct <= WEEKLY_LOAD_SPIKE_PCT) return null
  return {
    flag_type: "overtraining",
    severity: "high",
    message: `Weekly load up ${wow.deltaPct.toFixed(0)}% vs prior week`,
    evidence: {
      asOf: input.asOf,
      weeklyLoad: wow.current.totalLoad,
      prevWeeklyLoad: wow.previous.totalLoad,
      deltaPct: Number(wow.deltaPct.toFixed(2)),
    },
    triggered_at: input.asOf,
  }
}

function highStrain(input: EvaluateInput): ProposedFlag | null {
  const currentWeekStart = addDays(input.asOf, -6)
  const daily = dailyLoads(input.sessions, currentWeekStart, input.asOf)
  const w = weeklyStats(daily, currentWeekStart)
  if (w.monotony === null || w.monotony <= MONOTONY_HIGH) return null
  return {
    flag_type: "high_strain",
    severity: "medium",
    message: `Weekly monotony ${w.monotony.toFixed(2)} (target ≤ ${MONOTONY_HIGH})`,
    evidence: {
      asOf: input.asOf,
      monotony: Number(w.monotony.toFixed(2)),
      strain: w.strain !== null ? Math.round(w.strain) : undefined,
      weeklyLoad: w.totalLoad,
    },
    triggered_at: input.asOf,
  }
}

function rpeCreep(input: EvaluateInput): ProposedFlag | null {
  const need = RPE_CREEP_CONSECUTIVE_SESSIONS
  const recent = [...input.sessions]
    .filter((s) => s.date <= input.asOf)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, need)
  if (recent.length < need) return null
  if (!recent.every((s) => s.rpe > RPE_CREEP_THRESHOLD)) return null
  return {
    flag_type: "rpe_creep",
    severity: "low",
    message: `Last ${need} sessions all RPE > ${RPE_CREEP_THRESHOLD}`,
    evidence: {
      asOf: input.asOf,
      recentRpes: recent.map((r) => ({ date: r.date, rpe: r.rpe })),
    },
    triggered_at: input.asOf,
  }
}

const RULES = [loadSpike, fatigue, overtraining, highStrain, rpeCreep] as const

export function evaluateRules(input: EvaluateInput): ProposedFlag[] {
  return RULES.map((r) => r(input)).filter((f): f is ProposedFlag => f !== null)
}
