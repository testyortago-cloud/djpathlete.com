import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { runPreflight } from "@/lib/ads/agent/signals"

describe("ads agent preflight", () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date("2026-05-13T12:00:00Z"))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("fails when most recent conversion is older than CONVERSION_FRESHNESS_HOURS", async () => {
    const result = await runPreflight({
      mostRecentConversionAt: new Date("2026-05-10T12:00:00Z"), // 72h ago
      ga4SyncedAt: new Date("2026-05-13T06:00:00Z"),
      gscSyncedAt: new Date("2026-05-13T06:00:00Z"),
      tokensValid: { googleAds: true, ga4: true, gsc: true },
      activeCampaignClicks7d: 200,
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => /conversion tracking.*stale/i.test(r))).toBe(true)
  })

  it("fails when no active campaign has ≥ MIN_RECENT_CLICKS clicks in last 7 days", async () => {
    const result = await runPreflight({
      mostRecentConversionAt: new Date("2026-05-13T06:00:00Z"),
      ga4SyncedAt: new Date("2026-05-13T06:00:00Z"),
      gscSyncedAt: new Date("2026-05-13T06:00:00Z"),
      tokensValid: { googleAds: true, ga4: true, gsc: true },
      activeCampaignClicks7d: 5,
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => /insufficient.*clicks/i.test(r))).toBe(true)
  })

  it("fails when any OAuth token is invalid", async () => {
    const result = await runPreflight({
      mostRecentConversionAt: new Date("2026-05-13T06:00:00Z"),
      ga4SyncedAt: new Date("2026-05-13T06:00:00Z"),
      gscSyncedAt: new Date("2026-05-13T06:00:00Z"),
      tokensValid: { googleAds: true, ga4: false, gsc: true },
      activeCampaignClicks7d: 200,
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => /ga4.*token/i.test(r))).toBe(true)
  })

  it("passes when all checks succeed", async () => {
    const result = await runPreflight({
      mostRecentConversionAt: new Date("2026-05-13T06:00:00Z"),
      ga4SyncedAt: new Date("2026-05-13T06:00:00Z"),
      gscSyncedAt: new Date("2026-05-13T06:00:00Z"),
      tokensValid: { googleAds: true, ga4: true, gsc: true },
      activeCampaignClicks7d: 200,
    })
    expect(result.ok).toBe(true)
    expect(result.reasons).toEqual([])
  })
})
