import { describe, it, expect, vi } from "vitest"
import { gatherCriticInputs, criticPreflight } from "../strategy/critic-signals.js"

describe("gatherCriticInputs", () => {
  it("reads from all five expected tables", async () => {
    const calls: string[] = []
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        calls.push(table)
        // Chainable + awaitable: every method returns the same object,
        // which itself is thenable resolving to { data: [], error: null }.
        // This lets `.gte()` terminate the chain for tables that don't
        // call `.order()` (marketing_attribution, voice_drift_flags) and
        // also chain to `.order()` / `.limit()` for tables that do.
        const chain: Record<string, unknown> = {
          select: vi.fn(() => chain),
          gte: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
            resolve({ data: [], error: null }),
        }
        return chain
      }),
    }
    const inputs = await gatherCriticInputs(sb as never)
    expect(calls).toEqual(
      expect.arrayContaining([
        "seo_agent_memos",
        "google_ads_agent_memos",
        "social_agent_memos",
        "marketing_attribution",
        "cross_channel_signals",
        "voice_drift_flags",
      ]),
    )
    expect(inputs.seoMemos).toEqual([])
  })
})

describe("criticPreflight", () => {
  it("fails when fewer than 2 channels have memos", () => {
    const r = criticPreflight({
      weekOf: "2026-05-09",
      seoMemos: [{ id: "s1" }],
      adsMemos: [],
      socialMemos: [],
      attribution: {},
      funnel: { visits: 0, signups: 0, bookings: 0, payments: 0 },
      priorSignals: [],
      voiceFlags: [],
    })
    expect(r.ok).toBe(false)
  })

  it("passes when at least 2 channels have memos", () => {
    const r = criticPreflight({
      weekOf: "2026-05-09",
      seoMemos: [{ id: "s1" }],
      adsMemos: [{ id: "a1" }],
      socialMemos: [],
      attribution: {},
      funnel: { visits: 0, signups: 0, bookings: 0, payments: 0 },
      priorSignals: [],
      voiceFlags: [],
    })
    expect(r.ok).toBe(true)
  })
})
