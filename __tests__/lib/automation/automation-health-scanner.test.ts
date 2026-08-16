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

// ── A fix that shipped reopens the window ───────────────────────────────────
// runAgentStrategist was repaired and deployed on a Sunday morning; its next
// scheduled tick is Wednesday. Between those two the old alert is history, not
// news, and re-sending it at critical every morning is how an alert channel
// gets tuned out. fix_shipped_at restarts the clock — and a failed run after
// the fix alerts the same morning, so the restart cannot hide a bad fix.

const FIXED: ExpectedCron[] = [
  {
    name: "repairedCron",
    sla_hours: 192,
    reports_to_cron_runs: true,
    watch_from: hoursAgoISO(800), // the original outage, five weeks of it
    fix_shipped_at: hoursAgoISO(2), // deployed two hours ago
  },
]

const noSuccessYet: ScannerInput = {
  ai_jobs_failed_by_type_24h: {},
  ai_jobs_pending_over_1h: 0,
  last_success_per_cron: { repairedCron: null },
}

describe("scanAutomationHealth — a fix that has not had its first run", () => {
  it("stops re-reporting the old outage once the fix shipped", () => {
    const r = scanAutomationHealth(noSuccessYet, FIXED)
    expect(r.silent_crons).toEqual([])
    expect(r.alert_severity).toBe("none")
  })

  it("still alerts when the fix is older than the SLA and nothing ran", () => {
    // The window reopened, then closed again with no success: that is a fix
    // that did not take, and it must come back on its own.
    const stale: ExpectedCron[] = [{ ...FIXED[0], fix_shipped_at: hoursAgoISO(400) }]
    const r = scanAutomationHealth(noSuccessYet, stale)
    expect(r.silent_crons.find((c) => c.cron_name === "repairedCron")).toBeTruthy()
    expect(r.alert_severity).toBe("critical") // 400h > 2x 192h
  })

  it("alerts immediately when the repaired cron runs and fails", () => {
    // One hour after the fix, inside the reopened window. Waiting the window
    // out would buy nothing — the cron already answered, and it lost.
    const r = scanAutomationHealth(
      { ...noSuccessYet, last_failure_per_cron: { repairedCron: hoursAgoISO(1) } },
      FIXED,
    )
    const hit = r.silent_crons.find((c) => c.cron_name === "repairedCron")
    expect(hit).toBeTruthy()
    expect(hit!.severity).toBe("critical")
    expect(hit!.last_failure_at).toBeTruthy()
    expect(r.alert_summary).toContain("its last run failed")
  })

  it("ignores failures from before the anchor", () => {
    // Failures from the outage the fix addressed are not evidence about the
    // fix. Judging on them would make fix_shipped_at do nothing at all.
    const r = scanAutomationHealth(
      { ...noSuccessYet, last_failure_per_cron: { repairedCron: hoursAgoISO(700) } },
      FIXED,
    )
    expect(r.silent_crons).toEqual([])
  })

  it("does not consult failures for a cron that has succeeded since", () => {
    // A cron that succeeded is judged on staleness alone; an older failure is
    // just a run that got retried.
    const r = scanAutomationHealth(
      {
        ...noSuccessYet,
        last_success_per_cron: { repairedCron: hoursAgoISO(1) },
        last_failure_per_cron: { repairedCron: hoursAgoISO(1) },
      },
      FIXED,
    )
    expect(r.silent_crons).toEqual([])
    expect(r.alert_severity).toBe("none")
  })

  it("a failed first run alerts even for a cron with no fix on record", () => {
    // Not special to repairs: any instrumented cron whose only runs failed is
    // broken now, not at the end of its window.
    const brandNew: ExpectedCron[] = [
      {
        name: "newCron",
        sla_hours: 192,
        reports_to_cron_runs: true,
        watch_from: hoursAgoISO(10), // nowhere near its window
      },
    ]
    const r = scanAutomationHealth(
      {
        ai_jobs_failed_by_type_24h: {},
        ai_jobs_pending_over_1h: 0,
        last_success_per_cron: { newCron: null },
        last_failure_per_cron: { newCron: hoursAgoISO(1) },
      },
      brandNew,
    )
    expect(r.silent_crons.find((c) => c.cron_name === "newCron")?.severity).toBe("critical")
  })

  it("a cron switched off stays quiet even with a failure on record", () => {
    const gated: ExpectedCron[] = [{ ...FIXED[0], enabled_flag: "cron_repaired_enabled" }]
    const r = scanAutomationHealth(
      {
        ...noSuccessYet,
        last_failure_per_cron: { repairedCron: hoursAgoISO(1) },
        disabled_crons: ["repairedCron"],
      },
      gated,
    )
    expect(r.silent_crons).toEqual([])
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

  it("does not judge runAgentStrategist on the outage that was already fixed", () => {
    // The secrets fix deployed 2026-08-16 05:59 UTC and a forced run at 13:59
    // UTC wrote the first success row, so the anchor is no longer load-bearing
    // for this cron — it is judged on staleness now. Pinned anyway: the pair
    // (watch_from, fix_shipped_at) is the record of an outage and its repair,
    // and it is the worked example the field is documented against.
    const cron = EXPECTED_CRONS.find((c) => c.name === "runAgentStrategist")!
    expect(cron.fix_shipped_at).toBe("2026-08-16")
    expect(new Date(cron.fix_shipped_at!).getTime()).toBeGreaterThan(
      new Date(cron.watch_from!).getTime(),
    )
  })

  it("never marks a cron as reporting unless it is one we instrumented", () => {
    // autoBlogCron and friends run fine but never call logCronStart.
    const cron = EXPECTED_CRONS.find((c) => c.name === "autoBlogCron")
    expect(cron!.reports_to_cron_runs).toBeUndefined()
  })
})
