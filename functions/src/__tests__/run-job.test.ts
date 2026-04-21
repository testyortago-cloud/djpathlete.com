import { describe, it, expect, vi, beforeEach } from "vitest"
import { handleRunJob } from "../run-job.js"

type ResCaptures = {
  status: number
  body: unknown
}

function makeRes(): {
  res: {
    status: (code: number) => ReturnType<typeof makeRes>["res"]
    json: (body: unknown) => void
  }
  captures: ResCaptures
} {
  const captures: ResCaptures = { status: 0, body: null }
  const res = {
    status(code: number) {
      captures.status = code
      return res
    },
    json(body: unknown) {
      captures.body = body
    },
  }
  return { res, captures }
}

function makeReq(body: unknown, authHeader?: string) {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
    body,
  }
}

vi.mock("../sync-platform-analytics.js", () => ({
  runSyncPlatformAnalytics: vi.fn().mockResolvedValue({ synced: 3, skipped: 0, failed: 0 }),
}))
vi.mock("../send-weekly-content-report.js", () => ({
  runSendWeeklyContentReport: vi
    .fn()
    .mockResolvedValue({ ok: true, sentTo: "x@y.com", subject: "s", rangeStart: "", rangeEnd: "" }),
}))
vi.mock("../send-daily-pulse.js", () => ({
  runSendDailyPulse: vi.fn().mockResolvedValue({ ok: true, sentTo: "x@y.com", subject: "s", isMondayEdition: false }),
}))
vi.mock("../voice-drift-monitor.js", () => ({
  runVoiceDriftMonitor: vi.fn().mockResolvedValue({ scanned: 0, flagged: 0, skippedNoVoiceProfile: false, errors: 0 }),
}))
vi.mock("../performance-learning-loop.js", () => ({
  runPerformanceLearningLoop: vi.fn().mockResolvedValue({
    platformsUpdated: [],
    platformsSkippedEmpty: [],
    totalExamplesWritten: 0,
    errors: 0,
  }),
}))

const TOKEN = "tok"

describe("handleRunJob", () => {
  beforeEach(() => {
    process.env.INTERNAL_CRON_TOKEN = TOKEN
  })

  it("returns 401 without a bearer token", async () => {
    const { res, captures } = makeRes()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleRunJob(makeReq({ jobName: "sync-platform-analytics" }) as any, res as any)
    expect(captures.status).toBe(401)
  })

  it("returns 401 with a wrong bearer token", async () => {
    const { res, captures } = makeRes()
    await handleRunJob(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeReq({ jobName: "sync-platform-analytics" }, "Bearer wrong") as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res as any,
    )
    expect(captures.status).toBe(401)
  })

  it("returns 400 when jobName is missing or unknown", async () => {
    const { res, captures } = makeRes()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleRunJob(makeReq({ jobName: "nope" }, `Bearer ${TOKEN}`) as any, res as any)
    expect(captures.status).toBe(400)
  })

  it("dispatches sync-platform-analytics on happy path", async () => {
    const { res, captures } = makeRes()
    await handleRunJob(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeReq({ jobName: "sync-platform-analytics" }, `Bearer ${TOKEN}`) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res as any,
    )
    expect(captures.status).toBe(200)
    const body = captures.body as { jobName: string; result: { synced: number } }
    expect(body.jobName).toBe("sync-platform-analytics")
    expect(body.result.synced).toBe(3)
  })

  it("dispatches each of the 5 job names", async () => {
    const names = ["send-weekly-content-report", "send-daily-pulse", "voice-drift-monitor", "performance-learning-loop"]
    for (const jobName of names) {
      const { res, captures } = makeRes()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await handleRunJob(makeReq({ jobName }, `Bearer ${TOKEN}`) as any, res as any)
      expect(captures.status).toBe(200)
    }
  })
})
