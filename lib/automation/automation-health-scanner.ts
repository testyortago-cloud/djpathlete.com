// Pure scanner: turns ai_jobs status counts + per-cron last-success
// timestamps into a single { silent_crons, alert_severity, alert_summary }
// snapshot. Used by the daily automationHealthCron.

export interface ExpectedCron {
  name: string
  sla_hours: number // expected max gap between successful runs
  /**
   * True when the cron writes its own cron_runs rows (calls logCronStart).
   * Only these can be judged on "never succeeded even once" — most watched
   * crons run perfectly well but never log, so for them an absent success row
   * carries no information and must not raise an alert.
   */
  reports_to_cron_runs?: boolean
  /**
   * ISO date the cron's logging shipped. The "never succeeded" clock starts
   * here rather than at the beginning of the cron_runs ledger, so a cron
   * instrumented last week isn't judged against a window that opened months
   * ago. Required whenever reports_to_cron_runs is set.
   */
  watch_from?: string
  /**
   * system_settings key gating the cron, when it has one. A cron switched off
   * is dormant by choice, not silent, so it is never alerted on.
   */
  enabled_flag?: string
  /**
   * What the gate resolves to when the settings row is absent. Mirrors the
   * owning route's own `defaultEnabled`, so a deleted row can't quietly flip
   * a cron between "watched" and "ignored" behind the scanner's back.
   */
  enabled_flag_default?: boolean
}

/**
 * The crons we actively watch. Times in hours of expected max gap between
 * successful runs (rounded up generously to absorb the cron's own jitter).
 * Add/remove rows here when new crons are deployed.
 */
export const EXPECTED_CRONS: ExpectedCron[] = [
  // — Crons that do NOT write cron_runs. They are watched only for a stale
  //   last-success; absence of any success row says nothing about them.
  { name: "autoBlogCron", sla_hours: 96 },             // Tue + Thu
  { name: "syncPlatformAnalytics", sla_hours: 30 },    // daily 03:00
  { name: "chiefStrategistCron", sla_hours: 192 },     // weekly Sun
  { name: "seoAgentCron", sla_hours: 192 },            // weekly Sun
  { name: "performanceLearningLoop", sla_hours: 192 }, // weekly Mon
  { name: "voiceDriftMonitor", sla_hours: 192 },       // weekly Mon
  { name: "sendDailyPulse", sla_hours: 30 },           // weekday daily
  { name: "publishDuePostsCron", sla_hours: 1 },       // every 5 min
  { name: "socialAgentCron", sla_hours: 96 },          // Tue + Thu
  { name: "clientRiskScanCron", sla_hours: 30 },       // daily 05:00
  { name: "revenueDigestCron", sla_hours: 192 },       // weekly Mon
  { name: "packRenewalScanCron", sla_hours: 30 },      // daily 09:00
  // Watched even though it ships disabled: a funnel set to auto-close while
  // this never runs is the failure mode the detail screen warns about, and a
  // silent cron death is how it would become permanent.
  { name: "funnelWindowCron", sla_hours: 30 },          // daily 04:00

  // — Crons that call logCronStart. These are also judged on "never succeeded
  //   once", measured from watch_from (the date their logging shipped).
  {
    name: "syncGoogleAds", // daily 06:00
    sla_hours: 30,
    reports_to_cron_runs: true,
    watch_from: "2026-07-14",
  },
  {
    name: "runAgentStrategist", // weekly Wed 13:00
    sla_hours: 192,
    reports_to_cron_runs: true,
    watch_from: "2026-07-14",
  },
  {
    name: "auditLogRetentionCron", // daily 03:00
    sla_hours: 30,
    reports_to_cron_runs: true,
    watch_from: "2026-05-16",
    enabled_flag: "cron_audit_log_retention_enabled",
    enabled_flag_default: true, // unbounded growth is a cost risk — on by default
  },
  {
    name: "bookkeepingRetentionCron", // daily 04:00
    sla_hours: 30,
    reports_to_cron_runs: true,
    watch_from: "2026-07-18",
    enabled_flag: "cron_bookkeeping_retention_enabled",
  },
  {
    name: "bookkeepingQuarterlyPackCron", // quarterly Jan/Apr/Jul/Oct 1
    sla_hours: 2280,
    reports_to_cron_runs: true,
    watch_from: "2026-07-18",
    enabled_flag: "cron_bookkeeping_quarterly_pack_enabled",
  },
  {
    name: "bookkeepingReceiptWatchdogCron", // weekly Tue 07:00 (+ slack)
    sla_hours: 204,
    reports_to_cron_runs: true,
    watch_from: "2026-07-19",
    enabled_flag: "cron_bookkeeping_receipt_watchdog_enabled",
  },
  {
    name: "bookkeepingCloseNudgeCron", // monthly 3rd 13:00 (31d + slack)
    sla_hours: 800,
    reports_to_cron_runs: true,
    watch_from: "2026-08-03",
    enabled_flag: "cron_bookkeeping_close_nudge_enabled",
  },
  {
    name: "bookkeepingIncomeSyncCron", // daily 04:30
    sla_hours: 30,
    reports_to_cron_runs: true,
    watch_from: "2026-07-24",
    enabled_flag: "cron_bookkeeping_income_sync_enabled",
  },
  {
    // hourly :20 — delay-tolerant, a Gmail blip must not page (C-2)
    name: "bookkeepingGmailReceiptsCron",
    sla_hours: 6,
    reports_to_cron_runs: true,
    watch_from: "2026-07-25",
    enabled_flag: "cron_bookkeeping_gmail_receipts_enabled",
  },
  {
    name: "bookkeepingPayoutSyncCron", // daily 05:15
    sla_hours: 30,
    reports_to_cron_runs: true,
    watch_from: "2026-07-25",
    enabled_flag: "cron_bookkeeping_payout_sync_enabled",
  },
  {
    name: "reapStaleAiJobsCron", // every 15 min
    sla_hours: 1,
    reports_to_cron_runs: true,
    watch_from: "2026-07-20",
  },
]

