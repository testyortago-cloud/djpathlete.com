// Pure scanner: turns ai_jobs status counts + per-cron last-success
// timestamps into a single { silent_crons, alert_severity, alert_summary }
// snapshot. Used by the daily automationHealthCron.

export interface ExpectedCron {
  name: string
  sla_hours: number // expected max gap between successful runs
}

/**
 * The crons we actively watch. Times in hours of expected max gap between
 * successful runs (rounded up generously to absorb the cron's own jitter).
 * Add/remove rows here when new crons are deployed.
 */
export const EXPECTED_CRONS: ExpectedCron[] = [
  { name: "autoBlogCron", sla_hours: 96 },             // Tue + Thu
  { name: "syncPlatformAnalytics", sla_hours: 30 },    // daily 03:00
  { name: "syncGoogleAds", sla_hours: 30 },            // daily 06:00
  { name: "runAgentStrategist", sla_hours: 192 },      // weekly Wed 13:00
  { name: "chiefStrategistCron", sla_hours: 192 },     // weekly Sun
  { name: "seoAgentCron", sla_hours: 192 },            // weekly Sun
  { name: "performanceLearningLoop", sla_hours: 192 }, // weekly Mon
  { name: "voiceDriftMonitor", sla_hours: 192 },       // weekly Mon
  { name: "sendDailyPulse", sla_hours: 30 },           // weekday daily
  { name: "publishDuePostsCron", sla_hours: 1 },       // every 5 min
  { name: "socialAgentCron", sla_hours: 96 },          // Tue + Thu
  { name: "clientRiskScanCron", sla_hours: 30 },       // daily 05:00
  { name: "revenueDigestCron", sla_hours: 192 },       // weekly Mon
  { name: "auditLogRetentionCron", sla_hours: 30 },    // daily 03:00
  { name: "packRenewalScanCron", sla_hours: 30 },      // daily 09:00
  { name: "bookkeepingRetentionCron", sla_hours: 30 }, // daily 04:00
  { name: "bookkeepingQuarterlyPackCron", sla_hours: 2280 }, // quarterly Jan/Apr/Jul/Oct 1
]

export interface ScannerInput {
  /** Per-type failure counts in last 24h. Keys are ai_jobs.type values. */
  ai_jobs_failed_by_type_24h: Record<string, number>
  /** Total pending jobs older than 1h. */
  ai_jobs_pending_over_1h: number
  /** Latest successful run for each watched cron. null = never recorded yet. */
  last_success_per_cron: Record<string, string | null>
}

export interface SilentCron {
  cron_name: string
  last_success_at: string | null
  hours_since: number
  sla_hours: number
  severity: "warning" | "critical"
}

export interface ScannerOutput {
  silent_crons: SilentCron[]
  alert_severity: "none" | "warning" | "critical"
  alert_summary: string | null
}

export function scanAutomationHealth(input: ScannerInput): ScannerOutput {
  const now = Date.now()
  const silent_crons: SilentCron[] = []

  for (const { name, sla_hours } of EXPECTED_CRONS) {
    const last = input.last_success_per_cron[name]
    if (!last) continue // never run yet — don't false-alert
    const hours_since = (now - new Date(last).getTime()) / 3600_000
    if (hours_since <= sla_hours) continue
    silent_crons.push({
      cron_name: name,
      last_success_at: last,
      hours_since,
      sla_hours,
      severity: hours_since > sla_hours * 2 ? "critical" : "warning",
    })
  }

  // Severity escalation, highest wins.
  let severity: ScannerOutput["alert_severity"] = "none"
  const reasons: string[] = []

  // 1) ai_jobs pending
  if (input.ai_jobs_pending_over_1h > 10) {
    severity = "critical"
    reasons.push(`${input.ai_jobs_pending_over_1h} ai_jobs stuck >1h`)
  } else if (input.ai_jobs_pending_over_1h > 3) {
    severity = bumpSeverity(severity, "warning")
    reasons.push(`${input.ai_jobs_pending_over_1h} ai_jobs stuck >1h`)
  }

  // 2) ai_jobs failures by type
  let anyFailures = false
  for (const [type, count] of Object.entries(input.ai_jobs_failed_by_type_24h)) {
    if (count > 5) {
      severity = "critical"
      reasons.push(`${type} failed ${count}x in 24h`)
    } else if (count > 0) {
      anyFailures = true
    }
  }
  if (anyFailures && severity === "none") {
    severity = "warning"
    const list = Object.entries(input.ai_jobs_failed_by_type_24h)
      .filter(([, n]) => n > 0)
      .map(([t, n]) => `${t}=${n}`)
      .join(", ")
    reasons.push(`failures in 24h: ${list}`)
  }

  // 3) silent crons
  for (const sc of silent_crons) {
    severity = bumpSeverity(severity, sc.severity)
    reasons.push(`${sc.cron_name} silent ${Math.round(sc.hours_since)}h (SLA ${sc.sla_hours}h)`)
  }

  return {
    silent_crons,
    alert_severity: severity,
    alert_summary: reasons.length === 0 ? null : reasons.join("; "),
  }
}

function bumpSeverity(
  current: ScannerOutput["alert_severity"],
  candidate: ScannerOutput["alert_severity"],
): ScannerOutput["alert_severity"] {
  const order = { none: 0, warning: 1, critical: 2 }
  return order[candidate] > order[current] ? candidate : current
}
