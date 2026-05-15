// Pure function: maps a client's raw engagement signals to a 0-100 risk score
// plus a tier label and the list of reason codes that contributed. Used by the
// daily clientRiskScanCron and the /admin/insights/client-risk page. Kept
// dependency-free (no DB / no network) so it is trivially unit-tested.

export interface RiskInput {
  /** Days since MAX(training_sessions.date) for this client. 999 if never. */
  days_since_last_session: number
  /** actual_sessions_14d / expected_14d × 100. null if expected unknown. */
  session_frequency_pct_14d: number | null
  /** Days since oldest pending form_reviews.created_at. null if none open. */
  open_form_review_days: number | null
  /** Days since oldest non-completed performance_assessments.updated_at. */
  open_performance_assessment_days: number | null
  /** program_assignments.end_date - today, in days. Null if no active program. */
  program_ending_in_days: number | null
  /** ISO timestamp of the most recent coach renewal conversation, or null. */
  last_renewal_conversation_at: string | null
}

export interface RiskOutput {
  risk_score: number
  risk_tier: "none" | "low" | "medium" | "high"
  reasons: string[]
}

const RENEWAL_LOOKBACK_DAYS = 30
const PROGRAM_END_WINDOW_DAYS = 14

export function scoreClientRisk(input: RiskInput): RiskOutput {
  const reasons: string[] = []
  let score = 0

  // 1) Inactivity bucket — only the highest applies.
  if (input.days_since_last_session >= 30) {
    score += 40
    reasons.push("no_session_30d")
  } else if (input.days_since_last_session >= 14) {
    score += 25
    reasons.push("no_session_14d")
  } else if (input.days_since_last_session >= 7) {
    score += 15
    reasons.push("no_session_7d")
  }

  // 2) Session-frequency bucket — only the highest applies.
  const freq = input.session_frequency_pct_14d
  if (freq !== null) {
    if (freq < 25) {
      score += 35
      reasons.push("frequency_lt_25")
    } else if (freq < 50) {
      score += 20
      reasons.push("frequency_lt_50")
    }
  }

  // 3) Open form review bucket — only the highest applies.
  const fr = input.open_form_review_days
  if (fr !== null) {
    if (fr >= 10) {
      score += 20
      reasons.push("form_review_stale_10d")
    } else if (fr >= 5) {
      score += 10
      reasons.push("form_review_stale_5d")
    }
  }

  // 4) Open performance assessment — single threshold.
  const pa = input.open_performance_assessment_days
  if (pa !== null && pa >= 10) {
    score += 10
    reasons.push("perf_assessment_stale_10d")
  }

  // 5) Renewal window — only when program ends soon AND no recent conversation.
  if (
    input.program_ending_in_days !== null &&
    input.program_ending_in_days <= PROGRAM_END_WINDOW_DAYS
  ) {
    const last = input.last_renewal_conversation_at
    const stale =
      last === null ||
      Date.now() - new Date(last).getTime() > RENEWAL_LOOKBACK_DAYS * 86400000
    if (stale) {
      score += 15
      reasons.push("renewal_unstarted")
    }
  }

  const finalScore = Math.min(score, 100)
  const tier: RiskOutput["risk_tier"] =
    finalScore >= 60
      ? "high"
      : finalScore >= 35
        ? "medium"
        : finalScore >= 15
          ? "low"
          : "none"

  return { risk_score: finalScore, risk_tier: tier, reasons }
}
