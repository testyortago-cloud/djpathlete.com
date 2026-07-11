// Tests for the pipeline funnel aggregator fixes:
//  1. Bulk-loaded subscribers (csv_import / ghl_sync) are excluded from the
//     "signups" stage — importing a 5k CSV must not spike the funnel.
//  2. Every range fetch paginates past PostgREST's silent ~1000-row cap.
import { describe, it, expect, vi, beforeEach } from "vitest"

interface TableState {
  pages: unknown[][]
  filterCalls: Array<[string, ...unknown[]]>
  rangeCalls: Array<[number, number]>
}

const tables = new Map<string, TableState>()

function tableState(name: string): TableState {
  let t = tables.get(name)
  if (!t) {
    t = { pages: [[]], filterCalls: [], rangeCalls: [] }
    tables.set(name, t)
  }
  return t
}

function makeBuilder(table: string) {
  const t = tableState(table)
  const builder: Record<string, unknown> = {}
  for (const m of ["select", "is", "gte", "lte", "eq", "not", "order"]) {
    builder[m] = vi.fn((...args: unknown[]) => {
      t.filterCalls.push([m, ...args])
      return builder
    })
  }
  builder.range = vi.fn((from: number, to: number) => {
    t.rangeCalls.push([from, to])
    const data = t.pages[t.rangeCalls.length - 1] ?? []
    return Promise.resolve({ data, error: null })
  })
  return builder
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: vi.fn((table: string) => makeBuilder(table)),
  }),
}))

import { buildPipelineFunnel } from "@/lib/ads/pipeline"

const RANGE = {
  rangeStart: new Date("2026-06-13T00:00:00Z"),
  rangeEnd: new Date("2026-07-11T00:00:00Z"),
}

beforeEach(() => {
  tables.clear()
})

describe("buildPipelineFunnel — signup source filtering", () => {
  it("excludes bulk subscriber sources (csv_import, ghl_sync) from the signups query", async () => {
    await buildPipelineFunnel(RANGE)
    const calls = tableState("newsletter_subscribers").filterCalls
    expect(calls).toContainEqual(["not", "source", "in", "(csv_import,ghl_sync)"])
  })

  it("counts remaining subscriber rows as signups", async () => {
    tableState("newsletter_subscribers").pages = [
      [
        { gclid: "g1", gbraid: null, wbraid: null, fbclid: null },
        { gclid: null, gbraid: null, wbraid: null, fbclid: null },
      ],
    ]
    tableState("marketing_attribution").pages = [
      [
        {
          gclid: "g1",
          gbraid: null,
          wbraid: null,
          fbclid: null,
          utm_source: "google",
          utm_medium: "cpc",
          utm_campaign: "brand",
        },
      ],
    ]
    const funnel = await buildPipelineFunnel(RANGE)
    expect(funnel.totals.signups).toBe(2)
    expect(funnel.totals.visits).toBe(1)
    const googleRow = funnel.bySource.find((r) => r.dimension === "google")
    const directRow = funnel.bySource.find((r) => r.dimension === "(direct)")
    expect(googleRow?.signups).toBe(1)
    expect(directRow?.signups).toBe(1)
  })
})

describe("buildPipelineFunnel — pagination past the 1000-row cap", () => {
  it("keeps fetching pages until a short page arrives", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      gclid: `g${i}`,
      gbraid: null,
      wbraid: null,
      fbclid: null,
    }))
    const shortPage = Array.from({ length: 400 }, (_, i) => ({
      gclid: `h${i}`,
      gbraid: null,
      wbraid: null,
      fbclid: null,
    }))
    tableState("newsletter_subscribers").pages = [fullPage, shortPage]

    const funnel = await buildPipelineFunnel(RANGE)
    expect(funnel.totals.signups).toBe(1400)
    expect(tableState("newsletter_subscribers").rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })

  it("stops after one page when it is short", async () => {
    await buildPipelineFunnel(RANGE)
    expect(tableState("payments").rangeCalls).toEqual([[0, 999]])
    expect(tableState("bookings").rangeCalls).toEqual([[0, 999]])
    expect(tableState("marketing_attribution").rangeCalls).toEqual([[0, 999]])
  })
})
