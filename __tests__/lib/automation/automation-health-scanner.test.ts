import { describe, expect, it } from "vitest"
import {
  scanAutomationHealth,
  type ExpectedCron,
  type ScannerInput,
  EXPECTED_CRONS,
} from "@/lib/automation/automation-health-scanner"

const base: ScannerInput = {
  ai_jobs_failed_by_type_24h: {},
  ai_jobs_pending_over_1h: 0,
  last_success_per_cron: Object.fromEntries(
    EXPECTED_CRONS.map((c) => [c.name, new Date().toISOString()]),
  ),
}

describe("scanAutomationHealth", () => {
  it("returns none severity when everything is fresh", () => {
    const r = scanAutomationHealth(base)
    expect(r.alert_severity).toBe("none")
    expect(r.silent_crons).toEqual([])
  })

  it("flags warning when one cron is silent past its window but < 2x", () => {
    const cron = EXPECTED_CRONS[0]
    const staleHours = cron.sla_hours + 1
    const r = scanAutomationHealth({
      ...base,
      last_success_per_cron: {
        ...base.last_success_per_cron,
        [cron.name]: new Date(Date.now() - staleHours * 3600_000).toISOString(),
      },
    })
    expect(r.alert_severity).toBe("warning")
    expect(r.silent_crons.find((c) => c.cron_name === cron.name)).toBeTruthy()
  })

  it("escalates to critical when a cron is silent past 2x its window", () => {
    const cron = EXPECTED_CRONS[0]
    const veryStale = cron.sla_hours * 2 + 1
    const r = scanAutomationHealth({
      ...base,
      last_success_per_cron: {
        ...base.last_success_per_cron,
        [cron.name]: new Date(Date.now() - veryStale * 3600_000).toISOString(),
      },
    })
    expect(r.alert_severity).toBe("critical")
  })

  it("flags critical when ai_jobs pending > 10", () => {
    const r = scanAutomationHealth({ ...base, ai_jobs_pending_over_1h: 11 })
    expect(r.alert_severity).toBe("critical")
  })

  it("flags warning when ai_jobs pending > 3 but <= 10", () => {
    const r = scanAutomationHealth({ ...base, ai_jobs_pending_over_1h: 5 })
    expect(r.alert_severity).toBe("warning")
  })

  it("flags critical when one type has > 5 failures in 24h", () => {
    const r = scanAutomationHealth({
      ...base,
      ai_jobs_failed_by_type_24h: { blog_generation: 6 },
    })
    expect(r.alert_severity).toBe("critical")
  })

  it("flags warning when any failures exist but no type hits 6", () => {
    const r = scanAutomationHealth({
      ...base,
      ai_jobs_failed_by_type_24h: { social_agent_run: 2, blog_image_generation: 3 },
    })
    expect(r.alert_severity).toBe("warning")
  })

  it("crons with null last_success are treated as never-run, not silent", () => {
    // A cron we just deployed hasn't logged a run yet. Don't false-alert.
    const r = scanAutomationHealth({
      ...base,
      last_success_per_cron: {
        ...base.last_success_per_cron,
        [EXPECTED_CRONS[0].name]: null,
      },
    })
    expect(r.alert_severity).toBe("none")
    expect(r.silent_crons.find((c) => c.cron_name === EXPECTED_CRONS[0].name)).toBeFalsy()
  })

  it("alert_summary lists the worst offenders", () => {
    const cron = EXPECTED_CRONS[0]
    const veryStale = cron.sla_hours * 2 + 5
    const r = scanAutomationHealth({
      ai_jobs_failed_by_type_24h: { blog_generation: 7 },
      ai_jobs_pending_over_1h: 12,
      last_success_per_cron: {
        ...base.last_success_per_cron,
        [cron.name]: new Date(Date.now() - veryStale * 3600_000).toISOString(),
      },
    })
    expect(r.alert_summary).toBeTruthy()
    expect(r.alert_summary).toContain("12")
    expect(r.alert_summary).toContain("blog_generation")
    expect(r.alert_summary).toContain(cron.name)
  })

})

// ── Never-succeeded crons ───────────────────────────────────────────────────
// runAgentStrategist crashed on its first statement every Wednesday from
// 2026-07-15 for five weeks. Because the crash preceded logCronStart, it never
// wrote a cron_runs row at all — and the blanket `if (!last) continue` above
// meant the watchdog skipped it forever. A cron that has NEVER succeeded is
// the most broken state there is; it must not be the one state we ignore.
//
// The guards that keep this from becoming noise: only crons that actually
// write cron_runs are judged (most don't), only while their flag is on, and
// only measured from the date their logging shipped.

const HOUR = 3600_000
const hoursAgoISO = (h: number) => new Date(Date.now() - h * HOUR).toISOString()

