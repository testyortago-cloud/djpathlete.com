// functions/src/run-job.ts
// HTTPS dispatcher that invokes any of the Phase 5 scheduled runners on
// demand. The admin UI hits this via /api/admin/automation/trigger; Bearer
// auth gates the endpoint. One function, one secret setup, one switch.

import type { Request, Response } from "express"

const VALID_JOB_NAMES = [
  "sync-platform-analytics",
  "send-weekly-content-report",
  "send-daily-pulse",
  "voice-drift-monitor",
  "performance-learning-loop",
] as const
type JobName = (typeof VALID_JOB_NAMES)[number]

export interface RunJobRequestBody {
  jobName: JobName
}

function isJobName(value: unknown): value is JobName {
  return typeof value === "string" && (VALID_JOB_NAMES as readonly string[]).includes(value)
}

export async function handleRunJob(req: Request, res: Response): Promise<void> {
  const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : ""
  const expectedToken = process.env.INTERNAL_CRON_TOKEN ?? ""
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: "Unauthorized" })
    return
  }

  const body = (req.body ?? {}) as Partial<RunJobRequestBody>
  if (!isJobName(body.jobName)) {
    res.status(400).json({ error: `Unknown jobName. Must be one of: ${VALID_JOB_NAMES.join(", ")}` })
    return
  }

  try {
    const result = await dispatchJob(body.jobName)
    res.status(200).json({ ok: true, jobName: body.jobName, result })
  } catch (err) {
    console.error(`[run-job] ${body.jobName} failed:`, err)
    res.status(500).json({
      error: (err as Error).message ?? "Unknown error",
      jobName: body.jobName,
    })
  }
}

export async function dispatchJob(jobName: JobName): Promise<unknown> {
  switch (jobName) {
    case "sync-platform-analytics": {
      const { runSyncPlatformAnalytics } = await import("./sync-platform-analytics.js")
      return runSyncPlatformAnalytics()
    }
    case "send-weekly-content-report": {
      const { runSendWeeklyContentReport } = await import("./send-weekly-content-report.js")
      return runSendWeeklyContentReport()
    }
    case "send-daily-pulse": {
      const { runSendDailyPulse } = await import("./send-daily-pulse.js")
      return runSendDailyPulse()
    }
    case "voice-drift-monitor": {
      const { runVoiceDriftMonitor } = await import("./voice-drift-monitor.js")
      return runVoiceDriftMonitor()
    }
    case "performance-learning-loop": {
      const { runPerformanceLearningLoop } = await import("./performance-learning-loop.js")
      return runPerformanceLearningLoop()
    }
  }
}
