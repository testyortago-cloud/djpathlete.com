import { describe, it, expect, vi, beforeEach } from "vitest"

const getGenerationLogsMock = vi.fn()
const listRecentVoiceDriftFlagsMock = vi.fn()

vi.mock("@/lib/db/ai-generation-log", () => ({
  getGenerationLogs: (...a: unknown[]) => getGenerationLogsMock(...a),
}))
vi.mock("@/lib/db/voice-drift-flags", () => ({
  listRecentVoiceDriftFlags: (...a: unknown[]) => listRecentVoiceDriftFlagsMock(...a),
}))

import { buildWeeklyOpsHealth } from "@/lib/analytics/sections/ops-health-weekly"

const range = { from: new Date("2026-04-30T00:00:00Z"), to: new Date("2026-05-07T00:00:00Z") }

describe("buildWeeklyOpsHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getGenerationLogsMock.mockResolvedValue([])
    listRecentVoiceDriftFlagsMock.mockResolvedValue([])
  })

  it("returns null when nothing exceptional", async () => {
    expect(await buildWeeklyOpsHealth({ range })).toBeNull()
  })

  it("flags failure rate >= 5% with >= 2 absolute failures", async () => {
    getGenerationLogsMock.mockResolvedValue([
      ...Array.from({ length: 18 }, (_, i) => ({ id: `s${i}`, status: "succeeded", created_at: new Date(range.from.getTime() + i * 60_000).toISOString() })),
      { id: "f1", status: "failed", created_at: new Date(range.from.getTime() + 60_000).toISOString() },
      { id: "f2", status: "failed", created_at: new Date(range.from.getTime() + 120_000).toISOString() },
    ])
    const result = await buildWeeklyOpsHealth({ range })
    expect(result!.generationFailureRatePct).toBe(10)
  })

  it("surfaces voice-drift count when > 0", async () => {
    listRecentVoiceDriftFlagsMock.mockResolvedValue([{ id: "v1" }, { id: "v2" }, { id: "v3" }])
    const result = await buildWeeklyOpsHealth({ range })
    expect(result!.voiceDriftFlagCount).toBe(3)
  })
})