export interface ScannerInput {
  /** Per-type failure counts in last 24h. Keys are ai_jobs.type values. */
  ai_jobs_failed_by_type_24h: Record<string, number>
  /** Total pending jobs older than 1h. */
  ai_jobs_pending_over_1h: number
  /** Latest successful run for each watched cron. null = never recorded yet. */
  last_success_per_cron: Record<string, string | null>
  /**
   * Names whose enabled_flag is currently off. These are skipped entirely —
   * a cron the operator switched off is dormant, not broken.
   */
  disabled_crons?: string[]
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

/**
 * A cron that has never recorded a success is either brand new or completely
 * broken, and the two are only distinguishable with an anchor. We alert when
 * the cron reports to cron_runs, is switched on, and its own logging shipped
 * longer ago than its SLA — i.e. it has had at least one chance to succeed and
 * took none of them.
 *
 * runAgentStrategist is why this exists: it threw on its first statement, so
 * the crash preceded logCronStart and no row was ever written. Skipping every
 * null made the single worst failure mode the one the watchdog could not see.
 */
function judgeNeverSucceeded(
  cron: ExpectedCron,
  now: number,
  disabled: Set<string>,
): SilentCron | null {
  if (!cron.reports_to_cron_runs) return null // silence proves nothing here
  if (disabled.has(cron.name)) return null // off on purpose
  if (!cron.watch_from) return null // no anchor — stay quiet rather than guess

  const watchedFor = (now - new Date(cron.watch_from).getTime()) / 3600_000
  if (!Number.isFinite(watchedFor) || watchedFor <= cron.sla_hours) return null

  return {
    cron_name: cron.name,
    last_success_at: null,
    hours_since: watchedFor,
    sla_hours: cron.sla_hours,
    severity: watchedFor > cron.sla_hours * 2 ? "critical" : "warning",
  }
}

export function scanAutomationHealth(
  input: ScannerInput,
  crons: ExpectedCron[] = EXPECTED_CRONS,
): ScannerOutput {
  const now = Date.now()
  const silent_crons: SilentCron[] = []
  const disabled = new Set(input.disabled_crons ?? [])

  for (const cron of crons) {
    const { name, sla_hours } = cron
    if (disabled.has(name)) continue

    const last = input.last_success_per_cron[name]
    if (!last) {
      const verdict = judgeNeverSucceeded(cron, now, disabled)
      if (verdict) silent_crons.push(verdict)
      continue
    }

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
    // "silent 780h" reads as "it used to work" — for a cron that has never
    // once succeeded, say so, because the fix is usually deployment-side.
    reasons.push(
      sc.last_success_at === null
        ? `${sc.cron_name} has never succeeded in ${Math.round(sc.hours_since)}h of watching (SLA ${sc.sla_hours}h)`
        : `${sc.cron_name} silent ${Math.round(sc.hours_since)}h (SLA ${sc.sla_hours}h)`,
    )
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
