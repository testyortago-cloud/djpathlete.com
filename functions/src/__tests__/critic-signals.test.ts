import { describe, it, expect, vi } from "vitest"
import {
  gatherCriticInputs,
  criticPreflight,
  channelOf,
  aggregateAttribution,
  aggregateFunnel,
  type AttributionRow,
} from "../strategy/critic-signals.js"

type Call = { table: string; method: string; args: unknown[] }

/**
 * A chainable, awaitable fake that RECORDS what each read asked for, so a test
 * can say which columns and which filter the attribution read used. `rows`
 * and `errors` are per table.
 */
function fakeSupabase(
  rows: Record<string, unknown[]> = {},
  errors: Record<string, { message: string }> = {},
) {
  const calls: Call[] = []
  const sb = {
    from: vi.fn().mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {}
      for (const method of ["select", "gte", "order", "limit"]) {
        chain[method] = vi.fn((...args: unknown[]) => {
          calls.push({ table, method, args })
          return chain
        })
      }
      chain.then = (resolve: (v: { data: unknown[] | null; error: { message: string } | null }) => unknown) =>
        resolve(errors[table] ? { data: null, error: errors[table] } : { data: rows[table] ?? [], error: null })
      return chain
    }),
  }
  return { sb, calls }
}

const EMPTY: AttributionRow = {
  gclid: null,
  gbraid: null,
  wbraid: null,
  fbclid: null,
  utm_source: null,
  referrer: null,
  claimed_at: null,
}

describe("gatherCriticInputs", () => {
  it("reads from all six expected tables", async () => {
    const { sb } = fakeSupabase()
    const inputs = await gatherCriticInputs(sb as never)
    expect(sb.from.mock.calls.map((c: unknown[]) => c[0])).toEqual(
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

  // G41. The read filtered on `occurred_at` and the aggregators read `channel`
  // and `event_type`; none of the three has ever existed on
  // marketing_attribution (00101, re-read on the dev clone 2026-09-27).
  it("reads marketing_attribution by columns that exist, and filters on first_seen_at", async () => {
    const { sb, calls } = fakeSupabase()
    await gatherCriticInputs(sb as never)
    const attr = calls.filter((c) => c.table === "marketing_attribution")
    const select = String(attr.find((c) => c.method === "select")?.args[0])
    for (const column of ["gclid", "gbraid", "wbraid", "fbclid", "utm_source", "referrer", "claimed_at"]) {
      expect(select).toContain(column)
    }
    for (const gone of ["channel", "event_type", "occurred_at", "revenue_cents"]) {
      expect(select).not.toContain(gone)
    }
    expect(attr.find((c) => c.method === "gte")?.args[0]).toBe("first_seen_at")
  })

  it("THROWS when the attribution read fails, instead of reporting no attribution", async () => {
    const { sb } = fakeSupabase({}, { marketing_attribution: { message: "column \"occurred_at\" does not exist" } })
    await expect(gatherCriticInputs(sb as never)).rejects.toThrow(/marketing_attribution.*occurred_at/)
  })

  it.each(["seo_agent_memos", "google_ads_agent_memos", "social_agent_memos", "cross_channel_signals", "voice_drift_flags"])(
    "THROWS when the %s read fails, instead of reporting nothing",
    async (table) => {
      const { sb } = fakeSupabase({}, { [table]: { message: "timeout" } })
      await expect(gatherCriticInputs(sb as never)).rejects.toThrow(new RegExp(table))
    },
  )

  it("turns real attribution rows into sessions and leads per first-touch channel", async () => {
    const { sb } = fakeSupabase({
      marketing_attribution: [
        { ...EMPTY, gclid: "g1", claimed_at: "2026-09-20T00:00:00Z" },
        { ...EMPTY, gclid: "g2" },
        { ...EMPTY, utm_source: "Newsletter" },
        { ...EMPTY },
      ],
    })
    const inputs = await gatherCriticInputs(sb as never)
    expect(inputs.attribution).toEqual({
      google_ads: { sessions: 2, leads: 1 },
      newsletter: { sessions: 1, leads: 0 },
      direct: { sessions: 1, leads: 0 },
    })
    expect(inputs.funnel).toEqual({ sessions: 4, leads: 1 })
  })
})

describe("channelOf", () => {
  it("puts a paid click id ahead of the UTM tag the same ad also carries", () => {
    expect(channelOf({ ...EMPTY, gclid: "g", utm_source: "google" })).toBe("google_ads")
    expect(channelOf({ ...EMPTY, gbraid: "b" })).toBe("google_ads")
    expect(channelOf({ ...EMPTY, wbraid: "w" })).toBe("google_ads")
    expect(channelOf({ ...EMPTY, fbclid: "f", utm_source: "facebook" })).toBe("meta_ads")
  })

  it("uses the UTM source, lower-cased and trimmed, when there is no click id", () => {
    expect(channelOf({ ...EMPTY, utm_source: "  Instagram " })).toBe("instagram")
  })

  it("falls back to referral, then direct", () => {
    expect(channelOf({ ...EMPTY, referrer: "https://www.google.com/" })).toBe("referral")
    expect(channelOf({ ...EMPTY, utm_source: "   " })).toBe("direct")
    expect(channelOf(EMPTY)).toBe("direct")
  })
})

describe("aggregateAttribution / aggregateFunnel", () => {
  it("counts nothing for no rows", () => {
    expect(aggregateAttribution([])).toEqual({})
    expect(aggregateFunnel([])).toEqual({ sessions: 0, leads: 0 })
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
      funnel: { sessions: 0, leads: 0 },
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
      funnel: { sessions: 0, leads: 0 },
      priorSignals: [],
      voiceFlags: [],
    })
    expect(r.ok).toBe(true)
  })
})
