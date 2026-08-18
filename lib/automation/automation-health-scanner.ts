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
   * ISO date a deploy fixed the reason this cron could never succeed. The
   * "never succeeded" clock restarts here, because after a fix the useful
   * question is whether the FIXED cron works — and a weekly cron repaired on a
   * Sunday has had no chance to answer that before Wednesday. Without this the
   * watchdog re-reports the old outage every morning at critical, which is how
   * an alert channel gets ignored.
   *
   * This cannot hide a fix that did not work: a failed run recorded after the
   * anchor alerts immediately, without waiting the window out (see
   * judgeNeverSucceeded). Leave watch_from alone when setting this — the pair
   * records both that the outage happened and that it was addressed.
   */
  fix_shipped_at?: string
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
    // 89211738 declared the two Supabase secrets the function had been missing
    // since 2026-07-15, and CI deployed it 2026-08-16 05:59 UTC. A forced run
    // that afternoon returned HTTP 200 and wrote the first success row, so
    // this cron is judged on staleness again and the anchor below is now
    // belt-and-braces. Kept as the worked example of what the field is for:
    // the next weekly cron repaired on a Sunday needs it, or the watchdog
    // spends four mornings re-reporting an outage that is already fixed.
    fix_shipped_at: "2026-08-16",
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
  {
    // Lead Engine Stage 1b sequence tick — every 5 min, off by default.
    name: "sequenceTickCron",
    sla_hours: 1,
    reports_to_cron_runs: true,
    watch_from: "2026-08-18",
    enabled_flag: "cron_sequence_tick_enabled",
    enabled_flag_default: false,
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
   * Latest FAILED run per cron, where one is on record. Read only for crons
   * that have never succeeded: there, a failure row is proof the cron is
   * reachable and losing, which deserves an alert immediately rather than at
   * the end of a window that exists to spare crons which have had no chance.
   * A missing key or a null falls back to the window rule — a failed read must
   * not manufacture an alert, and cannot suppress one either.
   */
  last_failure_per_cron?: Record<string, string | null>
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
  /**
   * Set only when the cron has never succeeded and a failed run is on record.
   * It separates the two never-succeeded shapes: nothing in the ledger points
   * at deployment, a failure row points at the run itself.
   */
  last_failure_at?: string
}

export interface ScannerOutput {
  silent_crons: SilentCron[]
  alert_severity: "none" | "warning" | "critical"
  alert_summary: string | null
}

/**
 * A cron that has never recorded a success is either brand new or completely
 * broken, and the two are only distinguishable with an anchor. We alert when
 * the cron reports to cron_runs, is switched on, and its anchor — the date its
 * logging shipped, or the later date a fix shipped — is further back than its
 * SLA: it has had at least one chance to succeed and took none of them.
 *
 * A failed run recorded since the anchor short-circuits that wait. The window
 * exists to avoid judging a cron that has had no opportunity; a failure row is
 * an opportunity taken and lost, so there is nothing left to wait for.
 *
 * runAgentStrategist is why this exists: it threw on its first statement, so
 * the crash preceded logCronStart and no row was ever written. Skipping every
 * null made the single worst failure mode the one the watchdog could not see.
 */
function judgeNeverSucceeded(
  cron: ExpectedCron,
  now: number,
  disabled: Set<string>,
  lastFailureAt: string | null,
): SilentCron | null {
  if (!cron.reports_to_cron_runs) return null // silence proves nothing here
  if (disabled.has(cron.name)) return null // off on purpose
  if (!cron.watch_from) return null // no anchor — stay quiet rather than guess

  const anchor = watchAnchor(cron)
  if (anchor === null) return null
  const watchedFor = (now - anchor) / 3600_000
  if (!Number.isFinite(watchedFor)) return null

  // A failure recorded since the anchor settles the question the window was
  // only estimating: the cron ran and could not finish. Say so at once — a
  // cron with no success to its name and a failed attempt on the board is as
  // broken as it gets, and waiting out the rest of the window buys nothing.
  if (lastFailureAt !== null) {
    const failedAt = new Date(lastFailureAt).getTime()
    if (Number.isFinite(failedAt) && failedAt >= anchor) {
      return {
        cron_name: cron.name,
        last_success_at: null,
        last_failure_at: lastFailureAt,
        hours_since: watchedFor,
        sla_hours: cron.sla_hours,
        severity: "critical",
      }
    }
  }

  if (watchedFor <= cron.sla_hours) return null

  return {
    cron_name: cron.name,
    last_success_at: null,
    hours_since: watchedFor,
    sla_hours: cron.sla_hours,
    severity: watchedFor > cron.sla_hours * 2 ? "critical" : "warning",
  }
}

/**
 * When the never-succeeded clock starts: the later of the date logging shipped
 * and the date a fix shipped. An unparseable date yields null so the caller
 * stays quiet rather than judging against NaN.
 */
function watchAnchor(cron: ExpectedCron): number | null {
  if (!cron.watch_from) return null
  const from = new Date(cron.watch_from).getTime()
  if (!Number.isFinite(from)) return null
  if (!cron.fix_shipped_at) return from
  const fixed = new Date(cron.fix_shipped_at).getTime()
  return Number.isFinite(fixed) ? Math.max(from, fixed) : from
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
      const failure = input.last_failure_per_cron?.[name] ?? null
      const verdict = judgeNeverSucceeded(cron, now, disabled, failure)
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
    reasons.push(describeSilentCron(sc, now))
  }

  return {
    silent_crons,
    alert_severity: severity,
    alert_summary: reasons.length === 0 ? null : reasons.join("; "),
  }
}

/**
 * One line per offender. "silent 780h" reads as "it used to work", so a cron
 * that has never once succeeded says so instead — and when a failed run is on
 * record it says that too, because the two point at different repairs: nothing
 * in the ledger means the deploy never reached it, a failure means the run
 * itself is broken.
 */
function describeSilentCron(sc: SilentCron, now: number): string {
  if (sc.last_success_at !== null) {
    return `${sc.cron_name} silent ${Math.round(sc.hours_since)}h (SLA ${sc.sla_hours}h)`
  }
  if (sc.last_failure_at) {
    const since = Math.round((now - new Date(sc.last_failure_at).getTime()) / 3600_000)
    return `${sc.cron_name} has never succeeded — its last run failed ${since}h ago`
  }
  return `${sc.cron_name} has never succeeded in ${Math.round(sc.hours_since)}h of watching (SLA ${sc.sla_hours}h)`
}

function bumpSeverity(
  current: ScannerOutput["alert_severity"],
  candidate: ScannerOutput["alert_severity"],
): ScannerOutput["alert_severity"] {
  const order = { none: 0, warning: 1, critical: 2 }
  return order[candidate] > order[current] ? candidate : current
}