/** Minimal synthetic list so these cases don't drift with the real roster. */
const CRONS: ExpectedCron[] = [
  {
    name: "instrumentedCron",
    sla_hours: 24,
    reports_to_cron_runs: true,
    watch_from: hoursAgoISO(500),
  },
  { name: "quietCron", sla_hours: 24 }, // runs fine, just never logs
  {
    name: "gatedCron",
    sla_hours: 24,
    reports_to_cron_runs: true,
    watch_from: hoursAgoISO(500),
    enabled_flag: "cron_gated_enabled",
  },
  {
    name: "freshlyInstrumentedCron",
    sla_hours: 192,
    reports_to_cron_runs: true,
    watch_from: hoursAgoISO(10),
  },
]

const neverAny: ScannerInput = {
  ai_jobs_failed_by_type_24h: {},
  ai_jobs_pending_over_1h: 0,
  last_success_per_cron: Object.fromEntries(CRONS.map((c) => [c.name, null])),
}

describe("scanAutomationHealth — crons that have never succeeded", () => {
  it("flags an instrumented cron that has never succeeded past its SLA", () => {
    const r = scanAutomationHealth(neverAny, CRONS)
    const hit = r.silent_crons.find((c) => c.cron_name === "instrumentedCron")

    expect(hit).toBeTruthy()
    expect(hit!.last_success_at).toBeNull()
    // 500h against a 24h SLA is far past 2x — the worst tier.
    expect(hit!.severity).toBe("critical")
    expect(r.alert_severity).toBe("critical")
  })

  it("says 'never succeeded' rather than reporting a bogus silent-since gap", () => {
    const r = scanAutomationHealth(neverAny, CRONS)
    expect(r.alert_summary).toContain("instrumentedCron")
    expect(r.alert_summary).toContain("never succeeded")
  })

  it("ignores crons that do not write cron_runs at all", () => {
    // quietCron has no reports_to_cron_runs: a missing success row tells us
    // nothing about it, so silence must stay silent.
    const r = scanAutomationHealth(neverAny, CRONS)
    expect(r.silent_crons.find((c) => c.cron_name === "quietCron")).toBeFalsy()
  })

  it("ignores a cron whose feature flag is switched off", () => {
    // Dormant by choice is not the same as broken.
    const r = scanAutomationHealth({ ...neverAny, disabled_crons: ["gatedCron"] }, CRONS)
    expect(r.silent_crons.find((c) => c.cron_name === "gatedCron")).toBeFalsy()
  })

  it("flags that same gated cron once its flag is switched back on", () => {
    const r = scanAutomationHealth(neverAny, CRONS)
    expect(r.silent_crons.find((c) => c.cron_name === "gatedCron")).toBeTruthy()
  })

  it("gives a newly instrumented cron until its SLA before complaining", () => {
    // watch_from is 10h ago against a 192h SLA — it simply hasn't been due yet.
    const r = scanAutomationHealth(neverAny, CRONS)
    expect(r.silent_crons.find((c) => c.cron_name === "freshlyInstrumentedCron")).toBeFalsy()
  })

  it("measures from watch_from, not from the start of the cron_runs ledger", () => {
    const r = scanAutomationHealth(neverAny, CRONS)
    const hit = r.silent_crons.find((c) => c.cron_name === "instrumentedCron")
    expect(hit!.hours_since).toBeGreaterThan(499)
    expect(hit!.hours_since).toBeLessThan(501)
  })

  it("a cron with no watch_from anchor stays quiet", () => {
    const noAnchor: ExpectedCron[] = [
      { name: "anchorless", sla_hours: 1, reports_to_cron_runs: true },
    ]
    const r = scanAutomationHealth(
      { ...neverAny, last_success_per_cron: { anchorless: null } },
      noAnchor,
    )
    expect(r.silent_crons).toEqual([])
    expect(r.alert_severity).toBe("none")
  })
})

describe("EXPECTED_CRONS roster", () => {
  it("watches runAgentStrategist for a first success", () => {
    // Regression guard for the 2026-07-15 outage: this cron writes cron_runs,
    // so a total absence of success rows is meaningful and must be alertable.
    const cron = EXPECTED_CRONS.find((c) => c.name === "runAgentStrategist")
    expect(cron).toBeTruthy()
    expect(cron!.reports_to_cron_runs).toBe(true)
    expect(cron!.watch_from).toBeTruthy()
  })

  it("gives every cron-runs reporter a watch_from anchor", () => {
    const missing = EXPECTED_CRONS.filter((c) => c.reports_to_cron_runs && !c.watch_from)
    expect(missing.map((c) => c.name)).toEqual([])
  })

  it("never marks a cron as reporting unless it is one we instrumented", () => {
    // autoBlogCron and friends run fine but never call logCronStart.
    const cron = EXPECTED_CRONS.find((c) => c.name === "autoBlogCron")
    expect(cron!.reports_to_cron_runs).toBeUndefined()
  })
})
