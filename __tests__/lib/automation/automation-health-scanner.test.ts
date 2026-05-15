import { describe, expect, it } from "vitest"
import {
  scanAutomationHealth,
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
